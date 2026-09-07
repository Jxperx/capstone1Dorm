/**
 * js/admin/modules/feedback.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Tenant Feedback & AI Insights Admin Module (Version 2: Tri-Column Streamlined)
 * Primary View: 3-Column Urgency / Sentiment Board matching Maintenance Requests.
 * Active Trend Alerts & Proactive Action Plans are embedded directly inside feedbacks.
 * Academic Standard: Strictly ZERO emojis across all components, modals, and toasts.
 * ─────────────────────────────────────────────────────────────────────────────
 */

console.log('[Feedback Module] Script loaded successfully (v2.1 Tri-Column)');

// ── Module State ──
let allFeedbackRecords = [];
let activeAlertsData = [];
let churnRiskData = [];
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
async function loadAdminFeedback(isUserRefresh = false, retryCount = 0) {
    const boardEl = document.getElementById('feedbackUrgencyBoard');
    if (!boardEl) return;

    if (isUserRefresh) {
        showFeedbackToast('Refreshed Tenant Feedback & AI Insights');
    }

    try {
        let feedbackJson = [];
        let alertsJson = [];
        let churnJson = [];
        let summaryJson = null;

        // Try single bundled request first (fastest, prevents connection pool starvation)
        let bundleSuccess = false;
        try {
            const bundleRes = await fetch('/api/admin/feedback/bundle', { credentials: 'include' });
            if (bundleRes.ok) {
                const bundleData = await bundleRes.json();
                feedbackJson = bundleData.feedbacks || [];
                alertsJson = bundleData.alerts || [];
                churnJson = bundleData.churnRisk || [];
                summaryJson = bundleData.summary || null;
                bundleSuccess = true;
            }
        } catch (e) {
            console.warn('[Feedback Module] Bundle fetch failed, falling back to separate calls:', e.message);
        }

        if (!bundleSuccess) {
            const [feedbackRes, alertsRes, churnRes, summaryRes] = await Promise.all([
                fetch('/api/admin/feedback/all', { credentials: 'include' }),
                fetch('/api/admin/feedback/alerts', { credentials: 'include' }),
                fetch('/api/admin/feedback/churn-risk', { credentials: 'include' }),
                fetch('/api/admin/feedback/executive-summary', { credentials: 'include' })
            ]);

            if (!feedbackRes.ok) throw new Error('Failed to fetch feedback records');

            feedbackJson = await feedbackRes.json();
            alertsJson = alertsRes.ok ? await alertsRes.json() : [];
            churnJson = churnRes.ok ? await churnRes.json() : [];
            summaryJson = summaryRes.ok ? await summaryRes.json() : null;
        }

        activeAlertsData = Array.isArray(alertsJson) ? alertsJson : [];
        churnRiskData = Array.isArray(churnJson) ? churnJson : [];

        // Correlate feedbacks with active alerts and churn risks
        allFeedbackRecords = (Array.isArray(feedbackJson) ? feedbackJson : []).map(fb => {
            // Check for churn risk match
            const churnMatch = churnRiskData.find(c => 
                (fb.tenant_id && c.tenant_id && fb.tenant_id === c.tenant_id) ||
                (fb.tenant_name && c.tenant_name && fb.tenant_name.toLowerCase() === c.tenant_name.toLowerCase())
            );
            if (churnMatch) {
                fb._churnRisk = churnMatch.riskPct || 75;
                fb._churnRecommendation = churnMatch.recommendation || 'Direct resident outreach recommended';
            }

            // Check for active trend alert match
            const searchStr = `${fb.feedback_text || ''} ${fb.category || ''} ${fb.ai_summary || ''} ${JSON.stringify(fb.ai_topics || '')} ${JSON.stringify(fb.ai_keywords || '')}`.toLowerCase();
            const alertMatch = activeAlertsData.find(a => {
                const topic = (a.issue_topic || '').toLowerCase();
                if (!topic) return false;
                if (topic.includes('wifi') || topic.includes('internet')) {
                    return searchStr.includes('wifi') || searchStr.includes('internet') || searchStr.includes('connection');
                }
                if (topic.includes('noise')) {
                    return searchStr.includes('noise') || searchStr.includes('quiet') || searchStr.includes('party') || searchStr.includes('loud');
                }
                if (topic.includes('plumb') || topic.includes('leak') || topic.includes('sink')) {
                    return searchStr.includes('plumb') || searchStr.includes('leak') || searchStr.includes('sink') || searchStr.includes('water');
                }
                if (topic.includes('clean') || topic.includes('trash')) {
                    return searchStr.includes('clean') || searchStr.includes('trash') || searchStr.includes('dirty');
                }
                return searchStr.includes(topic);
            });

            if (alertMatch) {
                fb._correlatedAlert = alertMatch;
            }

            return fb;
        });

        // Update 4-Card Luxury KPI Ribbon
        updateKpiRibbon(allFeedbackRecords, activeAlertsData, churnRiskData, summaryJson);

        // Apply filters and render the 3-column board
        applyFiltersAndRender();

    } catch (err) {
        console.error('[Feedback Module] Error loading feedback:', err);
        // Automatic retry once after 1.2 seconds on transient error
        if (retryCount === 0) {
            console.log('[Feedback Module] Retrying load in 1.2s...');
            setTimeout(() => loadAdminFeedback(false, 1), 1200);
            return;
        }

        // If we already have loaded records, keep displaying them
        if (allFeedbackRecords && allFeedbackRecords.length > 0) {
            applyFiltersAndRender();
            return;
        }

        const errHtml = `<tr><td colspan="4" class="text-center py-4 text-danger">Error loading data: ${escapeHtml(err.message)}</td></tr>`;
        const b1 = document.getElementById('fb-attention-body');
        const b2 = document.getElementById('fb-neutral-body');
        const b3 = document.getElementById('fb-positive-body');
        if (b1) b1.innerHTML = errHtml;
        if (b2) b2.innerHTML = errHtml;
        if (b3) b3.innerHTML = errHtml;
    }
}

// ── Update 4-Card Luxury KPI Strip ──
function updateKpiRibbon(feedbacks, alerts, churnList, summary) {
    // 1. Dorm Health Index
    const healthScore = summary && summary.healthScore !== undefined ? summary.healthScore : 88;
    const scoreEl = document.getElementById('feedbackHealthScore');
    if (scoreEl) scoreEl.textContent = healthScore;

    const captionEl = document.getElementById('feedbackHealthCaption');
    if (captionEl) {
        if (healthScore >= 75) captionEl.textContent = 'High Resident Satisfaction';
        else if (healthScore >= 50) captionEl.textContent = 'Moderate Satisfaction';
        else captionEl.textContent = 'Attention Required';
    }

    // 2. Positive Sentiment Ratio
    const positiveCount = feedbacks.filter(f => (f.ai_sentiment || '').toLowerCase() === 'positive').length;
    const attentionCount = feedbacks.filter(f => !f.is_resolved && ((f.ai_sentiment || '').toLowerCase() === 'negative' || f.ai_needs_attention)).length;
    const total = positiveCount + attentionCount;
    const positivePct = total > 0 ? Math.round((positiveCount / total) * 100) : (summary?.positiveCount ? 16 : 0);

    const rateEl = document.getElementById('feedbackPositiveRate');
    if (rateEl) rateEl.textContent = `${positivePct}%`;

    const netEl = document.getElementById('feedbackNetRatio');
    if (netEl) netEl.textContent = `${positiveCount} Pos / ${attentionCount} Action Required`;

    // 3. Active Trend Alerts
    const alertsCountEl = document.getElementById('feedbackActiveAlertsCount');
    if (alertsCountEl) alertsCountEl.textContent = alerts.length;

    const alertsCaptionEl = document.getElementById('feedbackActiveAlertsCaption');
    if (alertsCaptionEl) {
        if (alerts.length > 0) {
            const topTopics = alerts.slice(0, 3).map(a => a.issue_topic.split(' ')[0]).join(', ');
            alertsCaptionEl.textContent = topTopics;
        } else {
            alertsCaptionEl.textContent = 'All Trends Resolved';
        }
    }

    // 4. Churn Radar
    const churnCountEl = document.getElementById('feedbackChurnCount');
    if (churnCountEl) churnCountEl.textContent = `${churnList.length} Flagged`;
}

// ── Search & Filter Logic ──
function filterFeedbackBySearch() {
    applyFiltersAndRender();
}

function filterFeedback(filterValue, btnEl) {
    currentFeedbackFilter = filterValue;

    // Update active button styling
    document.querySelectorAll('#feedbackFilters .fb-filter-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.classList.remove('btn-dark');
        btn.classList.remove('text-white');
        btn.style.background = '';
        btn.style.color = '';
        btn.style.borderColor = '';
    });

    if (btnEl) {
        btnEl.classList.add('active');
        btnEl.style.background = '#1a1a2e';
        btnEl.style.color = '#ffffff';
        btnEl.style.borderColor = '#1a1a2e';
    }

    applyFiltersAndRender();
}

function applyFiltersAndRender() {
    const searchVal = (document.getElementById('feedbackSearchInput')?.value || '').trim().toLowerCase();

    // Filter master array
    const filtered = allFeedbackRecords.filter(item => {
        // 1. Filter pill criteria
        if (currentFeedbackFilter === 'needs_attention') {
            if (item.is_resolved || ((item.ai_sentiment || '').toLowerCase() !== 'negative' && !item.ai_needs_attention)) return false;
        } else if (currentFeedbackFilter === 'neutral') {
            if (item.is_resolved || (item.ai_sentiment || '').toLowerCase() !== 'neutral' || item.ai_needs_attention) return false;
        } else if (currentFeedbackFilter === 'positive') {
            if (item.is_resolved || (item.ai_sentiment || '').toLowerCase() !== 'positive') return false;
        } else if (currentFeedbackFilter === 'resolved') {
            if (!item.is_resolved) return false;
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

        // 2. Text Search matching
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

    // Partition into 3 columns
    let attentionList = [];
    let neutralList = [];
    let positiveList = [];

    if (currentFeedbackFilter === 'resolved') {
        // Explicit Resolved filter: Show all resolved historical feedback
        attentionList = filtered.filter(f => f.is_resolved && ((f.ai_sentiment || '').toLowerCase() === 'negative' || f.ai_needs_attention));
        neutralList = filtered.filter(f => f.is_resolved && (f.ai_sentiment || '').toLowerCase() === 'neutral');
        positiveList = filtered.filter(f => f.is_resolved && (f.ai_sentiment || '').toLowerCase() === 'positive');
    } else {
        // Active operational queue (ALL, needs_attention, neutral, or topic filters):
        // Resolved items disappear from active queue and are archived to Reports & Analytics.
        attentionList = filtered.filter(f => !f.is_resolved && ((f.ai_sentiment || '').toLowerCase() === 'negative' || f.ai_needs_attention));
        neutralList = filtered.filter(f => !f.is_resolved && (f.ai_sentiment || '').toLowerCase() === 'neutral' && !f.ai_needs_attention);
        positiveList = filtered.filter(f => !f.is_resolved && (f.ai_sentiment || '').toLowerCase() === 'positive');
    }

    // Sort by date descending
    attentionList.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    neutralList.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    positiveList.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Render each column table
    renderColumnTable('fb-attention-body', attentionList, 'attention');
    renderColumnTable('fb-neutral-body', neutralList, 'neutral');
    renderColumnTable('fb-positive-body', positiveList, 'positive');

    // Update column badge counts
    const cAttention = document.getElementById('fb-count-attention');
    const cNeutral = document.getElementById('fb-count-neutral');
    const cPositive = document.getElementById('fb-count-positive');

    if (cAttention) cAttention.textContent = attentionList.length;
    if (cNeutral) cNeutral.textContent = neutralList.length;
    if (cPositive) cPositive.textContent = positiveList.length;
}

// ── Render Column Table Rows (Room Management & Maintenance Design) ──
function renderColumnTable(tbodyId, list, type) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;

    if (list.length === 0) {
        let iconHtml = '<i class="fas fa-search me-2"></i>';
        let emptyLabel = 'No feedback records in this category.';
        if (type === 'attention') {
            if (currentFeedbackFilter === 'resolved') {
                emptyLabel = 'No resolved complaints found.';
            } else {
                iconHtml = '<i class="fas fa-check-circle text-success me-2"></i>';
                emptyLabel = 'All issues resolved. No pending action required.';
            }
        } else if (type === 'neutral') {
            if (currentFeedbackFilter === 'resolved') {
                emptyLabel = 'No resolved inquiries found.';
            } else {
                iconHtml = '<i class="fas fa-check-circle text-success me-2"></i>';
                emptyLabel = 'No pending inquiries requiring review.';
            }
        } else if (type === 'positive') {
            emptyLabel = 'No positive commendations recorded.';
        }
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="text-center py-4 text-muted" style="font-size: 0.83rem;">
                    ${iconHtml}${emptyLabel}
                </td>
            </tr>
        `;
        return;
    }

    let html = '';
    list.forEach(item => {
        // Date format MM/DD/YY
        const d = new Date(item.created_at);
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const yy = String(d.getFullYear()).slice(-2);
        const dateFormatted = `${mm}/${dd}/${yy}`;

        // Unit Text & Churn Risk Badge
        const unitLabel = item.room_number ? `Unit ${escapeHtml(item.room_number)}` : 'Unassigned';
        const churnBadge = item._churnRisk
            ? `<div class="mt-1"><span class="badge rounded-pill" style="background:#fee2e2;color:#ef4444;font-size:0.65rem;padding:2px 6px;">Churn: ${item._churnRisk}%</span></div>`
            : '';

        // Feedback Quote & Correlated Trend Indicator
        const quoteText = escapeHtml(item.feedback_text || '');
        let trendIndicator = '';
        if (item._correlatedAlert) {
            trendIndicator = `<div class="small text-danger mt-1 text-truncate" style="font-size:0.7rem; max-width: 140px;"><i class="fas fa-chart-line me-1"></i>Trend: ${escapeHtml(item._correlatedAlert.issue_topic)}</div>`;
        } else if (item.category) {
            trendIndicator = `<div class="small text-muted mt-1 text-truncate" style="font-size:0.7rem; max-width: 140px;">${escapeHtml(item.category)}</div>`;
        }

        // Status Badge per column
        let statusBadge;
        if (item.is_resolved) {
            statusBadge = '<span class="badge rounded-pill" style="background:#e8f8f0;color:#10b981;font-weight:600;padding:6px 10px;font-size:0.75rem;">Resolved</span>';
        } else if (type === 'attention') {
            statusBadge = '<span class="badge rounded-pill" style="background:#fee2e2;color:#ef4444;font-weight:600;padding:6px 10px;font-size:0.75rem;">Action Needed</span>';
        } else if (type === 'neutral') {
            statusBadge = '<span class="badge rounded-pill" style="background:#fef3c7;color:#92400e;font-weight:600;padding:6px 10px;font-size:0.75rem;">Under Review</span>';
        } else {
            statusBadge = '<span class="badge rounded-pill" style="background:#e8f8f0;color:#10b981;font-weight:600;padding:6px 10px;font-size:0.75rem;">Commended</span>';
        }

        html += `
            <tr style="cursor: pointer; transition: background-color 0.15s ease;"
                onclick="openFeedbackDetailModal(${item.id})"
                class="align-middle"
                title="Click to view tenant details and AI proactive action plan">
                <td style="color: #6b7280; font-size: 0.8rem; font-weight: 500; padding: 12px 6px; vertical-align: middle; white-space: nowrap;">
                    ${dateFormatted}
                </td>
                <td style="font-weight: 700; color: #1a1a2e; font-size: 0.85rem; padding: 12px 6px; vertical-align: middle;">
                    <strong>${unitLabel}</strong>
                    ${churnBadge}
                </td>
                <td style="color: #1a1a2e; font-weight: 500; font-size: 0.83rem; padding: 12px 6px; vertical-align: middle;">
                    <div class="text-truncate" style="max-width: 140px;" title="${quoteText}">
                        "${quoteText}"
                    </div>
                    ${trendIndicator}
                </td>
                <td class="text-center" style="padding: 12px 6px; vertical-align: middle; white-space: nowrap;">
                    ${statusBadge}
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

// ── Open Centered Detail Modal (With Embedded AI Action Plan) ──
function openFeedbackDetailModal(id) {
    const item = allFeedbackRecords.find(r => r.id === id);
    if (!item) return;

    selectedFeedbackRecord = item;

    // 1. Resident & Room Profile
    const nameEl = document.getElementById('feedbackDetailTenantName');
    const emailEl = document.getElementById('feedbackDetailEmail');
    const phoneEl = document.getElementById('feedbackDetailPhone');
    const roomEl = document.getElementById('feedbackDetailRoomNumber');
    const categoryEl = document.getElementById('feedbackDetailCategoryBadge');

    if (nameEl) nameEl.textContent = item.tenant_name || 'Anonymous Resident';
    if (emailEl) emailEl.textContent = item.email || 'No email registered';
    if (phoneEl) phoneEl.textContent = item.phone_number || 'No phone registered';
    if (roomEl) roomEl.textContent = item.room_number ? `Unit ${item.room_number}` : 'Unassigned Unit';
    if (categoryEl) categoryEl.textContent = item.category ? `Category: ${item.category}` : 'General Observation';

    // 2. Meta Date & Sentiment Badges
    const d = new Date(item.created_at);
    const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const metaEl = document.getElementById('feedbackDetailMeta');
    if (metaEl) metaEl.textContent = `Submitted on ${dateStr}`;

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

    const attBadge = document.getElementById('feedbackDetailAttentionBadge');
    if (attBadge) {
        attBadge.style.display = (!item.is_resolved && item.ai_needs_attention) ? 'inline-block' : 'none';
        if (!item.is_resolved && item.ai_needs_attention) {
            attBadge.className = 'badge rounded-pill';
            attBadge.style.cssText = 'background:#fee2e2;color:#ef4444;font-weight:600;padding:6px 14px;font-size:0.75rem;';
        }
    }

    const resBadge = document.getElementById('feedbackDetailResolvedBadge');
    if (resBadge) {
        resBadge.style.display = item.is_resolved ? 'inline-block' : 'none';
        if (item.is_resolved) {
            resBadge.className = 'badge rounded-pill';
            resBadge.style.cssText = 'background:#e8f8f0;color:#10b981;font-weight:600;padding:6px 14px;font-size:0.75rem;';
            resBadge.textContent = 'Resolved';
        }
    }

    // 3. In-Modal Churn Risk Badge
    const churnBadge = document.getElementById('feedbackDetailChurnBadge');
    if (churnBadge) {
        if (!item.is_resolved && item._churnRisk) {
            churnBadge.style.display = 'inline-block';
            churnBadge.textContent = `Churn Risk: ${item._churnRisk}%`;
        } else {
            churnBadge.style.display = 'none';
        }
    }

    // 4. Complete Feedback Quote
    const quoteEl = document.getElementById('feedbackDetailQuote');
    if (quoteEl) quoteEl.textContent = `"${item.feedback_text || ''}"`;

    // 5. EMBEDDED AI ACTIVE TREND ALERT & ACTION PLAN
    const trendBadge = document.getElementById('feedbackDetailTrendBadge');
    const trendDesc = document.getElementById('feedbackDetailTrendDesc');
    const actionPlan = document.getElementById('feedbackDetailActionPlan');
    const impactEl = document.getElementById('feedbackDetailImpact');
    const resolveBtn = document.getElementById('feedbackDetailResolveBtn');
    const reopenBtn = document.getElementById('feedbackDetailReopenBtn');

    if (item.is_resolved) {
        if (trendBadge) {
            trendBadge.textContent = 'Resolved Concern';
            trendBadge.className = 'badge bg-success text-white border fw-bold';
        }
        if (trendDesc) {
            trendDesc.textContent = item.ai_summary || `Feedback regarding ${item.category || 'dorm services'}. This matter has been marked as resolved by management.`;
        }
        if (actionPlan) {
            actionPlan.textContent = 'Action item marked as resolved by dormitory management.';
        }
        if (impactEl) {
            impactEl.textContent = 'Resolution logged in the dormitory management register.';
        }
        if (resolveBtn) resolveBtn.style.display = 'none';
        if (reopenBtn) {
            reopenBtn.style.display = 'inline-block';
            reopenBtn.disabled = false;
            reopenBtn.innerHTML = '<i class="fas fa-undo me-1"></i>Reopen Issue';
        }
    } else if (item._correlatedAlert) {
        const a = item._correlatedAlert;
        if (trendBadge) {
            trendBadge.textContent = `Active Trend: ${a.issue_topic} (${a.negative_count || 0} complaints)`;
            trendBadge.className = 'badge bg-danger text-white border fw-bold';
        }
        if (trendDesc) {
            trendDesc.textContent = `AI correlated this feedback with active trend '${a.issue_topic}'. Multiple residents have logged similar reports with negative sentiment score of ${a.avg_sentiment_score || 'N/A'}.`;
        }
        if (actionPlan) {
            actionPlan.textContent = a.recommended_action || 'Dispatch building technician or broadcast notice to affected residents.';
        }
        if (impactEl) {
            impactEl.textContent = `Resolving this action item closes the '${a.issue_topic}' active trend alert and directly boosts the Dorm Health Index.`;
        }
        if (reopenBtn) reopenBtn.style.display = 'none';
        if (resolveBtn) {
            resolveBtn.style.display = 'inline-block';
            resolveBtn.disabled = false;
            resolveBtn.innerHTML = '<i class="fas fa-check-circle me-1"></i>Mark Resolved';
        }
    } else {
        if (trendBadge) {
            trendBadge.textContent = 'Individual Observation';
            trendBadge.className = 'badge bg-light text-dark border fw-bold';
        }
        if (trendDesc) {
            trendDesc.textContent = item.ai_summary || `Single resident submission regarding ${item.category || 'dorm services'}. No active trend alert triggered.`;
        }
        if (actionPlan) {
            actionPlan.textContent = item._churnRecommendation || 'Review feedback report and maintain proactive communication with the resident.';
        }
        if (impactEl) {
            impactEl.textContent = 'Addressing resident inquiries preserves high retention and community satisfaction.';
        }
        if (reopenBtn) reopenBtn.style.display = 'none';
        if (resolveBtn) {
            resolveBtn.style.display = 'inline-block';
            resolveBtn.disabled = false;
            resolveBtn.innerHTML = '<i class="fas fa-check-circle me-1"></i>Mark Resolved';
        }
    }

    const workOrderBtn = document.getElementById('feedbackDetailWorkOrderBtn');
    if (workOrderBtn) {
        workOrderBtn.disabled = false;
        workOrderBtn.innerHTML = '<i class="fas fa-tools me-1"></i>Dispatch Work Order';
    }

    const scoreVal = typeof item.ai_sentiment_score === 'number' ? item.ai_sentiment_score.toFixed(2) : (item.ai_sentiment_score || '0.00');
    const scoreEl = document.getElementById('feedbackDetailScoreBadge');
    if (scoreEl) scoreEl.textContent = `Score: ${scoreVal}`;

    // 6. Topics & Keywords Badges
    const topicsEl = document.getElementById('feedbackDetailTopics');
    if (topicsEl) {
        let topics = [];
        if (Array.isArray(item.ai_topics)) topics = item.ai_topics;
        else if (typeof item.ai_topics === 'string') {
            try { topics = JSON.parse(item.ai_topics); } catch (e) { topics = [item.ai_topics]; }
        }
        if (topics && topics.length > 0) {
            topicsEl.innerHTML = topics.map(t => `<span class="badge rounded-pill bg-light text-dark border px-2 py-1" style="font-size:0.72rem;">${escapeHtml(t)}</span>`).join('');
        } else {
            topicsEl.innerHTML = '<span class="text-muted small fst-italic">None identified</span>';
        }
    }

    const keywordsEl = document.getElementById('feedbackDetailKeywords');
    if (keywordsEl) {
        let keywords = [];
        if (Array.isArray(item.ai_keywords)) keywords = item.ai_keywords;
        else if (typeof item.ai_keywords === 'string') {
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

// ── 1-Click Action Handlers (Direct, Fast Execution, Zero Modal Clashes) ──
async function createWorkOrderFromDetail() {
    if (!selectedFeedbackRecord) return;
    const topic = selectedFeedbackRecord._correlatedAlert?.issue_topic || selectedFeedbackRecord.category || 'Resident Feedback Issue';
    const action = selectedFeedbackRecord._correlatedAlert?.recommended_action ||
                   `Inspect issue reported by ${selectedFeedbackRecord.tenant_name || 'resident'} in unit ${selectedFeedbackRecord.room_number || 'N/A'}: ${selectedFeedbackRecord.ai_summary || selectedFeedbackRecord.feedback_text}`;

    const workOrderBtn = document.getElementById('feedbackDetailWorkOrderBtn');
    if (workOrderBtn) {
        workOrderBtn.disabled = true;
        workOrderBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Dispatching...';
    }

    try {
        const res = await fetch('/api/admin/feedback/create-work-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ issue_topic: topic, recommended_action: action }),
            credentials: 'include'
        });
        const data = await res.json();

        if (res.ok) {
            const modalEl = document.getElementById('feedbackDetailModal');
            if (modalEl && window.bootstrap) {
                bootstrap.Modal.getInstance(modalEl)?.hide();
            }
            showFeedbackToast(data.message || 'Building Work Order created successfully!');
            if (typeof loadMaintenance === 'function') loadMaintenance();
        } else {
            showFeedbackToast(data.error || 'Failed to create work order', 'error');
        }
    } catch (err) {
        console.error(err);
        showFeedbackToast('Error creating work order', 'error');
    } finally {
        if (workOrderBtn) {
            workOrderBtn.disabled = false;
            workOrderBtn.innerHTML = '<i class="fas fa-tools me-1"></i>Dispatch Work Order';
        }
    }
}

function openNoticeFromDetail() {
    if (!selectedFeedbackRecord) return;
    const topic = selectedFeedbackRecord._correlatedAlert?.issue_topic || selectedFeedbackRecord.category || 'Facility Service';

    const detailModalEl = document.getElementById('feedbackDetailModal');
    if (detailModalEl && window.bootstrap) {
        bootstrap.Modal.getInstance(detailModalEl)?.hide();
    }

    // Small delay ensures previous modal backdrop cleanly closes before notice modal opens
    setTimeout(() => {
        openTenantNoticeModal(topic);
    }, 250);
}

async function resolveTrendFromDetail() {
    if (!selectedFeedbackRecord) return;
    const feedbackId = selectedFeedbackRecord.id;
    const resolveBtn = document.getElementById('feedbackDetailResolveBtn');

    if (resolveBtn) {
        resolveBtn.disabled = true;
        resolveBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Resolving...';
    }

    try {
        const res = await fetch('/api/admin/feedback/resolve-item', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                feedback_id: feedbackId
            }),
            credentials: 'include'
        });
        const data = await res.json();

        if (res.ok) {
            // Strictly update only this specific feedback record in local state
            selectedFeedbackRecord.is_resolved = true;
            selectedFeedbackRecord.ai_needs_attention = false;
            const rec = allFeedbackRecords.find(r => r.id === feedbackId);
            if (rec) {
                rec.is_resolved = true;
                rec.ai_needs_attention = false;
            }

            const modalEl = document.getElementById('feedbackDetailModal');
            if (modalEl && window.bootstrap) {
                bootstrap.Modal.getInstance(modalEl)?.hide();
            }

            showFeedbackToast(data.message || 'Issue resolved and archived. Retrievable in Reports & Analytics.');
            applyFiltersAndRender();
            loadAdminFeedback(false);
        } else {
            showFeedbackToast(data.error || 'Failed to resolve feedback', 'error');
        }
    } catch (err) {
        console.error(err);
        showFeedbackToast('Error resolving feedback', 'error');
    } finally {
        if (resolveBtn) {
            resolveBtn.disabled = false;
            resolveBtn.innerHTML = '<i class="fas fa-check-circle me-1"></i>Mark Resolved';
        }
    }
}

async function reopenTrendFromDetail() {
    if (!selectedFeedbackRecord) return;
    const feedbackId = selectedFeedbackRecord.id;
    const reopenBtn = document.getElementById('feedbackDetailReopenBtn');

    if (reopenBtn) {
        reopenBtn.disabled = true;
        reopenBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Reopening...';
    }

    try {
        const res = await fetch('/api/admin/feedback/reopen-item', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                feedback_id: feedbackId,
                reopen: true
            }),
            credentials: 'include'
        });
        const data = await res.json();

        if (res.ok) {
            // Strictly update only this specific feedback record in local state
            selectedFeedbackRecord.is_resolved = false;
            selectedFeedbackRecord.ai_needs_attention = true;
            const rec = allFeedbackRecords.find(r => r.id === feedbackId);
            if (rec) {
                rec.is_resolved = false;
                rec.ai_needs_attention = true;
            }

            const modalEl = document.getElementById('feedbackDetailModal');
            if (modalEl && window.bootstrap) {
                bootstrap.Modal.getInstance(modalEl)?.hide();
            }

            showFeedbackToast(data.message || 'Feedback moved back to active status.');
            applyFiltersAndRender();
            loadAdminFeedback(false);
        } else {
            showFeedbackToast(data.error || 'Failed to reopen feedback', 'error');
        }
    } catch (err) {
        console.error(err);
        showFeedbackToast('Error reopening feedback', 'error');
    } finally {
        if (reopenBtn) {
            reopenBtn.disabled = false;
            reopenBtn.innerHTML = '<i class="fas fa-undo me-1"></i>Reopen Issue';
        }
    }
}

// ── 1-Click Building Work Order Dispatcher ──
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

// ── Resolve Trend Alert Action ──
function resolveTrendAlert(alertId, topic) {
    const executeResolve = async () => {
        try {
            const res = await fetch('/api/admin/feedback/resolve-alert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ alert_id: alertId, topic: topic }),
                credentials: 'include'
            });
            const data = await res.json();

            if (res.ok) {
                // Instantly update active alerts and correlated feedback locally
                activeAlertsData = activeAlertsData.filter(a => a.id !== alertId);
                allFeedbackRecords.forEach(fb => {
                    if (fb._correlatedAlert && fb._correlatedAlert.id === alertId) {
                        fb.is_resolved = true;
                        fb.ai_needs_attention = false;
                    }
                });
                showFeedbackToast(data.message || `Resolved "${topic}"! Dorm Health Score boosted.`);
                applyFiltersAndRender();
                loadAdminFeedback(false);
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
window.resolveTrendFromDetail = resolveTrendFromDetail;
window.reopenTrendFromDetail = reopenTrendFromDetail;
window.createWorkOrderFromAlert = createWorkOrderFromAlert;
window.openTenantNoticeModal = openTenantNoticeModal;
window.submitSendTenantNotice = submitSendTenantNotice;
window.resolveTrendAlert = resolveTrendAlert;
window.showFeedbackToast = showFeedbackToast;

// ── Auto-Initialize on DOM Load ──
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => loadAdminFeedback());
} else {
    loadAdminFeedback();
}
