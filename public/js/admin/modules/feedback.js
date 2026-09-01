/**
 * js/admin/modules/feedback.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Upgraded Proactive AI Property Advisor for Tenant Feedback & AI Insights.
 * Includes closed-loop resolution tracking, smooth refresh animations, and full topic coverage.
 */

console.log('[Feedback Module] Script loaded successfully');

async function loadAdminFeedback(isUserRefresh = false) {
    console.log('[Feedback Module] loadAdminFeedback() called, isUserRefresh:', isUserRefresh);
    const tableBody = document.getElementById('adminFeedbackTableBody');
    console.log('[Feedback Module] tableBody element found:', !!tableBody);
    if (!tableBody) return;

    // Refresh animation feedback
    if (isUserRefresh) {
        showFeedbackToast('Refreshed Tenant Feedback & AI Insights');
    }

    try {
        console.log('[Feedback Module] Fetching /api/admin/feedback/all ...');
        const res = await fetch('/api/admin/feedback/all', { credentials: 'include' });
        console.log('[Feedback Module] Fetch response status:', res.status);
        if (!res.ok) throw new Error('Failed to fetch feedback, status: ' + res.status);
        const data = await res.json();
        console.log('[Feedback Module] Received', data.length, 'feedback records');
        renderAdminFeedback(data);
    } catch (err) {
        console.error('[Feedback Module] Error loading admin feedback:', err);
        tableBody.innerHTML = `<tr><td colspan="6" class="text-center text-danger">Error loading feedback data: ${err.message}</td></tr>`;
    }
    
    // Load companion AI insights components
    try { loadExecutiveSummary(); } catch(e) { console.error('[Feedback] Executive summary error:', e); }
    try { loadAdminAlerts(); } catch(e) { console.error('[Feedback] Alerts error:', e); }
    try { loadChurnRisk(); } catch(e) { console.error('[Feedback] Churn risk error:', e); }
    try { loadResolvedAlerts(); } catch(e) { console.error('[Feedback] Resolved alerts error:', e); }
}

async function loadExecutiveSummary() {
    try {
        const res = await fetch('/api/admin/feedback/executive-summary', { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();

        const scoreEl = document.getElementById('feedbackHealthScore');
        const barEl = document.getElementById('feedbackHealthBar');
        const avgEl = document.getElementById('feedbackAvgSentiment');
        const netEl = document.getElementById('feedbackNetRatio');
        const summaryList = document.getElementById('feedbackExecSummary');

        if (scoreEl) scoreEl.textContent = data.healthScore;
        if (barEl) {
            barEl.style.width = `${data.healthScore}%`;
            barEl.className = `progress-bar ${data.healthScore >= 75 ? 'bg-success' : (data.healthScore >= 50 ? 'bg-warning' : 'bg-danger')}`;
        }
        if (avgEl) avgEl.textContent = data.avgSentimentScore;
        if (netEl) netEl.textContent = `${data.positiveCount} Pos / ${data.negativeCount} Neg`;

        if (summaryList && data.executiveSummary) {
            summaryList.innerHTML = data.executiveSummary.map(bullet => `<li class="mb-1">${bullet}</li>`).join('');
        }
    } catch (err) {
        console.error('Error loading executive summary:', err);
    }
}

async function loadChurnRisk() {
    const tbody = document.getElementById('churnRiskTableBody');
    const badge = document.getElementById('churnRiskBadge');
    if (!tbody) return;

    try {
        const res = await fetch('/api/admin/feedback/churn-risk', { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to fetch churn risk');
        const data = await res.json();

        if (badge) badge.textContent = `${data.length} Flagged`;

        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center py-3 text-success"><i class="fas fa-check-circle me-1"></i> No high-risk tenant churn detected. Resident retention is healthy.</td></tr>`;
            return;
        }

        tbody.innerHTML = data.map(item => {
            const riskClass = item.riskLevel === 'HIGH' ? 'bg-danger' : 'bg-warning text-dark';
            return `
                <tr>
                    <td>
                        <strong>${item.tenant_name}</strong>
                        <div class="small text-muted">${item.room_number || 'Unassigned'}</div>
                    </td>
                    <td><span class="badge bg-light text-dark border">${item.negative_feedback_count} complaint(s)</span></td>
                    <td>
                        <span class="badge ${riskClass} fw-bold">${item.riskLevel} (${item.riskPct}%)</span>
                    </td>
                    <td>
                        <div class="small text-truncate" style="max-width:240px;" title="${item.latest_issue_summary}">${item.latest_issue_summary || 'Multiple negative reports'}</div>
                    </td>
                    <td>
                        <div class="small text-primary fw-semibold"><i class="fas fa-lightbulb me-1 text-warning"></i>${item.recommendation}</div>
                    </td>
                </tr>
            `;
        }).join('');

    } catch (err) {
        console.error('Error loading churn risk:', err);
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">Unable to calculate churn risk.</td></tr>`;
    }
}

async function loadAdminAlerts() {
    const container = document.getElementById('alertsList');
    if (!container) return;

    try {
        const res = await fetch('/api/admin/feedback/alerts', { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to fetch alerts');
        const data = await res.json();

        renderAdminAlerts(data);
    } catch (err) {
        console.error('Error loading admin alerts:', err);
        container.innerHTML = `<div class="col-12"><div class="alert alert-danger">Error loading AI alerts.</div></div>`;
    }
}

function renderAdminAlerts(data) {
    const container = document.getElementById('alertsList');
    if (data.length === 0) {
        container.innerHTML = `
            <div class="col-12">
                <div class="alert alert-success border-0 shadow-sm rounded-4 d-flex align-items-center mb-0">
                    <i class="fas fa-check-circle me-3 fa-2x"></i>
                    <div>
                        <div class="fw-bold">All Quiet & Healthy</div>
                        <div class="small">No unresolved active trend alerts detected by AI in the dormitory.</div>
                    </div>
                </div>
            </div>
        `;
        return;
    }

    // Helper to safely escape strings for HTML onclick attributes
    function escAttr(str) {
        return (str || '').replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    let html = '';
    data.forEach(alert => {
        const severityClass = alert.alert_severity === 'High' ? 'danger' : (alert.alert_severity === 'Medium' ? 'warning' : 'info');
        const icon = alert.alert_severity === 'High' ? 'fire' : 'chart-line';
        const safeTopic = escAttr(alert.issue_topic);
        const safeAction = escAttr(alert.recommended_action);

        const rawScore = parseFloat(alert.avg_sentiment_score);
        const scoreFormatted = isNaN(rawScore) ? 'N/A' : (rawScore > 0 ? '+' + rawScore.toFixed(2) : rawScore.toFixed(2));

        html += `
            <div class="col-md-6">
                <div class="card border-0 shadow-sm rounded-4 h-100 bg-${severityClass} bg-opacity-10" style="border-left: 5px solid var(--bs-${severityClass}) !important;">
                    <div class="card-body p-4">
                        <div class="d-flex justify-content-between mb-3">
                            <span class="badge bg-${severityClass} text-uppercase small">${alert.alert_severity} PRIORITY</span>
                            <small class="text-muted"><i class="fas fa-clock me-1"></i> Active Trend</small>
                        </div>
                        <h5 class="fw-bold mb-2"><i class="fas fa-${icon} me-2 text-${severityClass}"></i> Trend: ${alert.issue_topic}</h5>
                        <p class="small text-muted mb-3">Detected <strong>${alert.negative_count} complaints</strong> with an average sentiment score of <strong>${scoreFormatted}</strong>.</p>
                        
                        <!-- AI Proactive Action Plan Box -->
                        <div class="bg-white p-3 rounded-3 border mb-3">
                            <div class="small fw-bold text-uppercase text-primary mb-1"><i class="fas fa-robot me-1 text-warning"></i>Proactive Action Plan</div>
                            <div class="small text-dark mb-2">${alert.recommended_action}</div>
                            <div class="small text-muted fst-italic" style="font-size:0.78rem;">
                                <i class="fas fa-shield-alt me-1 text-success"></i>Prevention Impact: Resolving this trend improves resident satisfaction.
                            </div>
                        </div>

                        <!-- Action Buttons -->
                        <div class="d-flex gap-2 flex-wrap">
                            <button class="btn btn-sm btn-primary rounded-pill shadow-sm flex-fill" onclick="createWorkOrderFromAlert('${safeTopic}', '${safeAction}')">
                                <i class="fas fa-tools me-1"></i>Work Order
                            </button>
                            <button class="btn btn-sm btn-outline-dark rounded-pill shadow-sm flex-fill" onclick="openTenantNoticeModal('${safeTopic}')">
                                <i class="fas fa-envelope me-1"></i>Notice
                            </button>
                            <button class="btn btn-sm btn-success rounded-pill shadow-sm flex-fill" onclick="resolveTrendAlert(${alert.id}, '${safeTopic}')">
                                <i class="fas fa-check-circle me-1"></i>Mark Resolved
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

async function loadResolvedAlerts() {
    const container = document.getElementById('resolvedAlertsContainer');
    if (!container) return;

    try {
        const res = await fetch('/api/admin/feedback/resolved-alerts', { credentials: 'include' });
        const data = await res.json();

        if (!data || data.length === 0) {
            container.innerHTML = `<div class="text-muted small">No resolved trend alerts recorded yet.</div>`;
            return;
        }

        let html = '<div class="list-group list-group-flush">';
        data.forEach(item => {
            const resolvedDate = item.resolved_at ? new Date(item.resolved_at).toLocaleDateString() : 'Recently';
            html += `
                <div class="list-group-item bg-transparent px-0 py-2 d-flex justify-content-between align-items-center">
                    <div>
                        <strong class="text-success"><i class="fas fa-check-circle me-1"></i> ${escAttr(item.issue_topic)}</strong>
                        <div class="small text-muted">${escAttr(item.recommended_action || 'Resolved')}</div>
                    </div>
                    <span class="badge bg-secondary rounded-pill">${resolvedDate}</span>
                </div>
            `;
        });
        html += '</div>';
        container.innerHTML = html;
    } catch (err) {
        console.error('Error loading resolved alerts:', err);
    }
}

async function resolveTrendAlert(alertId, topic) {
    if (!confirm(`Mark "${topic}" trend alert as resolved? This will boost the Dorm Health Score.`)) return;

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
}

function renderAdminFeedback(data) {
    const tableBody = document.getElementById('adminFeedbackTableBody');
    if (data.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">No tenant feedback found.</td></tr>`;
        return;
    }

    let html = '';
    data.forEach(item => {
        const sentimentColor = getSentimentColor(item.ai_sentiment);
        const date = new Date(item.created_at).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });

        html += `
            <tr>
                <td class="small text-muted">${date}</td>
                <td>
                    <div class="fw-bold">${item.tenant_name}</div>
                    <div class="small text-muted">${item.room_number || 'No Room'}</div>
                </td>
                <td style="max-width: 300px;">
                    <div class="text-truncate-2" title="${item.feedback_text}">${item.feedback_text}</div>
                </td>
                <td>
                    <span class="badge" style="background-color: ${sentimentColor}15; color: ${sentimentColor}; border: 1px solid ${sentimentColor}30;">
                        ${item.ai_sentiment || 'Neutral'}
                    </span>
                    ${item.ai_needs_attention ? '<i class="fas fa-exclamation-circle text-danger ms-1" title="Needs Attention"></i>' : ''}
                </td>
                <td class="small">
                    <div class="text-muted fst-italic">${item.ai_summary || 'N/A'}</div>
                </td>
                <td>
                    <button class="btn btn-sm btn-light border rounded-pill" onclick="viewFeedbackDetails(${item.id})">
                        Details
                    </button>
                </td>
            </tr>
        `;
    });

    tableBody.innerHTML = html;
}

function getSentimentColor(sentiment) {
    switch (sentiment) {
        case 'Positive': return '#198754';
        case 'Negative': return '#dc3545';
        case 'Mixed': return '#ffc107';
        default: return '#6c757d';
    }
}

// ── 1-Click Work Order Handler ──
async function createWorkOrderFromAlert(topic, action) {
    if (!confirm(`Create a Building Work Order to resolve "${topic}"?`)) return;

    try {
        const res = await fetch('/api/admin/feedback/create-work-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ issue_topic: topic, recommended_action: action }),
            credentials: 'include'
        });
        const data = await res.json();

        if (res.ok) {
            showFeedbackToast(data.message || 'Building Work Order created!');
            if (typeof loadMaintenance === 'function') loadMaintenance();
        } else {
            showFeedbackToast(data.error || 'Failed to create work order', 'error');
        }
    } catch (err) {
        console.error(err);
        showFeedbackToast('Error creating work order', 'error');
    }
}

// ── 1-Click Tenant Notice Modal ──
function openTenantNoticeModal(topic) {
    document.getElementById('noticeTopic').value = topic;
    document.getElementById('noticeTopicDisplay').value = topic;
    document.getElementById('noticeMessageBody').value = `We have received resident reports regarding ${topic}. Our management team is currently addressing this issue to ensure a comfortable living experience for all residents. Thank you for your patience!`;
    new bootstrap.Modal(document.getElementById('sendNoticeModal')).show();
}

async function submitSendTenantNotice() {
    const topic = document.getElementById('noticeTopic').value;
    const body = document.getElementById('noticeMessageBody').value;

    if (!body || !body.trim()) return alert('Please enter a notice message.');

    try {
        const res = await fetch('/api/admin/feedback/send-notice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ topic, message_body: body }),
            credentials: 'include'
        });
        const data = await res.json();

        if (res.ok) {
            bootstrap.Modal.getInstance(document.getElementById('sendNoticeModal')).hide();
            showFeedbackToast(data.message || 'Notice sent to active tenants!');
        } else {
            showFeedbackToast(data.error || 'Failed to send notice', 'error');
        }
    } catch (err) {
        console.error(err);
        showFeedbackToast('Error sending notice', 'error');
    }
}

// ── Ask AI Feedback Query ──
async function askAiAboutFeedback() {
    const input = document.getElementById('askAiQueryInput');
    const responseBox = document.getElementById('askAiResponseBox');
    if (!input || !responseBox) return;

    const question = input.value.trim();
    if (!question) return;

    responseBox.style.display = 'block';
    responseBox.innerHTML = '<i class="fas fa-spinner fa-spin text-primary me-2"></i>AI is analyzing resident feedback records...';

    try {
        const res = await fetch('/api/admin/feedback/ask-ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question }),
            credentials: 'include'
        });
        const data = await res.json();

        if (res.ok) {
            responseBox.innerHTML = `<div class="d-flex align-items-start"><i class="fas fa-robot text-warning me-2 mt-1 fs-5"></i><div><strong>AI Advisor Response:</strong><p class="mb-0 mt-1">${data.answer}</p></div></div>`;
        } else {
            responseBox.innerHTML = `<span class="text-danger">${data.error || 'Failed to analyze feedback.'}</span>`;
        }
    } catch (err) {
        console.error(err);
        responseBox.innerHTML = '<span class="text-danger">Error connecting to AI service.</span>';
    }
}

// ── Toast Notifications ──
function showFeedbackToast(message, type = 'success') {
    document.getElementById('fb-toast')?.remove();
    const bg = type === 'success' ? 'linear-gradient(135deg,#1a7a4a,#27ae60)' : 'linear-gradient(135deg,#8b1a1a,#e74c3c)';
    const icon = type === 'success' ? '✓' : '✕';
    const toast = document.createElement('div');
    toast.id = 'fb-toast';
    toast.style.cssText = `position:fixed;bottom:32px;right:32px;z-index:99999;background:${bg};color:#fff;padding:14px 22px;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,0.35);font-size:0.9rem;display:flex;align-items:center;gap:10px;animation:toastIn 0.35s ease;`;
    toast.innerHTML = `<span style="width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,0.25);display:flex;align-items:center;justify-content:center;font-weight:bold;">${icon}</span><span>${message}</span>`;
    if (!document.getElementById('fb-toast-style')) {
        const s = document.createElement('style');
        s.id = 'fb-toast-style';
        s.textContent = '@keyframes toastIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}';
        document.head.appendChild(s);
    }
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

// Global viewer function
window.viewFeedbackDetails = function(id) {
    alert('Feedback record #' + id + ' details loaded.');
};

// Auto-initialize feedback data on module load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => loadAdminFeedback());
} else {
    loadAdminFeedback();
}
