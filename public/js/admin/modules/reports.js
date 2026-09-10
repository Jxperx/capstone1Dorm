/**
 * js/admin/modules/reports.js
 * AI-Powered Report Generation, Analytics & Integrated Condo/Dorm Media Manager
 */

const ReportModule = (() => {
    'use strict';

    let currentReport = null;
    let savedReportsCache = [];
    let currentMediaFilter = 'all';

    // ─── Initialise ───────────────────────────────────────────────────────────
    function init() {
        loadReportHistory();
        loadMediaStats();
        if (typeof loadPropertyMediaAdmin === 'function') {
            loadPropertyMediaAdmin();
        }
    }

    // ─── Workspace Tab Switcher ───────────────────────────────────────────────
    function switchTab(tabName) {
        const paneGenerator = document.getElementById('pane-reports-generator');
        const paneMedia     = document.getElementById('pane-reports-media');
        const paneHistory   = document.getElementById('pane-reports-history');

        const btnGenerator = document.getElementById('tab-btn-reports-generator');
        const btnMedia     = document.getElementById('tab-btn-reports-media');
        const btnHistory   = document.getElementById('tab-btn-reports-history');

        // Hide all panes
        if (paneGenerator) paneGenerator.style.display = 'none';
        if (paneMedia)     paneMedia.style.display     = 'none';
        if (paneHistory)   paneHistory.style.display   = 'none';

        // Reset tab button states
        [btnGenerator, btnMedia, btnHistory].forEach(btn => {
            if (btn) {
                btn.classList.remove('active', 'btn-dark', 'fw-bold');
                btn.classList.add('fw-semibold');
            }
        });

        if (tabName === 'media') {
            if (paneMedia) paneMedia.style.display = 'block';
            if (btnMedia) {
                btnMedia.classList.add('active');
            }
            loadMediaStats();
            if (typeof loadPropertyMediaAdmin === 'function') {
                loadPropertyMediaAdmin();
            }
        } else if (tabName === 'history') {
            if (paneHistory) paneHistory.style.display = 'block';
            if (btnHistory) {
                btnHistory.classList.add('active');
            }
            loadReportHistory();
        } else {
            // Default: 'generator'
            if (paneGenerator) paneGenerator.style.display = 'block';
            if (btnGenerator) {
                btnGenerator.classList.add('active');
            }
        }
    }

    // ─── Media Filter (All / Condo / Dorm) ────────────────────────────────────
    function setMediaFilter(type) {
        currentMediaFilter = type;
        const pillAll   = document.getElementById('mediaPillAll');
        const pillCondo = document.getElementById('mediaPillCondo');
        const pillDorm  = document.getElementById('mediaPillDorm');

        [pillAll, pillCondo, pillDorm].forEach(p => {
            if (p) {
                p.classList.remove('btn-dark', 'fw-bold');
                p.classList.add('btn-light', 'text-muted');
            }
        });

        const activePill = type === 'condo' ? pillCondo : (type === 'dorm' ? pillDorm : pillAll);
        if (activePill) {
            activePill.classList.remove('btn-light', 'text-muted');
            activePill.classList.add('btn-dark', 'fw-bold');
        }

        const select = document.getElementById('mediaUnitSelect');
        if (!select) return;

        const options = select.querySelectorAll('option');
        let firstVisible = null;

        options.forEach((opt, idx) => {
            if (idx === 0) return; // Keep placeholder
            const optType = opt.dataset.type;
            if (type === 'all' || optType === type) {
                opt.style.display = '';
                if (!firstVisible) firstVisible = opt;
            } else {
                opt.style.display = 'none';
            }
        });

        // If current selection is hidden, select first visible
        if (select.selectedIndex > 0) {
            const currentOpt = select.options[select.selectedIndex];
            if (currentOpt && currentOpt.style.display === 'none') {
                select.value = firstVisible ? firstVisible.value : '';
                if (typeof loadUnitGallery === 'function') {
                    loadUnitGallery();
                }
            }
        }
    }

    // ─── Load Media Stats ─────────────────────────────────────────────────────
    async function loadMediaStats() {
        try {
            const res = await fetch('/api/admin/reports/media-stats');
            if (!res.ok) return;
            const data = await res.json();
            const m = data.metrics || {};

            const condoEl = document.getElementById('mediaCondoHealth');
            const condoSub = document.getElementById('mediaCondoSub');
            if (condoEl) {
                condoEl.textContent = `${m.condoPhotographed}/${m.condoCount} Units Photographed (${m.condoPhotoPct}%)`;
            }
            if (condoSub) {
                condoSub.textContent = `Video Tour: ${m.condoVideo ? 'Active' : 'Not Uploaded'} | Map: ${m.condoMap ? 'Pinned' : 'Missing'}`;
            }

            const dormEl = document.getElementById('mediaDormHealth');
            const dormSub = document.getElementById('mediaDormSub');
            if (dormEl) {
                dormEl.textContent = `${m.dormPhotographed}/${m.dormCount} Units Photographed (${m.dormPhotoPct}%)`;
            }
            if (dormSub) {
                dormSub.textContent = `Video Tour: ${m.dormVideo ? 'Active' : 'Not Uploaded'} | Map: ${m.dormMap ? 'Pinned' : 'Missing'}`;
            }

            const tourEl = document.getElementById('mediaTourHealth');
            if (tourEl) {
                tourEl.textContent = `${m.overallCoveragePct}% Asset Ready`;
            }
        } catch (err) {
            console.error('[Media Stats Error]', err);
        }
    }

    // ─── Generate report ──────────────────────────────────────────────────────
    async function generateReport() {
        const type    = document.getElementById('rpt-type-select').value;
        const from    = document.getElementById('rpt-date-from').value;
        const to      = document.getElementById('rpt-date-to').value;
        const btn     = document.getElementById('rpt-generate-btn');
        const output  = document.getElementById('rpt-output');

        if (!type) {
            alert('Please select a report type.');
            return;
        }

        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Generating...';
        output.innerHTML = `
            <div class="rpt-loading text-center py-5">
                <div class="rpt-spinner mx-auto mb-3"></div>
                <div class="fw-semibold text-dark">AI is analyzing operations and compiling your executive report...</div>
                <div class="text-muted small">Leveraging Groq intelligence and Supabase database metrics</div>
            </div>`;

        try {
            const params = new URLSearchParams();
            if (from) params.set('from', from);
            if (to)   params.set('to', to);

            const res = await fetch(`/api/admin/reports/${type}?${params}`, { method: 'POST' });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Server error');
            }
            currentReport = await res.json();
            renderReport(currentReport);
            loadReportHistory();
        } catch (err) {
            output.innerHTML = `
                <div class="alert alert-danger rounded-3 shadow-sm p-4">
                    <i class="fas fa-exclamation-circle me-2"></i>
                    <strong>Report Generation Error:</strong> ${err.message}
                </div>`;
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-bolt me-1"></i> Generate Report';
        }
    }

    // ─── Render full report ───────────────────────────────────────────────────
    function renderReport(r) {
        const ki = r.keyInformation   || {};
        const pr = r.priorityRisk     || {};
        const dq = r.dataQualityNotes || {};

        const priorityClass = pr.priority || 'Low';
        const riskColor = { High: '#dc3545', Medium: '#ffc107', Low: '#198754' }[pr.risk] || '#6c757d';
        const generatedDate = new Date(r.generatedAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });

        // KPI cards
        const kpiHtml = Object.entries(ki).map(([key, val]) => `
            <div class="rpt-kpi">
                <div class="rpt-kpi-value">${formatKpiValue(key, val)}</div>
                <div class="rpt-kpi-label">${camelToLabel(key)}</div>
            </div>`).join('');

        // Ranked critical items
        const rankedHtml = (r.topCriticalItems || []).length === 0
            ? '<p class="text-muted small p-3 mb-0">No critical items detected in this reporting window.</p>'
            : (r.topCriticalItems).map(item => `
                <div class="rpt-ranked-item">
                    <div class="rpt-rank-num">#${item.rank}</div>
                    <div style="flex:1; line-height:1.4">
                        ${item.item}
                        ${item.emergency ? ' <span class="badge bg-danger ms-1" style="font-size:0.65rem;">EMERGENCY</span>' : ''}
                    </div>
                </div>`).join('');

        // Insights list
        const insightsHtml = (r.insights || []).length === 0
            ? '<li class="text-muted small">No specific operational patterns detected.</li>'
            : r.insights.map(i => `<li class="d-flex align-items-start gap-2 mb-2"><i class="fas fa-circle text-warning mt-1" style="font-size:0.45rem;"></i><span>${i}</span></li>`).join('');

        // Recommendations list
        const recsHtml = (r.recommendations || []).length === 0
            ? '<li class="text-muted small">No immediate recommendations at this time.</li>'
            : r.recommendations.map(rec => `<li class="d-flex align-items-start gap-2 mb-2"><i class="fas fa-check-circle text-success mt-1" style="font-size:0.85rem;"></i><span>${rec}</span></li>`).join('');

        // Data quality
        const dqItems = Object.entries(dq).map(([k, v]) => `<span class="me-3"><strong>${camelToLabel(k)}:</strong> ${v}</span>`).join('');

        document.getElementById('rpt-output').innerHTML = `
        <div class="rpt-report-card shadow-sm border-0" id="rpt-printable" style="border-radius:14px; overflow:hidden;">
            <div class="rpt-report-header p-4" style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color:#fff;">
                <div class="d-flex justify-content-between align-items-start gap-3 flex-wrap">
                    <div>
                        <div class="d-flex align-items-center gap-2 mb-1">
                            <span class="badge rpt-badge-${priorityClass} px-3 py-1 text-uppercase" style="font-size:0.7rem; letter-spacing:0.04em;">${priorityClass} Priority</span>
                            ${r.savedId ? `<span class="badge bg-light text-dark" style="font-size:0.7rem;"><i class="fas fa-save me-1"></i>Report #${r.savedId} Saved</span>` : ''}
                        </div>
                        <h2 class="mb-1 text-white" style="font-size:1.45rem; font-weight:700;"><i class="fas fa-file-contract me-2 text-warning"></i>${r.title}</h2>
                        <div class="rpt-meta d-flex gap-3 text-white-50 small mt-1 flex-wrap" style="font-size:0.75rem;">
                            <span><i class="fas fa-clock me-1"></i>${generatedDate}</span>
                            <span><i class="fas fa-shield-alt me-1" style="color:${riskColor}"></i>Risk Level: ${pr.risk || 'N/A'}</span>
                            <span><i class="fas fa-check-circle me-1 text-success"></i>AI Confidence: ${pr.confidence || 0}%</span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="rpt-body p-4 p-md-5">
                <!-- Executive Summary -->
                <div class="rpt-section mb-4">
                    <div class="rpt-section-title mb-2"><i class="fas fa-align-left me-2 text-warning"></i>Executive Summary (AI Generated)</div>
                    <div class="rpt-summary-box p-3 rounded-3" style="background:rgba(197,160,89,0.06); border-left:4px solid #c5a059; line-height:1.6; font-size:0.9rem;">
                        ${r.executiveSummary || 'No summary available.'}
                    </div>
                </div>

                <!-- Key Information Metrics -->
                <div class="rpt-section mb-4">
                    <div class="rpt-section-title mb-3"><i class="fas fa-tachometer-alt me-2 text-warning"></i>Key Performance Indicators</div>
                    <div class="rpt-kpi-grid">${kpiHtml || '<p class="text-muted small">No key metrics available.</p>'}</div>
                </div>

                <!-- Priority & Risk Assessment -->
                <div class="rpt-section mb-4">
                    <div class="rpt-section-title mb-2"><i class="fas fa-balance-scale me-2 text-warning"></i>Priority &amp; Risk Assessment</div>
                    <div class="rpt-risk-row d-flex align-items-center gap-3 p-3 bg-light rounded-3 border flex-wrap">
                        <span class="badge rpt-badge-${priorityClass} px-3 py-1.5" style="font-size:0.78rem;">${priorityClass} Priority</span>
                        <span class="badge px-3 py-1.5" style="background:${riskColor}20; color:${riskColor}; border:1px solid ${riskColor}40; font-size:0.78rem;">${pr.risk || 'N/A'} Risk</span>
                        <div style="flex:1; min-width:180px;">
                            <div class="d-flex justify-content-between small text-muted mb-1" style="font-size:0.75rem;">
                                <span>Confidence Meter</span>
                                <strong>${pr.confidence || 0}%</strong>
                            </div>
                            <div class="rpt-confidence-bar-wrap" style="height:6px; background:#e2e8f0; border-radius:10px; overflow:hidden;">
                                <div class="rpt-confidence-bar" style="width:${pr.confidence || 0}%; height:100%; background:#c5a059;"></div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Insights & Recommendations Row -->
                <div class="row g-4 mb-4">
                    <!-- Insights -->
                    <div class="col-md-6">
                        <div class="p-3 bg-light rounded-3 border h-100">
                            <div class="rpt-section-title mb-3" style="font-size:0.85rem;"><i class="fas fa-lightbulb me-2 text-warning"></i>Insights &amp; Operational Patterns</div>
                            <ul class="list-unstyled mb-0">${insightsHtml}</ul>
                        </div>
                    </div>
                    <!-- Recommendations -->
                    <div class="col-md-6">
                        <div class="p-3 bg-light rounded-3 border h-100">
                            <div class="rpt-section-title mb-3" style="font-size:0.85rem;"><i class="fas fa-tasks me-2 text-success"></i>Actionable Recommendations</div>
                            <ul class="list-unstyled mb-0">${recsHtml}</ul>
                        </div>
                    </div>
                </div>

                <!-- Ranked Items -->
                <div class="rpt-section mb-4">
                    <div class="rpt-section-title mb-2"><i class="fas fa-list-ol me-2 text-warning"></i>Top Critical Items Requiring Attention</div>
                    <div class="border rounded-3 overflow-hidden">${rankedHtml}</div>
                </div>

                <!-- Data Quality Notes -->
                <div class="rpt-section mb-4">
                    <div class="rpt-section-title mb-2"><i class="fas fa-database me-2 text-secondary"></i>Data Quality Notes</div>
                    <div class="rpt-dq-box p-3 bg-light rounded-3 border text-muted small">
                        <i class="fas fa-info-circle me-2 text-info"></i>
                        <span>${dqItems || 'All operational records analyzed are complete.'}</span>
                    </div>
                </div>

                <!-- Executive Conclusion -->
                <div class="rpt-section">
                    <div class="rpt-section-title mb-2"><i class="fas fa-flag-checkered me-2 text-dark"></i>Executive Conclusion</div>
                    <div class="p-3 rounded-3" style="background:#f8f9fa; border-left:4px solid #1a1a2e; font-size:0.88rem; color:#333;">
                        ${r.conclusion || 'Operational status is stable. Maintain ongoing scheduled oversight.'}
                    </div>
                </div>
            </div>
        </div>`;
    }

    // ─── Export CSV ───────────────────────────────────────────────────────────
    function exportCSV() {
        if (!currentReport) { alert('Generate a report first.'); return; }

        const r  = currentReport;
        const ki = r.keyInformation || {};
        const pr = r.priorityRisk   || {};

        const rows = [
            ['Report Title', r.title],
            ['Report Type',  r.report_type],
            ['Generated At', new Date(r.generatedAt).toLocaleString('en-PH')],
            ['Priority',     pr.priority || '-'],
            ['Risk Level',   pr.risk     || '-'],
            ['Confidence',   (pr.confidence || 0) + '%'],
            [],
            ['Executive Summary'],
            [r.executiveSummary],
            [],
            ['Key Information'],
            ...Object.entries(ki).map(([k, v]) => [camelToLabel(k), v]),
            [],
            ['Insights'],
            ...(r.insights || []).map(i => [i]),
            [],
            ['Recommendations'],
            ...(r.recommendations || []).map(rec => [rec]),
            [],
            ['Top Critical Items'],
            ['Rank', 'Item', 'Emergency'],
            ...(r.topCriticalItems || []).map(i => [i.rank, i.item, i.emergency ? 'Yes' : 'No']),
            [],
            ['Conclusion'],
            [r.conclusion || '-']
        ];

        const csv = rows.map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `${r.report_type}_report_${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ─── Print ────────────────────────────────────────────────────────────────
    function printReport() {
        if (!currentReport) { alert('Generate a report first.'); return; }
        window.print();
    }

    // ─── History list ─────────────────────────────────────────────────────────
    async function loadReportHistory() {
        const container = document.getElementById('rpt-history-list');
        const countBadge = document.getElementById('rpt-saved-count-badge');
        if (!container) return;

        try {
            const res  = await fetch('/api/admin/reports');
            const data = await res.json();
            savedReportsCache = Array.isArray(data) ? data : [];

            if (countBadge) {
                countBadge.textContent = savedReportsCache.length;
            }

            renderHistoryList(savedReportsCache);
        } catch (err) {
            container.innerHTML = '<p class="text-danger small py-3 text-center">Error loading saved reports history.</p>';
        }
    }

    function renderHistoryList(reports) {
        const container = document.getElementById('rpt-history-list');
        if (!container) return;

        if (!reports || reports.length === 0) {
            container.innerHTML = '<p class="text-muted small text-center py-4">No saved reports found.</p>';
            return;
        }

        container.innerHTML = reports.map(r => `
            <div class="rpt-history-card p-3 mb-2 rounded-3 border bg-white shadow-sm" onclick="ReportModule.loadSaved(${r.id})" id="rpt-hc-${r.id}" style="cursor:pointer; transition:all 0.2s;">
                <div class="d-flex justify-content-between align-items-center mb-1">
                    <span class="badge bg-light text-dark border" style="font-size:0.68rem;">${typeLabel(r.report_type)}</span>
                    <div class="d-flex align-items-center gap-2">
                        ${r.priority_level ? `<span class="badge rpt-badge-${r.priority_level}" style="font-size:0.65rem;">${r.priority_level}</span>` : ''}
                        <button class="btn btn-sm btn-outline-danger p-1" style="font-size:0.68rem; line-height:1;" onclick="event.stopPropagation(); ReportModule.deleteReport(${r.id})" title="Delete report">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
                <div class="fw-bold text-dark" style="font-size:0.88rem;">${r.report_title}</div>
                <div class="text-muted small mt-1" style="font-size:0.75rem;">
                    <i class="fas fa-clock me-1"></i>${new Date(r.generated_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
            </div>`).join('');
    }

    function filterHistory(query) {
        const q = (query || '').toLowerCase().trim();
        if (!q) {
            renderHistoryList(savedReportsCache);
            return;
        }
        const filtered = savedReportsCache.filter(r =>
            (r.report_title && r.report_title.toLowerCase().includes(q)) ||
            (r.report_type && r.report_type.toLowerCase().includes(q)) ||
            (r.executive_summary && r.executive_summary.toLowerCase().includes(q))
        );
        renderHistoryList(filtered);
    }

    async function loadSaved(id) {
        switchTab('generator');
        const output = document.getElementById('rpt-output');
        output.innerHTML = `
            <div class="rpt-loading text-center py-5">
                <div class="rpt-spinner mx-auto mb-3"></div>
                <div class="text-muted">Loading saved report #${id}...</div>
            </div>`;

        try {
            const res = await fetch(`/api/admin/reports/${id}`);
            const data = await res.json();
            currentReport = data.report_data;
            renderReport(currentReport);
        } catch (err) {
            output.innerHTML = `<div class="alert alert-danger">Failed to load saved report.</div>`;
        }
    }

    async function deleteReport(id) {
        if (!confirm('Delete this report permanently?')) return;
        try {
            await fetch(`/api/admin/reports/${id}`, { method: 'DELETE' });
            loadReportHistory();
        } catch {
            alert('Delete operation failed.');
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────
    function camelToLabel(str) {
        return str.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
    }

    function formatKpiValue(key, val) {
        if (typeof val === 'number' && key.toLowerCase().includes('revenue')) return 'PHP ' + val.toLocaleString('en-PH', { minimumFractionDigits: 2 });
        if (typeof val === 'number') return val.toLocaleString();
        return val ?? '-';
    }

    function typeLabel(type) {
        return { maintenance: 'Maintenance', financial: 'Financial', complaints: 'Complaints', booking: 'Booking', incident: 'Incident' }[type] || type;
    }

    return {
        init,
        switchTab,
        setMediaFilter,
        loadMediaStats,
        filterHistory,
        generateReport,
        exportCSV,
        printReport,
        loadSaved,
        deleteReport,
        loadReportHistory
    };
})();

// Expose globally for inline event handlers
window.ReportModule = ReportModule;
