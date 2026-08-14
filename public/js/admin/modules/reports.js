/**
 * js/admin/modules/reports.js
 * AI-Powered Report Generation & Analysis Module
 */

const ReportModule = (() => {
    'use strict';

    let currentReport = null;

    // ─── Initialise ───────────────────────────────────────────────────────────
    function init() {
        loadReportHistory();
    }

    // ─── Generate report ──────────────────────────────────────────────────────
    async function generateReport() {
        const type    = document.getElementById('rpt-type-select').value;
        const from    = document.getElementById('rpt-date-from').value;
        const to      = document.getElementById('rpt-date-to').value;
        const btn     = document.getElementById('rpt-generate-btn');
        const output  = document.getElementById('rpt-output');

        if (!type) { alert('Please select a report type.'); return; }

        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
        output.innerHTML = `<div class="rpt-loading"><div class="rpt-spinner"></div><span>AI is analyzing data & generating your report…</span></div>`;

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
            output.innerHTML = `<div class="alert alert-danger"><i class="fas fa-exclamation-circle me-2"></i>${err.message}</div>`;
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-bolt me-1"></i> Generate Report';
        }
    }

    // ─── Render full report ───────────────────────────────────────────────────
    function renderReport(r) {
        const ki   = r.keyInformation  || {};
        const pr   = r.priorityRisk    || {};
        const dq   = r.dataQualityNotes || {};

        const priorityClass  = pr.priority || 'Low';
        const riskColor      = { High: '#dc3545', Medium: '#ffc107', Low: '#198754' }[pr.risk] || '#6c757d';
        const generatedDate  = new Date(r.generatedAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });

        // KPI cards
        const kpiHtml = Object.entries(ki).map(([key, val]) => `
            <div class="rpt-kpi">
                <div class="rpt-kpi-value">${formatKpiValue(key, val)}</div>
                <div class="rpt-kpi-label">${camelToLabel(key)}</div>
            </div>`).join('');

        // Ranked items
        const rankedHtml = (r.topCriticalItems || []).length === 0
            ? '<p class="text-muted small">No critical items found.</p>'
            : (r.topCriticalItems).map(item => `
                <div class="rpt-ranked-item">
                    <div class="rpt-rank-num">${item.rank}</div>
                    <div style="flex:1;line-height:1.4">${item.item}${item.emergency ? ' <span class="rpt-emergency-tag ms-1">EMERGENCY</span>' : ''}</div>
                </div>`).join('');

        // Insights
        const insightsHtml = (r.insights || []).length === 0
            ? '<li>No specific insights detected.</li>'
            : r.insights.map(i => `<li>${i}</li>`).join('');

        // Recommendations
        const recsHtml = (r.recommendations || []).length === 0
            ? '<li>No specific recommendations at this time.</li>'
            : r.recommendations.map(rec => `<li><i class="fas fa-check-circle me-2" style="color:#c5a059"></i>${rec}</li>`).join('');

        // Data quality
        const dqItems = Object.entries(dq).map(([k, v]) => `<span class="me-3"><strong>${camelToLabel(k)}:</strong> ${v}</span>`).join('');

        document.getElementById('rpt-output').innerHTML = `
        <div class="rpt-report-card" id="rpt-printable">
            <div class="rpt-report-header">
                <div class="rpt-badge-priority rpt-badge-${priorityClass}">${priorityClass} Priority</div>
                <h2><i class="fas fa-file-chart-line me-2" style="color:#c5a059;font-size:1.2rem"></i>${r.title}</h2>
                <div class="rpt-meta">
                    <span><i class="fas fa-clock"></i>${generatedDate}</span>
                    <span><i class="fas fa-shield-alt" style="color:${riskColor}"></i>Risk: ${pr.risk || 'N/A'}</span>
                    <span><i class="fas fa-check-circle"></i>Confidence: ${pr.confidence || 0}%</span>
                    ${r.savedId ? `<span><i class="fas fa-save"></i>Report #${r.savedId} saved</span>` : ''}
                </div>
            </div>

            <div class="rpt-body">
                <!-- Executive Summary -->
                <div class="rpt-section">
                    <div class="rpt-section-title"><i class="fas fa-align-left"></i>Executive Summary</div>
                    <div class="rpt-summary-box">${r.executiveSummary || 'No summary available.'}</div>
                </div>

                <!-- Key Information -->
                <div class="rpt-section">
                    <div class="rpt-section-title"><i class="fas fa-tachometer-alt"></i>Key Information</div>
                    <div class="rpt-kpi-grid">${kpiHtml || '<p class="text-muted small">No key metrics.</p>'}</div>
                </div>

                <!-- Priority & Risk -->
                <div class="rpt-section">
                    <div class="rpt-section-title"><i class="fas fa-thermometer-half"></i>Priority & Risk Assessment</div>
                    <div class="rpt-risk-row">
                        <span class="badge rpt-badge-${priorityClass}" style="font-size:.8rem;padding:6px 14px">${priorityClass} Priority</span>
                        <span class="badge" style="background:${riskColor}20;color:${riskColor};border:1px solid ${riskColor}40;font-size:.8rem;padding:6px 14px">${pr.risk || 'N/A'} Risk</span>
                        <div style="flex:1">
                            <div style="font-size:.75rem;color:#888;margin-bottom:4px">Confidence Score: ${pr.confidence || 0}%</div>
                            <div class="rpt-confidence-bar-wrap">
                                <div class="rpt-confidence-bar" style="width:${pr.confidence || 0}%"></div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Insights -->
                <div class="rpt-section">
                    <div class="rpt-section-title"><i class="fas fa-lightbulb"></i>Insights & Patterns</div>
                    <ul class="rpt-list list-unstyled mb-0">${insightsHtml}</ul>
                </div>

                <!-- Recommendations -->
                <div class="rpt-section">
                    <div class="rpt-section-title"><i class="fas fa-tasks"></i>Recommendations</div>
                    <ul class="rpt-list list-unstyled mb-0">${recsHtml}</ul>
                </div>

                <!-- Ranked Items -->
                <div class="rpt-section">
                    <div class="rpt-section-title"><i class="fas fa-list-ol"></i>Top Critical Items (Ranked)</div>
                    ${rankedHtml}
                </div>

                <!-- Data Quality -->
                <div class="rpt-section">
                    <div class="rpt-section-title"><i class="fas fa-database"></i>Data Quality Notes</div>
                    <div class="rpt-dq-box"><i class="fas fa-info-circle"></i><span>${dqItems || 'All records complete.'}</span></div>
                </div>

                <!-- Conclusion -->
                <div class="rpt-section">
                    <div class="rpt-section-title"><i class="fas fa-flag-checkered"></i>Conclusion</div>
                    <div class="rpt-summary-box" style="border-left-color:#1a1a2e">${r.conclusion || '—'}</div>
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
            ['Priority',     pr.priority || '—'],
            ['Risk Level',   pr.risk     || '—'],
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
            [r.conclusion || '—']
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
        if (!container) return;
        try {
            const res  = await fetch('/api/admin/reports');
            const data = await res.json();
            if (!data.length) {
                container.innerHTML = '<p class="text-muted small text-center py-3">No saved reports yet.</p>';
                return;
            }
            container.innerHTML = data.map(r => `
                <div class="rpt-history-card" onclick="ReportModule.loadSaved(${r.id})" id="rpt-hc-${r.id}">
                    <div class="rpt-hc-type">${typeLabel(r.report_type)}</div>
                    <div class="rpt-hc-title">${r.report_title}</div>
                    <div class="d-flex justify-content-between align-items-center mt-1">
                        <div class="rpt-hc-date"><i class="fas fa-clock me-1"></i>${new Date(r.generated_at).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})}</div>
                        <div style="display:flex;gap:6px;align-items:center">
                            ${r.priority_level ? `<span class="badge rpt-badge-${r.priority_level}" style="font-size:.65rem">${r.priority_level}</span>` : ''}
                            <button class="btn btn-sm" style="padding:1px 7px;font-size:.7rem;color:#dc3545;border:1px solid #f5c6c6;border-radius:6px;background:#fff" onclick="event.stopPropagation();ReportModule.deleteReport(${r.id})"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                </div>`).join('');
        } catch (err) {
            container.innerHTML = '<p class="text-danger small">Error loading history.</p>';
        }
    }

    async function loadSaved(id) {
        const output = document.getElementById('rpt-output');
        output.innerHTML = `<div class="rpt-loading"><div class="rpt-spinner"></div><span>Loading saved report…</span></div>`;
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
        if (!confirm('Delete this report?')) return;
        try {
            await fetch(`/api/admin/reports/${id}`, { method: 'DELETE' });
            loadReportHistory();
        } catch { alert('Delete failed.'); }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────
    function camelToLabel(str) {
        return str.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
    }
    function formatKpiValue(key, val) {
        if (typeof val === 'number' && key.toLowerCase().includes('revenue')) return '₱' + val.toLocaleString('en-PH', { minimumFractionDigits: 2 });
        if (typeof val === 'number') return val.toLocaleString();
        return val ?? '—';
    }
    function typeLabel(type) {
        return { maintenance: '🔧 Maintenance', financial: '💰 Financial', complaints: '💬 Complaints', booking: '📋 Booking', incident: '🚨 Incident' }[type] || type;
    }

    return { init, generateReport, exportCSV, printReport, loadSaved, deleteReport, loadReportHistory };
})();

// Expose for inline onclick
window.ReportModule = ReportModule;
