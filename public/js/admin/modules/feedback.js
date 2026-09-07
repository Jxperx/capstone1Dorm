/**
 * js/admin/modules/feedback.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Tenant Feedback & AI Insights Admin Module (Luxury Design System)
 * Strictly harmonized with Room & Unit Management and Maintenance Requests.
 * Academic Standard: Strictly ZERO emojis across all components, modals, and toasts.
 * ─────────────────────────────────────────────────────────────────────────────
 */

console.log('[Feedback Module] Script loaded successfully (v2.0)');

// ── Module State ──
let allFeedbackRecords = [];
let currentFeedbackFilter = 'all';
let selectedFeedbackRecord = null;

// ── Helper: HTML Escaping ──
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function escapeAttr(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/'/g, '&#39;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// ── Main Data Loader ──
async function loadAdminFeedback(isUserRefresh = false) {
    const tableBody = document.getElementById('adminFeedbackTableBody');
    if (!tableBody) return;

    if (isUserRefresh) {
        showFeedbackToast('Refreshed Tenant Feedback & AI Insights');
    }

    try {
        const res = await fetch('/api/admin/feedback/all', { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to fetch feedback, status: ' + res.status);
        const data = await res.json();
        allFeedbackRecords = Array.isArray(data) ? data : [];
        applyFiltersAndRender();
    } catch (err) {
        console.error('[Feedback Module] Error loading feedback:', err);
        tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-danger">Error loading resident feedback: ${escapeHtml(err.message)}</td></tr>`;
    }

    // Load companion intelligence cards concurrently
    try { loadExecutiveSummary(); } catch(e) { console.error('[Feedback] Executive summary error:', e); }
    try { loadAdminAlerts(); } catch(e) { console.error('[Feedback] Alerts error:', e); }
    try { loadChurnRisk(); } catch(e) { console.error('[Feedback] Churn risk error:', e); }
    try { loadResolvedAlerts(); } catch(e) { console.error('[Feedback] Resolved alerts error:', e); }
}

// ── Search & Pill Filtering Logic ──
function filterFeedbackBySearch() {
    applyFiltersAndRender();
}

function filterFeedback(filterValue, btnEl) {
    currentFeedbackFilter = filterValue;

    // Update active button state
    document.querySelectorAll('#feedbackFilters .fb-filter-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.classList.add('btn-outline-secondary');
        btn.style.background = '';
        btn.style.color = '';
        btn.style.border = '';
    });

    if (btnEl) {
        btnEl.classList.add('active');
        btnEl.classList.remove('btn-outline-secondary');
        btnEl.style.background = '#1a1a2e';
        btnEl.style.color = '#fff';
        btnEl.style.border = 'none';
    }

    applyFiltersAndRender();
}

function applyFiltersAndRender() {
    const searchVal = (document.getElementById('feedbackSearchInput')?.value || '').trim().toLowerCase();

    const filtered = allFeedbackRecords.filter(item => {
        // 1. Category / Sentiment Filter
        if (currentFeedbackFilter === 'needs_attention') {
            if (!item.ai_needs_attention) return false;
        } else if (currentFeedbackFilter === 'Positive') {
            if ((item.ai_sentiment || '').toLowerCase() !== 'positive') return false;
        } else if (currentFeedbackFilter === 'Negative') {
            if ((item.ai_sentiment || '').toLowerCase() !== 'negative') return false;
        } else if (currentFeedbackFilter === 'wifi') {
            const haystack = `${item.feedback_text || ''} ${item.category || ''} ${item.ai_summary || ''} ${JSON.stringify(item.ai_topics || '')} ${JSON.stringify(item.ai_keywords || '')}`.toLowerCase();
            if (!haystack.includes('wifi') && !haystack.includes('internet') && !haystack.includes('connection')) return false;
        } else if (currentFeedbackFilter === 'noise') {
            const haystack = `${item.feedback_text || ''} ${item.category || ''} ${item.ai_summary || ''} ${JSON.stringify(item.ai_topics || '')} ${JSON.stringify(item.ai_keywords || '')}`.toLowerCase();
            if (!haystack.includes('noise') && !haystack.includes('quiet') && !haystack.includes('sound') && !haystack.includes('party')) return false;
        } else if (currentFeedbackFilter === 'clean') {
            const haystack = `${item.feedback_text || ''} ${item.category || ''} ${item.ai_summary || ''} ${JSON.stringify(item.ai_topics || '')} ${JSON.stringify(item.ai_keywords || '')}`.toLowerCase();
            if (!haystack.includes('clean') && !haystack.includes('trash') && !haystack.includes('dirty') && !haystack.includes('sanit')) return false;
        }

        // 2. Text Search Filter
        if (searchVal) {
            const tenantMatch = (item.tenant_name || '').toLowerCase().includes(searchVal);
            const roomMatch = (item.room_number || '').toLowerCase().includes(searchVal);
            const textMatch = (item.feedback_text || '').toLowerCase().includes(searchVal);
            const summaryMatch = (item.ai_summary || '').toLowerCase().includes(searchVal);
            const categoryMatch = (item.category || '').toLowerCase().includes(searchVal);
            let topicMatch = false;
            if (item.ai_topics) {
                topicMatch = JSON.stringify(item.ai_topics).toLowerCase().includes(searchVal);
            }
            if (!tenantMatch && !roomMatch && !textMatch && !summaryMatch && !categoryMatch && !topicMatch) {
                return false;
            }
        }

        return true;
    });

    renderAdminFeedback(filtered);
}

// ── Render Feedback Table Rows (Room Management Style) ──
function renderAdminFeedback(data) {
    const tableBody = document.getElementById('adminFeedbackTableBody');
    const countEl = document.getElementById('feedbackTableCount');
    if (countEl) countEl.textContent = data.length;

    if (!tableBody) return;

    if (data.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center py-5 text-muted">
                    <div class="mb-2"><i class="fas fa-inbox fa-2x opacity-50"></i></div>
                    <div class="fw-semibold">No resident feedback found matching criteria.</div>
                    <div class="small">Try adjusting your search terms or filter selection.</div>
                </td>
            </tr>
        `;
        return;
    }

    let html = '';
    data.forEach(item => {
        // Date format MM/DD/YY
        const d = new Date(item.created_at);
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const yy = String(d.getFullYear()).slice(-2);
        const dateFormatted = `${mm}/${dd}/${yy}`;

        // Tenant & Room
        const tenantName = escapeHtml(item.tenant_name || 'Anonymous Resident');
        const unitText = item.room_number ? `Unit ${escapeHtml(item.room_number)}` : '<span class="text-muted">Unassigned</span>';

        // Feedback quote preview
        const quoteText = escapeHtml(item.feedback_text || '');
        const summaryText = escapeHtml(item.ai_summary || item.category || '');

        // Sentiment badge
        const sentiment = (item.ai_sentiment || 'Neutral').toLowerCase();
        let sentimentBadge;
        if (sentiment === 'positive') {
            sentimentBadge = '<span class="badge rounded-pill" style="background:#e8f8f0;color:#10b981;font-weight:600;padding:6px 14px;font-size:0.75rem;display:inline-block;text-align:center;min-width:76px;">Positive</span>';
        } else if (sentiment === 'negative') {
            sentimentBadge = '<span class="badge rounded-pill" style="background:#fee2e2;color:#ef4444;font-weight:600;padding:6px 14px;font-size:0.75rem;display:inline-block;text-align:center;min-width:76px;">Negative</span>';
        } else {
            sentimentBadge = `<span class="badge rounded-pill" style="background:#fef3c7;color:#92400e;font-weight:600;padding:6px 14px;font-size:0.75rem;display:inline-block;text-align:center;min-width:76px;">${escapeHtml(item.ai_sentiment || 'Neutral')}</span>`;
        }

        // Attention badge
        const attentionBadge = item.ai_needs_attention
            ? '<div class="mt-1"><span class="badge rounded-pill" style="background:#fee2e2;color:#ef4444;font-weight:600;font-size:0.68rem;padding:2px 8px;">Needs Attention</span></div>'
            : '';

        html += `
            <tr style="cursor: pointer; transition: background-color 0.15s ease; border-bottom: 1px solid #f3f4f6;"
                onclick="openFeedbackDetailModal(${item.id})"
                class="align-middle"
                title="Click to view full resident feedback and AI diagnostics">
                <td style="color: #6b7280; font-size: 0.8rem; font-weight: 500; padding: 12px 6px; vertical-align: middle; white-space: nowrap;">
                    ${dateFormatted}
                </td>
                <td style="padding: 12px 6px; vertical-align: middle;">
                    <div style="font-weight: 700; color: #1a1a2e; font-size: 0.85rem;">${tenantName}</div>
                    <div class="small text-muted" style="font-size: 0.78rem;">${unitText}</div>
                </td>
                <td style="padding: 12px 6px; vertical-align: middle;">
                    <div class="text-truncate" style="max-width: 320px; font-weight: 500; color: #2c3e50; font-size: 0.83rem;" title="${quoteText}">
                        "${quoteText}"
                    </div>
                    ${summaryText ? `<div class="small text-muted fst-italic mt-1 text-truncate" style="max-width: 320px; font-size: 0.75rem;">${summaryText}</div>` : ''}
                </td>
                <td class="text-center" style="padding: 12px 6px; vertical-align: middle; white-space: nowrap;">
                    ${sentimentBadge}
                    ${attentionBadge}
                </td>
                <td class="text-center" style="padding: 12px 6px; vertical-align: middle; white-space: nowrap;">
                    <button type="button"
                            class="btn btn-sm rounded-pill px-3 fw-semibold"
                            style="border: 1px solid #c5a059; color: #c5a059; font-size: 0.75rem; background: transparent; transition: all 0.2s;"
                            onmouseover="this.style.background='#c5a059';this.style.color='#fff';"
                            onmouseout="this.style.background='transparent';this.style.color='#c5a059';"
                            onclick="event.stopPropagation(); openFeedbackDetailModal(${item.id})">
                        Details
                    </button>
                </td>
            </tr>
        `;
    });

    tableBody.innerHTML = html;
}

// ── Open Centered Detail Modal (Click-to-Inspect) ──
function openFeedbackDetailModal(id) {
    const item = allFeedbackRecords.find(r => r.id === id);
    if (!item) return;

    selectedFeedbackRecord = item;

    // Tenant Profile
    const nameEl = document.getElementById('feedbackDetailTenantName');
    const emailEl = document.getElementById('feedbackDetailEmail');
    const phoneEl = document.getElementById('feedbackDetailPhone');
    const roomEl = document.getElementById('feedbackDetailRoomNumber');
    const categoryEl = document.getElementById('feedbackDetailCategoryBadge');

    if (nameEl) nameEl.textContent = item.tenant_name || 'Anonymous Resident';
    if (emailEl) emailEl.textContent = item.email || 'No email registered';
    if (phoneEl) phoneEl.textContent = item.phone_number || 'No phone registered';
    if (roomEl) roomEl.textContent = item.room_number ? `Unit ${item.room_number}` : 'Unassigned Room';
    if (categoryEl) categoryEl.textContent = item.category ? `Category: ${item.category}` : 'General Resident Feedback';

    // Meta Date
    const d = new Date(item.created_at);
    const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const metaEl = document.getElementById('feedbackDetailMeta');
    if (metaEl) metaEl.textContent = `Submitted on ${dateStr}`;

    // Sentiment Badge
    const sentBadge = document.getElementById('feedbackDetailSentimentBadge');
    if (sentBadge) {
        const sent = (item.ai_sentiment || 'Neutral').toLowerCase();
        if (sent === 'positive') {
            sentBadge.className = 'badge rounded-pill';
            sentBadge.style.cssText = 'background:#e8f8f0;color:#10b981;font-weight:600;padding:6px 14px;font-size:0.75rem;';
            sentBadge.textContent = 'Positive Sentiment';
        } else if (sent === 'negative') {
            sentBadge.className = 'badge rounded-pill';
            sentBadge.style.cssText = 'background:#fee2e2;color:#ef4444;font-weight:600;padding:6px 14px;font-size:0.75rem;';
            sentBadge.textContent = 'Negative Sentiment';
        } else {
            sentBadge.className = 'badge rounded-pill';
            sentBadge.style.cssText = 'background:#fef3c7;color:#92400e;font-weight:600;padding:6px 14px;font-size:0.75rem;';
            sentBadge.textContent = item.ai_sentiment || 'Neutral Sentiment';
        }
    }

    // Attention Badge
    const attBadge = document.getElementById('feedbackDetailAttentionBadge');
    if (attBadge) {
        if (item.ai_needs_attention) {
            attBadge.style.display = 'inline-block';
            attBadge.className = 'badge rounded-pill';
            attBadge.style.cssText = 'background:#fee2e2;color:#ef4444;font-weight:600;padding:6px 14px;font-size:0.75rem;';
        } else {
            attBadge.style.display = 'none';
        }
    }

    // Feedback Quote
    const quoteEl = document.getElementById('feedbackDetailQuote');
    if (quoteEl) quoteEl.textContent = `"${item.feedback_text || ''}"`;

    // AI Diagnostics & Scores
    const scoreVal = typeof item.ai_sentiment_score === 'number' ? item.ai_sentiment_score.toFixed(2) : (item.ai_sentiment_score || '0.00');
    const scoreEl = document.getElementById('feedbackDetailScoreBadge');
    if (scoreEl) scoreEl.textContent = `Sentiment Score: ${scoreVal}`;

    const confVal = item.ai_confidence ? Math.round(Number(item.ai_confidence) * 100) : 90;
    const confEl = document.getElementById('feedbackDetailConfidenceBadge');
    if (confEl) confEl.textContent = `Confidence: ${confVal}%`;

    const summaryEl = document.getElementById('feedbackDetailAiSummary');
    if (summaryEl) summaryEl.textContent = item.ai_summary || 'No detailed AI summary generated for this record.';

    // Extracted Topics
    const topicsEl = document.getElementById('feedbackDetailTopics');
    if (topicsEl) {
        let topics = [];
        if (Array.isArray(item.ai_topics)) {
            topics = item.ai_topics;
        } else if (typeof item.ai_topics === 'string') {
            try { topics = JSON.parse(item.ai_topics); } catch (e) { topics = [item.ai_topics]; }
        }
        if (topics && topics.length > 0) {
            topicsEl.innerHTML = topics.map(t => `<span class="badge rounded-pill bg-light text-dark border px-2 py-1" style="font-size:0.72rem;">${escapeHtml(t)}</span>`).join('');
        } else {
            topicsEl.innerHTML = '<span class="text-muted small fst-italic">None identified</span>';
        }
    }

    // Extracted Keywords
    const keywordsEl = document.getElementById('feedbackDetailKeywords');
    if (keywordsEl) {
        let keywords = [];
        if (Array.isArray(item.ai_keywords)) {
            keywords = item.ai_keywords;
        } else if (typeof item.ai_keywords === 'string') {
            try { keywords = JSON.parse(item.ai_keywords); } catch (e) { keywords = [item.ai_keywords]; }
        }
        if (keywords && keywords.length > 0) {
            keywordsEl.innerHTML = keywords.map(k => `<span class="badge rounded-pill bg-light text-secondary border px-2 py-1" style="font-size:0.72rem;">${escapeHtml(k)}</span>`).join('');
        } else {
            keywordsEl.innerHTML = '<span class="text-muted small fst-italic">None identified</span>';
        }
    }

    const modalEl = document.getElementById('feedbackDetailModal');
    if (modalEl && window.bootstrap) {
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
}

// ── Detail Modal Action Handlers ──
async function createWorkOrderFromDetail() {
    if (!selectedFeedbackRecord) return;
    const topic = selectedFeedbackRecord.category || (selectedFeedbackRecord.ai_topics && selectedFeedbackRecord.ai_topics[0]) || 'Tenant Feedback Issue';
    const action = `Inspect issue reported by ${selectedFeedbackRecord.tenant_name || 'resident'} in room ${selectedFeedbackRecord.room_number || 'N/A'}: ${selectedFeedbackRecord.ai_summary || selectedFeedbackRecord.feedback_text}`;

    const modalEl = document.getElementById('feedbackDetailModal');
    if (modalEl && window.bootstrap) {
        bootstrap.Modal.getInstance(modalEl)?.hide();
    }

    await createWorkOrderFromAlert(topic, action);
}

function openNoticeFromDetail() {
    if (!selectedFeedbackRecord) return;
    const topic = selectedFeedbackRecord.category || (selectedFeedbackRecord.ai_topics && selectedFeedbackRecord.ai_topics[0]) || 'Facility Service';

    const modalEl = document.getElementById('feedbackDetailModal');
    if (modalEl && window.bootstrap) {
        bootstrap.Modal.getInstance(modalEl)?.hide();
    }

    openTenantNoticeModal(topic);
}

// ── AI Executive Summary & Ribbon Updates ──
async function loadExecutiveSummary() {
    try {
        const res = await fetch('/api/admin/feedback/executive-summary', { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();

        // 1. Health Score (Metric 1)
        const scoreEl = document.getElementById('feedbackHealthScore');
        if (scoreEl) scoreEl.textContent = data.healthScore ?? '--';

        const captionEl = document.getElementById('feedbackHealthCaption');
        if (captionEl) {
            if (data.healthScore >= 75) {
                captionEl.textContent = 'High Resident Satisfaction';
            } else if (data.healthScore >= 50) {
                captionEl.textContent = 'Moderate Satisfaction';
            } else {
                captionEl.textContent = 'Attention Required';
            }
        }

        // 2. Net Positive Sentiment (Metric 2)
        const total = (data.positiveCount || 0) + (data.negativeCount || 0);
        const positivePct = total > 0 ? Math.round((data.positiveCount / total) * 100) : (data.healthScore || 0);
        const rateEl = document.getElementById('feedbackPositiveRate');
        if (rateEl) rateEl.textContent = `${positivePct}%`;

        const netEl = document.getElementById('feedbackNetRatio');
        if (netEl) netEl.textContent = `${data.positiveCount || 0} Pos / ${data.negativeCount || 0} Neg`;

        // 3. Weekly Summary Bullet Points
        const summaryList = document.getElementById('feedbackExecSummary');
        if (summaryList && data.executiveSummary && data.executiveSummary.length > 0) {
            summaryList.innerHTML = data.executiveSummary.map(bullet => `
                <li class="mb-2 d-flex align-items-start">
                    <i class="fas fa-check-circle me-2 mt-1" style="color: #c5a059; font-size: 0.8rem;"></i>
                    <span>${escapeHtml(bullet)}</span>
                </li>
            `).join('');
        }
    } catch (err) {
        console.error('[Feedback Module] Error loading executive summary:', err);
    }
}

// ── Churn Risk Radar (Metric 4 & Table) ──
async function loadChurnRisk() {
    const tbody = document.getElementById('churnRiskTableBody');
    const badge = document.getElementById('churnRiskBadge');
    const ribbonCount = document.getElementById('feedbackChurnCount');

    try {
        const res = await fetch('/api/admin/feedback/churn-risk', { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to fetch churn risk');
        const data = await res.json();

        if (badge) badge.textContent = `${data.length} Flagged`;
        if (ribbonCount) ribbonCount.textContent = data.length;

        if (!tbody) return;

        if (!data || data.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" class="text-center py-4 text-success" style="font-size: 0.85rem;">
                        <i class="fas fa-check-circle me-1"></i>No move-out churn risks detected. Dorm retention is healthy.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = data.map(item => {
            const isHigh = item.riskLevel === 'HIGH';
            const riskBadge = isHigh
                ? `<span class="badge rounded-pill" style="background:#fee2e2;color:#ef4444;font-weight:600;font-size:0.75rem;padding:5px 12px;">HIGH (${item.riskPct || 0}%)</span>`
                : `<span class="badge rounded-pill" style="background:#fef3c7;color:#92400e;font-weight:600;font-size:0.75rem;padding:5px 12px;">MED (${item.riskPct || 0}%)</span>`;

            return `
                <tr style="border-bottom: 1px solid #f3f4f6;">
                    <td style="padding: 10px 6px;">
                        <div style="font-weight: 700; color: #1a1a2e; font-size: 0.83rem;">${escapeHtml(item.tenant_name)}</div>
                        <div class="small text-muted">${item.room_number ? 'Unit ' + escapeHtml(item.room_number) : 'Unassigned'}</div>
                    </td>
                    <td style="text-align: center; padding: 10px 6px;">
                        <span class="badge rounded-pill" style="background:#f3f4f6;color:#374151;font-weight:600;font-size:0.75rem;padding:4px 10px;">${item.negative_feedback_count} report(s)</span>
                    </td>
                    <td style="text-align: center; padding: 10px 6px;">
                        ${riskBadge}
                    </td>
                    <td style="padding: 10px 6px;">
                        <div class="small text-dark fw-semibold" style="font-size: 0.78rem;">${escapeHtml(item.recommendation || 'Direct outreach recommended')}</div>
                        <div class="small text-muted fst-italic text-truncate" style="max-width: 220px;" title="${escapeHtml(item.latest_issue_summary || '')}">${escapeHtml(item.latest_issue_summary || '')}</div>
                    </td>
                </tr>
            `;
        }).join('');

    } catch (err) {
        console.error('[Feedback Module] Error loading churn risk:', err);
        if (tbody) tbody.innerHTML = `<tr><td colspan="4" class="text-center py-3 text-muted">Unable to calculate churn risk.</td></tr>`;
    }
}

// ── Active Trend Alerts (Metric 3 & Cards) ──
async function loadAdminAlerts() {
    const container = document.getElementById('alertsList');
    const ribbonCount = document.getElementById('feedbackActiveAlertsCount');
    const activePill = document.getElementById('activeAlertsPill');

    try {
        const res = await fetch('/api/admin/feedback/alerts', { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to fetch alerts');
        const data = await res.json();

        if (ribbonCount) ribbonCount.textContent = data.length;
        if (activePill) activePill.textContent = `${data.length} Active`;

        renderAdminAlerts(data);
    } catch (err) {
        console.error('[Feedback Module] Error loading alerts:', err);
        if (container) container.innerHTML = `<div class="col-12"><div class="alert alert-danger">Error loading AI trend alerts.</div></div>`;
    }
}

function renderAdminAlerts(data) {
    const container = document.getElementById('alertsList');
    if (!container) return;

    if (!data || data.length === 0) {
        container.innerHTML = `
            <div class="col-12">
                <div class="card border-0 shadow-sm rounded-4 p-4 text-center" style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border-left: 4px solid #10b981 !important;">
                    <div class="d-flex align-items-center justify-content-center gap-3">
                        <div class="rounded-circle d-flex align-items-center justify-content-center" style="width: 44px; height: 44px; background: rgba(16, 185, 129, 0.15);">
                            <i class="fas fa-check-circle text-success fs-5"></i>
                        </div>
                        <div class="text-start">
                            <div class="fw-bold text-dark" style="font-size: 0.95rem;">All Systems Quiet &amp; Healthy</div>
                            <div class="small text-muted">No active negative trend patterns detected across dorm residents.</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        return;
    }

    let html = '';
    data.forEach(alert => {
        const severity = (alert.alert_severity || 'Medium').toLowerCase();
        let bgGrad, borderColor, badgeBg, badgeColor, iconClass;

        if (severity === 'high') {
            bgGrad = 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)';
            borderColor = '#ef4444';
            badgeBg = '#fee2e2';
            badgeColor = '#ef4444';
            iconClass = 'fas fa-fire text-danger';
        } else if (severity === 'medium') {
            bgGrad = 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)';
            borderColor = '#f59e0b';
            badgeBg = '#fef3c7';
            badgeColor = '#b45309';
            iconClass = 'fas fa-chart-line text-warning';
        } else {
            bgGrad = 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)';
            borderColor = '#0284c7';
            badgeBg = '#e0f2fe';
            badgeColor = '#0369a1';
            iconClass = 'fas fa-info-circle text-primary';
        }

        const rawScore = parseFloat(alert.avg_sentiment_score);
        const scoreFormatted = isNaN(rawScore) ? 'N/A' : (rawScore > 0 ? '+' + rawScore.toFixed(2) : rawScore.toFixed(2));
        const safeTopic = escapeAttr(alert.issue_topic);
        const safeAction = escapeAttr(alert.recommended_action);

        html += `
            <div class="col-12 col-md-6">
                <div class="card border-0 shadow-sm rounded-4 h-100 p-4" style="background: ${bgGrad}; border-left: 4px solid ${borderColor} !important;">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <span class="badge rounded-pill fw-bold text-uppercase" style="background:${badgeBg}; color:${badgeColor}; font-size: 0.72rem; padding: 5px 12px; letter-spacing: 0.5px;">
                            ${escapeHtml(alert.alert_severity || 'Active')} Priority
                        </span>
                        <small class="text-muted fw-semibold" style="font-size: 0.75rem;"><i class="fas fa-clock me-1"></i>Active Pattern</small>
                    </div>
                    <h5 class="fw-bold mb-2" style="font-family: 'Playfair Display', Georgia, serif; color: #1a1a2e; font-size: 1.15rem;">
                        <i class="${iconClass} me-2"></i>Trend: ${escapeHtml(alert.issue_topic)}
                    </h5>
                    <p class="text-muted mb-3" style="font-size: 0.83rem;">
                        Identified <strong>${alert.negative_count || 0} negative reports</strong> with average sentiment score of <strong>${scoreFormatted}</strong>.
                    </p>

                    <!-- Proactive Action Plan Box -->
                    <div class="bg-white p-3 rounded-3 border mb-3 shadow-sm" style="border-color: rgba(0,0,0,0.06) !important;">
                        <div class="small fw-bold text-uppercase mb-1" style="color: #c5a059; font-size: 0.72rem; letter-spacing: 0.5px;">
                            <i class="fas fa-robot me-1"></i>Proactive AI Action Plan
                        </div>
                        <div class="small text-dark mb-2 fw-medium" style="font-size: 0.83rem; line-height: 1.5;">${escapeHtml(alert.recommended_action || 'Review resident feedback reports.')}</div>
                        <div class="small text-muted fst-italic" style="font-size: 0.75rem;">
                            <i class="fas fa-shield-alt me-1 text-success"></i>Resolution directly boosts Dorm Health Index.
                        </div>
                    </div>

                    <!-- Action Buttons -->
                    <div class="d-flex gap-2 flex-wrap mt-auto">
                        <button class="btn btn-sm text-white rounded-pill px-3 shadow-sm flex-fill" style="background: #1a1a2e; font-size: 0.78rem; font-weight: 600;" onclick="createWorkOrderFromAlert('${safeTopic}', '${safeAction}')">
                            <i class="fas fa-tools me-1"></i>Work Order
                        </button>
                        <button class="btn btn-sm btn-outline-dark rounded-pill px-3 shadow-sm flex-fill" style="font-size: 0.78rem; font-weight: 600;" onclick="openTenantNoticeModal('${safeTopic}')">
                            <i class="fas fa-bullhorn me-1"></i>Notice
                        </button>
                        <button class="btn btn-sm btn-success rounded-pill px-3 shadow-sm flex-fill" style="font-size: 0.78rem; font-weight: 600;" onclick="resolveTrendAlert(${alert.id}, '${safeTopic}')">
                            <i class="fas fa-check-circle me-1"></i>Resolve
                        </button>
                    </div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

// ── Resolved Interventions Log ──
async function loadResolvedAlerts() {
    const tbody = document.getElementById('resolvedAlertsTableBody');
    const badge = document.getElementById('resolvedAlertsBadge');
    if (!tbody) return;

    try {
        const res = await fetch('/api/admin/feedback/resolved-alerts', { credentials: 'include' });
        const data = await res.json();

        if (badge) badge.textContent = `${data ? data.length : 0} Resolved`;

        if (!data || data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" class="text-center py-4 text-muted" style="font-size:0.83rem;">No resolved interventions logged yet.</td></tr>`;
            return;
        }

        let html = '';
        data.forEach(item => {
            const d = item.resolved_at ? new Date(item.resolved_at) : new Date();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            const yy = String(d.getFullYear()).slice(-2);
            const resolvedDate = `${mm}/${dd}/${yy}`;

            html += `
                <tr style="border-bottom: 1px solid #f3f4f6;">
                    <td style="padding: 10px 6px;">
                        <strong style="color: #10b981; font-size: 0.83rem;"><i class="fas fa-check-circle me-1"></i>${escapeHtml(item.issue_topic)}</strong>
                    </td>
                    <td style="padding: 10px 6px;">
                        <div class="small text-dark" style="font-size: 0.8rem;">${escapeHtml(item.recommended_action || 'Action completed')}</div>
                    </td>
                    <td style="text-align: center; padding: 10px 6px; color: #6b7280; font-size: 0.78rem; white-space: nowrap;">
                        ${resolvedDate}
                    </td>
                </tr>
            `;
        });
        tbody.innerHTML = html;
    } catch (err) {
        console.error('[Feedback Module] Error loading resolved alerts:', err);
    }
}

// ── Resolve Trend Alert Action ──
function resolveTrendAlert(alertId, topic) {
    const executeResolve = async () => {
        try {
            const res = await fetch('/api/admin/feedback/resolve-alert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ alert_id: alertId }),
                credentials: 'include'
            });
            const data = await res.json();

            if (res.ok) {
                showFeedbackToast(`Resolved "${topic}"! Dorm Health Score boosted.`);
                loadAdminFeedback();
            } else {
                showFeedbackToast(data.error || 'Failed to resolve alert', 'error');
            }
        } catch (err) {
            console.error(err);
            showFeedbackToast('Error resolving alert', 'error');
        }
    };

    if (window.showEnterpriseConfirm) {
        window.showEnterpriseConfirm({
            title: 'Mark Alert as Resolved',
            message: `Mark "${topic}" trend alert as resolved? This will archive the trend and boost the Dorm Health Index.`,
            confirmText: 'Mark Resolved',
            confirmClass: 'btn-success',
            iconClass: 'fas fa-check-circle text-success',
            onConfirm: executeResolve
        });
    } else {
        if (confirm(`Mark "${topic}" trend alert as resolved? This will boost the Dorm Health Score.`)) {
            executeResolve();
        }
    }
}

// ── 1-Click Work Order Dispatcher ──
function createWorkOrderFromAlert(topic, action) {
    const executeCreate = async () => {
        try {
            const res = await fetch('/api/admin/feedback/create-work-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ issue_topic: topic, recommended_action: action }),
                credentials: 'include'
            });
            const data = await res.json();

            if (res.ok) {
                showFeedbackToast(data.message || 'Building Work Order created successfully!');
                if (typeof loadMaintenance === 'function') loadMaintenance();
            } else {
                showFeedbackToast(data.error || 'Failed to create work order', 'error');
            }
        } catch (err) {
            console.error(err);
            showFeedbackToast('Error creating work order', 'error');
        }
    };

    if (window.showEnterpriseConfirm) {
        window.showEnterpriseConfirm({
            title: 'Create Building Work Order',
            message: `Dispatch an official Building Work Order for "${topic}" to address this reported trend?`,
            confirmText: 'Dispatch Order',
            confirmClass: 'btn-primary',
            iconClass: 'fas fa-tools text-primary',
            onConfirm: executeCreate
        });
    } else {
        if (confirm(`Create a Building Work Order to resolve "${topic}"?`)) {
            executeCreate();
        }
    }
}

// ── 1-Click Tenant Notice Modal ──
function openTenantNoticeModal(topic) {
    const topicInput = document.getElementById('noticeTopic');
    const topicDisplay = document.getElementById('noticeTopicDisplay');
    const messageBody = document.getElementById('noticeMessageBody');

    if (topicInput) topicInput.value = topic;
    if (topicDisplay) topicDisplay.value = topic;
    if (messageBody) {
        messageBody.value = `Dear Residents,\n\nWe have received resident feedback regarding ${topic}. Our management and facilities team are actively addressing this matter to ensure a comfortable and secure living environment for everyone.\n\nThank you for your cooperation and patience.`;
    }

    const modalEl = document.getElementById('sendNoticeModal');
    if (modalEl && window.bootstrap) {
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
}

async function submitSendTenantNotice() {
    const topic = document.getElementById('noticeTopic')?.value;
    const body = document.getElementById('noticeMessageBody')?.value;

    if (!body || !body.trim()) {
        showFeedbackToast('Please enter a notice message before sending.', 'error');
        return;
    }

    try {
        const res = await fetch('/api/admin/feedback/send-notice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ topic, message_body: body }),
            credentials: 'include'
        });
        const data = await res.json();

        if (res.ok) {
            const modalEl = document.getElementById('sendNoticeModal');
            if (modalEl && window.bootstrap) {
                bootstrap.Modal.getInstance(modalEl)?.hide();
            }
            showFeedbackToast(data.message || 'Notice broadcasted to active tenants via email.');
        } else {
            showFeedbackToast(data.error || 'Failed to send notice', 'error');
        }
    } catch (err) {
        console.error(err);
        showFeedbackToast('Error sending notice', 'error');
    }
}

// ── Ask AI Resident Intelligence Assistant ──
function setAiQuery(query) {
    const input = document.getElementById('askAiQueryInput');
    if (input) {
        input.value = query;
        askAiAboutFeedback();
    }
}

async function askAiAboutFeedback() {
    const input = document.getElementById('askAiQueryInput');
    const responseBox = document.getElementById('askAiResponseBox');
    if (!input || !responseBox) return;

    const question = input.value.trim();
    if (!question) return;

    responseBox.style.display = 'block';
    responseBox.innerHTML = '<div class="d-flex align-items-center text-muted"><i class="fas fa-spinner fa-spin me-2" style="color: #c5a059;"></i>AI is analyzing resident feedback records...</div>';

    try {
        const res = await fetch('/api/admin/feedback/ask-ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question }),
            credentials: 'include'
        });
        const data = await res.json();

        if (res.ok) {
            responseBox.innerHTML = `
                <div class="d-flex align-items-start gap-2">
                    <i class="fas fa-robot mt-1 flex-shrink-0" style="color: #c5a059; font-size: 1.1rem;"></i>
                    <div>
                        <strong class="text-dark" style="font-size: 0.85rem;">Resident Intelligence Response:</strong>
                        <p class="mb-0 mt-1 text-secondary" style="font-size: 0.83rem; line-height: 1.6;">${escapeHtml(data.answer)}</p>
                    </div>
                </div>
            `;
        } else {
            responseBox.innerHTML = `<div class="text-danger small"><i class="fas fa-exclamation-circle me-1"></i>${escapeHtml(data.error || 'Failed to analyze feedback.')}</div>`;
        }
    } catch (err) {
        console.error(err);
        responseBox.innerHTML = '<div class="text-danger small"><i class="fas fa-exclamation-triangle me-1"></i>Error connecting to AI intelligence service.</div>';
    }
}

// ── Toast Notifications (Academic Standard: Zero Emojis) ──
function showFeedbackToast(message, type = 'success') {
    document.getElementById('fb-toast')?.remove();
    const bgColor = type === 'success'
        ? 'linear-gradient(135deg, #1a7a4a, #27ae60)'
        : 'linear-gradient(135deg, #8b1a1a, #e74c3c)';
    const icon = type === 'success'
        ? '<i class="fas fa-check"></i>'
        : '<i class="fas fa-times"></i>';

    const toast = document.createElement('div');
    toast.id = 'fb-toast';
    toast.style.cssText = `
        position: fixed;
        bottom: 32px;
        right: 32px;
        z-index: 99999;
        background: ${bgColor};
        color: #ffffff;
        padding: 14px 20px;
        border-radius: 8px;
        box-shadow: 0 8px 30px rgba(0,0,0,0.25);
        font-family: 'Inter', -apple-system, sans-serif;
        font-size: 0.9rem;
        display: flex;
        align-items: center;
        gap: 12px;
        max-width: 440px;
        line-height: 1.4;
        animation: fbToastIn 0.3s ease;
    `;
    toast.innerHTML = `
        <span style="width: 26px; height: 26px; border-radius: 50%; background: rgba(255,255,255,0.25); display: flex; align-items: center; justify-content: center; font-size: 0.8rem; flex-shrink: 0;">
            ${icon}
        </span>
        <span>${escapeHtml(message)}</span>
    `;

    if (!document.getElementById('fb-toast-style')) {
        const s = document.createElement('style');
        s.id = 'fb-toast-style';
        s.textContent = '@keyframes fbToastIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}@keyframes fbToastOut{from{opacity:1}to{opacity:0;transform:translateY(10px)}}';
        document.head.appendChild(s);
    }

    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'fbToastOut 0.35s ease forwards';
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

// ── Compatibility Forwarder ──
window.viewFeedbackDetails = function(id) {
    openFeedbackDetailModal(id);
};

// ── Expose Global APIs ──
window.loadAdminFeedback = loadAdminFeedback;
window.filterFeedback = filterFeedback;
window.filterFeedbackBySearch = filterFeedbackBySearch;
window.openFeedbackDetailModal = openFeedbackDetailModal;
window.createWorkOrderFromDetail = createWorkOrderFromDetail;
window.openNoticeFromDetail = openNoticeFromDetail;
window.createWorkOrderFromAlert = createWorkOrderFromAlert;
window.openTenantNoticeModal = openTenantNoticeModal;
window.submitSendTenantNotice = submitSendTenantNotice;
window.resolveTrendAlert = resolveTrendAlert;
window.setAiQuery = setAiQuery;
window.askAiAboutFeedback = askAiAboutFeedback;
window.showFeedbackToast = showFeedbackToast;

// ── Auto-Initialize on DOM Load ──
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => loadAdminFeedback());
} else {
    loadAdminFeedback();
}
