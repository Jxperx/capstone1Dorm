/**
 * js/tenant/modules/feedback.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles AI Feedback Sentiment Analysis reporting for the tenant.
 */

async function loadFeedbackReport() {
    const container = document.getElementById('feedbackReportContainer');
    if (!container) return;

    container.innerHTML = `
        <div class="text-center py-5">
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
            <p class="mt-3 text-muted small">Retrieving your feedback history...</p>
        </div>
    `;

    try {
        const res = await fetch('/api/feedback/my-report', { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to load feedback report');
        const data = await res.json();
        renderFeedbackReport(data);
    } catch (err) {
        console.error('Error loading feedback report:', err);
        container.innerHTML = `
            <div class="alert alert-danger rounded-0 m-0">
                <i class="fas fa-exclamation-triangle me-2"></i>
                Failed to load your report. Please try again later.
            </div>
        `;
    }
}

function renderFeedbackReport(data) {
    const container = document.getElementById('feedbackReportContainer');

    if (!data || data.length === 0) {
        container.innerHTML = `
            <div class="text-center py-5 px-4">
                <i class="fas fa-comment-dots fa-3x mb-3" style="color: #c9d1d9;"></i>
                <h6 class="fw-bold mb-2">No Feedback Submitted Yet</h6>
                <p class="text-muted small mb-0">Once you submit feedback, our AI will analyze it and generate a detailed sentiment report here.</p>
            </div>
        `;
        return;
    }

    // Overall summary header
    const totalCount = data.length;
    const sentimentCounts = { Positive: 0, Negative: 0, Neutral: 0, Mixed: 0 };
    data.forEach(item => {
        const s = item.ai_sentiment || 'Neutral';
        if (sentimentCounts[s] !== undefined) sentimentCounts[s]++;
    });
    const dominantSentiment = Object.entries(sentimentCounts).sort((a, b) => b[1] - a[1])[0][0];
    const avgConfidence = Math.round(data.reduce((acc, i) => acc + (i.ai_confidence || 0), 0) / totalCount * 100);

    let html = `
        <div class="px-4 py-3 border-bottom" style="background: #f8f9fa;">
            <div class="d-flex align-items-center justify-content-between flex-wrap gap-2">
                <div>
                    <span class="fw-bold">${totalCount} submission${totalCount !== 1 ? 's' : ''} analyzed</span>
                    <span class="text-muted small ms-2">— Overall tone: <strong class="text-dark">${dominantSentiment}</strong></span>
                </div>
                <span class="badge bg-light text-dark border small">Avg. Confidence: ${avgConfidence}%</span>
            </div>
        </div>
        <div class="list-group list-group-flush">
    `;

    data.forEach((item, idx) => {
        const palette = getSentimentPalette(item.ai_sentiment);
        const confidencePct = Math.round((item.ai_confidence || 0) * 100);
        const date = new Date(item.created_at).toLocaleDateString('en-US', {
            month: 'long', day: 'numeric', year: 'numeric'
        });
        const timeAgo = getTimeAgo(item.created_at);
        const topics = Array.isArray(item.ai_topics) ? item.ai_topics : [];
        const keywords = Array.isArray(item.ai_keywords) ? item.ai_keywords : [];
        const needsAttention = item.ai_needs_attention;
        const summary = item.ai_summary || 'Analysis pending.';
        const feedbackText = item.feedback_text || '';

        html += `
            <div class="list-group-item border-0 p-4" style="border-left: 4px solid ${palette.color} !important; background: ${idx % 2 === 0 ? '#fff' : '#fafafa'};">

                <!-- Header Row -->
                <div class="d-flex justify-content-between align-items-start gap-2 mb-3 flex-wrap">
                    <div class="d-flex align-items-center gap-2 flex-wrap">
                        <span class="badge rounded-pill px-3 py-1 fw-semibold" style="background-color: ${palette.bg}; color: ${palette.color}; border: 1px solid ${palette.border};">
                            <i class="${palette.icon} me-1"></i>${item.ai_sentiment || 'Neutral'}
                        </span>
                        ${needsAttention ? `<span class="badge rounded-pill bg-danger-subtle text-danger border border-danger-subtle px-3 py-1" style="font-size:0.75rem;"><i class="fas fa-exclamation-circle me-1"></i>Needs Attention</span>` : ''}
                    </div>
                    <div class="text-end">
                        <div class="small fw-semibold text-dark">${date}</div>
                        <div class="text-muted" style="font-size:0.72rem;">${timeAgo}</div>
                    </div>
                </div>

                <!-- Original Feedback -->
                <blockquote class="mb-3 ps-3 py-1 fst-italic text-secondary" style="border-left: 3px solid #dee2e6; font-size: 0.9rem; line-height: 1.6;">
                    "${feedbackText}"
                </blockquote>

                <!-- AI Summary -->
                <div class="mb-3 p-3 rounded" style="background: ${palette.bg}; border: 1px solid ${palette.border};">
                    <div class="d-flex align-items-center gap-2 mb-1">
                        <i class="fas fa-robot small" style="color: ${palette.color};"></i>
                        <span class="fw-semibold small" style="color: ${palette.color};">AI Analysis Summary</span>
                    </div>
                    <p class="mb-0 small text-dark" style="line-height: 1.7;">${summary}</p>
                </div>

                <!-- Topics & Keywords -->
                <div class="d-flex flex-wrap gap-2 mb-3">
                    ${topics.map(t => `<span class="badge bg-white border text-secondary rounded-pill px-3 py-1 small"><i class="fas fa-layer-group me-1 text-muted" style="font-size:0.65rem;"></i>${t}</span>`).join('')}
                    ${keywords.map(k => `<span class="badge rounded-pill px-3 py-1 small" style="background:${palette.bg}; color:${palette.color}; border:1px solid ${palette.border};"><i class="fas fa-hashtag me-1" style="font-size:0.65rem;"></i>${k}</span>`).join('')}
                </div>

                <!-- Confidence Bar -->
                <div>
                    <div class="d-flex justify-content-between align-items-center mb-1">
                        <span class="text-muted" style="font-size: 0.75rem; font-weight: 600; letter-spacing: 0.5px;">ANALYSIS CONFIDENCE</span>
                        <span class="fw-bold small" style="color: ${palette.color};">${confidencePct}%</span>
                    </div>
                    <div class="progress" style="height: 5px; border-radius: 10px; background: #e9ecef;">
                        <div class="progress-bar" role="progressbar"
                            style="width: ${confidencePct}%; background: ${palette.color}; border-radius: 10px; transition: width 0.8s ease;"
                            aria-valuenow="${confidencePct}" aria-valuemin="0" aria-valuemax="100">
                        </div>
                    </div>
                </div>
            </div>
        `;
    });

    html += '</div>';
    container.innerHTML = html;
}

function getSentimentPalette(sentiment) {
    switch (sentiment) {
        case 'Positive': return {
            color: '#198754',
            bg: '#f0fdf4',
            border: '#bbf7d0',
            icon: 'fas fa-smile'
        };
        case 'Negative': return {
            color: '#dc3545',
            bg: '#fff5f5',
            border: '#fecaca',
            icon: 'fas fa-frown'
        };
        case 'Mixed': return {
            color: '#d97706',
            bg: '#fffbeb',
            border: '#fde68a',
            icon: 'fas fa-meh'
        };
        default: return {
            color: '#6c757d',
            bg: '#f8f9fa',
            border: '#dee2e6',
            icon: 'fas fa-minus-circle'
        };
    }
}

function getTimeAgo(dateStr) {
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) > 1 ? 's' : ''} ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} month${Math.floor(diffDays / 30) > 1 ? 's' : ''} ago`;
    return `${Math.floor(diffDays / 365)} year${Math.floor(diffDays / 365) > 1 ? 's' : ''} ago`;
}

// ─── Submit Feedback Logic ─────────────────────────────────────────────────────

function initTenantFeedbackSubmit() {
    const submitBtn = document.getElementById('submitFeedbackBtn');
    const feedbackForm = document.getElementById('feedbackForm');

    if (!submitBtn || submitBtn.dataset.listenerAttached) return;
    submitBtn.dataset.listenerAttached = 'true';

    submitBtn.addEventListener('click', async () => {
        const input = document.getElementById('feedbackText');
        const feedbackText = input ? input.value.trim() : '';

        if (!feedbackText) {
            alert('Please enter your feedback before submitting.');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Submitting...';

        try {
            const res = await fetch('/api/feedback/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ feedback_text: feedbackText }),
                credentials: 'include'
            });

            const result = await res.json();

            if (res.ok) {
                if (feedbackForm) feedbackForm.reset();

                // Close modal cleanly
                const modalEl = document.getElementById('feedbackModal');
                if (modalEl) {
                    const modalInstance = bootstrap.Modal.getInstance(modalEl);
                    if (modalInstance) modalInstance.hide();
                    else {
                        modalEl.classList.remove('show');
                        modalEl.style.display = 'none';
                        document.body.classList.remove('modal-open');
                        document.querySelector('.modal-backdrop')?.remove();
                    }
                }

                // Toast notification
                showTenantToast('Feedback submitted successfully! AI has analyzed your report.');

                // Reload feedback report history
                loadFeedbackReport();
            } else {
                alert(result.error || 'Failed to submit feedback. Please try again.');
            }
        } catch (err) {
            console.error('Error submitting feedback:', err);
            alert('An error occurred while submitting your feedback.');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Submit Feedback';
        }
    });
}

function showTenantToast(message, type = 'success') {
    document.getElementById('tenant-fb-toast')?.remove();
    const bg = type === 'success' ? 'linear-gradient(135deg,#1a7a4a,#27ae60)' : 'linear-gradient(135deg,#8b1a1a,#e74c3c)';
    const icon = type === 'success' ? '✓' : '✕';
    const toast = document.createElement('div');
    toast.id = 'tenant-fb-toast';
    toast.style.cssText = `position:fixed;bottom:32px;right:32px;z-index:99999;background:${bg};color:#fff;padding:14px 22px;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,0.35);font-size:0.9rem;display:flex;align-items:center;gap:10px;animation:toastIn 0.35s ease;`;
    toast.innerHTML = `<span style="width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,0.25);display:flex;align-items:center;justify-content:center;font-weight:bold;">${icon}</span><span>${message}</span>`;
    if (!document.getElementById('tenant-fb-toast-style')) {
        const s = document.createElement('style');
        s.id = 'tenant-fb-toast-style';
        s.textContent = '@keyframes toastIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}';
        document.head.appendChild(s);
    }
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTenantFeedbackSubmit);
} else {
    initTenantFeedbackSubmit();
}
