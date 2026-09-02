/**
 * fraud.js — Admin Fraud Detection Dashboard Module
 * Handles: analytics summary, paginated payment table with risk badges,
 *          detail drawer, manual decisions, receipt preview modal.
 */

// ─── State ─────────────────────────────────────────────────────
const FraudDashboard = {
    currentPage: 1,
    limit: 20,
    filters: { riskLevel: 'ALL', method: 'ALL', flagged: '', dateFrom: '', dateTo: '', search: '' },
    drawerPaymentId: null
};

// ─── Risk helpers ───────────────────────────────────────────────
const RISK_COLORS = {
    SAFE: '#10b981', LOW: '#3b82f6', MEDIUM: '#f59e0b', HIGH: '#ef4444', CRITICAL: '#7c3aed'
};
const DECISION_LABELS = {
    AUTO_APPROVED: 'Auto Approved', MANUAL_APPROVED: 'Approved', 
    PENDING_REVIEW: 'Pending Review', BLOCKED: 'Blocked', MANUAL_BLOCKED: 'Blocked'
};
const DECISION_CLASSES = {
    AUTO_APPROVED: 'auto-approved', MANUAL_APPROVED: 'manual-approved',
    PENDING_REVIEW: 'pending-review', BLOCKED: 'blocked', MANUAL_BLOCKED: 'manual-blocked'
};

function riskBadge(level) {
    if (!level) return '<span class="risk-badge SAFE"><span class="risk-dot"></span>Unscored</span>';
    return `<span class="risk-badge ${level}"><span class="risk-dot"></span>${level}</span>`;
}
function decisionBadge(dec) {
    if (!dec) return '—';
    return `<span class="decision-badge ${DECISION_CLASSES[dec] || ''}">${DECISION_LABELS[dec] || dec}</span>`;
}
function scoreBar(score, level) {
    if (score === null || score === undefined) return '<span class="text-muted">—</span>';
    const color = RISK_COLORS[level] || '#6366f1';
    return `
        <div class="fraud-score-bar">
            <div class="score-track">
                <div class="score-fill" style="width:${score}%;background:${color}"></div>
            </div>
            <span class="score-val" style="color:${color}">${score}</span>
        </div>`;
}
function flagChips(flagsStr) {
    if (!flagsStr) return '<span class="text-muted" style="font-size:0.75rem">None</span>';
    const flags = flagsStr.split(', ').map(f => f.trim()).filter(Boolean);
    if (flags.length === 0) return '<span class="text-muted" style="font-size:0.75rem">None</span>';
    const first = `<span class="flag-chip first-flag">${flags[0].replace(/_/g, ' ')}</span>`;
    const more = flags.length > 1 ? `<span class="flag-chip more-flags">+${flags.length - 1}</span>` : '';
    return first + more;
}
function fmtDate(dt) {
    if (!dt) return '—';
    return new Date(dt).toLocaleString('en-PH', { month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtMoney(amount) {
    if (amount === null || amount === undefined) return '—';
    return '₱' + parseFloat(amount).toLocaleString('en-PH', { minimumFractionDigits: 2 });
}

// ─── Load Analytics ─────────────────────────────────────────────
async function loadFraudAnalytics() {
    try {
        const res = await fetch('/api/admin/fraud/analytics', { credentials: 'include' });
        if (!res.ok) throw new Error('Analytics fetch failed');
        const data = await res.json();
        const s = data.summary || {};

        document.getElementById('fd-total').textContent = s.total_analyzed ?? 0;
        document.getElementById('fd-flagged').textContent = (s.high_risk_count ?? 0) + (s.medium_count ?? 0);
        document.getElementById('fd-blocked').textContent = s.blocked_count ?? 0;
        document.getElementById('fd-review').textContent = s.pending_review_count ?? 0;
        document.getElementById('fd-safe').textContent = s.safe_count ?? 0;

        // Top fraud reasons
        const topList = document.getElementById('fd-top-reasons');
        if (topList && data.topFraudReasons?.length) {
            const maxOcc = data.topFraudReasons[0]?.occurrences || 1;
            topList.innerHTML = data.topFraudReasons.slice(0, 6).map(r => `
                <div class="fraud-reason-bar">
                    <div class="reason-label">
                        <span>${r.flag_code.replace(/_/g,' ')}</span>
                        <span>${r.occurrences}</span>
                    </div>
                    <div class="bar-track"><div class="bar-fill" style="width:${Math.round((r.occurrences/maxOcc)*100)}%"></div></div>
                </div>`).join('');
        } else if (topList) {
            topList.innerHTML = '<p class="text-muted" style="font-size:0.8rem">No fraud flags yet.</p>';
        }
    } catch (err) {
        console.error('[FraudAnalytics]', err);
    }
}

// ─── Load Fraud Table ───────────────────────────────────────────
async function loadFraudDashboard(page = 1) {
    FraudDashboard.currentPage = page;
    const tbody = document.getElementById('fraud-tbody');
    if (!tbody) return;

    // Show skeletons
    tbody.innerHTML = Array(5).fill(0).map(() => `
        <tr class="skeleton-row">
            ${Array(11).fill('<td><div class="skeleton-line" style="width:${Math.random()*40+50}%"></div></td>').join('')}
        </tr>`).join('');

    const f = FraudDashboard.filters;
    const params = new URLSearchParams({
        page, limit: FraudDashboard.limit,
        riskLevel: f.riskLevel, method: f.method,
        flagged: f.flagged, dateFrom: f.dateFrom,
        dateTo: f.dateTo, search: f.search
    });

    try {
        const res = await fetch(`/api/admin/fraud?${params}`, { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to load fraud data');
        const json = await res.json();
        renderFraudTable(json.data);
        renderFraudPagination(json.total, json.page, json.limit);
    } catch (err) {
        console.error('[FraudTable]', err);
        tbody.innerHTML = `<tr><td colspan="11" class="text-center text-danger py-4"><i class="fas fa-exclamation-triangle me-2"></i>${err.message}</td></tr>`;
    }
}

function renderFraudTable(rows) {
    const tbody = document.getElementById('fraud-tbody');
    if (!rows || rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="11" class="text-center py-5" style="color:#64748b">
            <i class="fas fa-shield-alt fa-2x mb-3 d-block"></i>No fraud records found for these filters.
        </td></tr>`;
        return;
    }
    tbody.innerHTML = rows.map(r => `
        <tr onclick="openFraudDetail(${r.payment_id})" style="cursor:pointer">
            <td>
                <div style="font-weight:600;color:#1a1a1a">${r.tenant_name || '—'}</div>
                <div style="font-size:0.72rem;color:#888">${r.tenant_email || ''}</div>
            </td>
            <td>
                <div style="font-size:0.8rem;color:#555">#${r.payment_id}</div>
                ${r.booking_id ? `<div style="font-size:0.72rem;color:#888">Booking: ${r.booking_id}</div>` : ''}
            </td>
            <td style="color:#666;font-size:0.8rem">${r.payment_method || 'Manual Upload'}</td>
            <td>
                <div style="color:#1a1a1a;font-weight:600">${fmtMoney(r.amount_paid)}</div>
                ${r.expected_amount ? `<div style="font-size:0.72rem;color:#888">Exp: ${fmtMoney(r.expected_amount)}</div>` : ''}
            </td>
            <td>
                <span class="badge ${r.payment_status === 'approved' ? 'bg-success' : r.payment_status === 'rejected' ? 'bg-danger' : 'bg-warning text-dark'}" style="font-size:0.7rem">
                    ${(r.payment_status || 'pending').toUpperCase()}
                </span>
            </td>
            <td>${r.receipt_path ? `<img src="${r.receipt_path}" style="width:40px;height:40px;object-fit:cover;border-radius:6px;border:1px solid rgba(0,0,0,0.1);cursor:zoom-in" onclick="event.stopPropagation();openReceiptPreview('${r.receipt_path}')" title="Click to preview">` : '<span style="color:#888;font-size:0.75rem">—</span>'}</td>
            <td>${scoreBar(r.risk_score, r.risk_level)}</td>
            <td>${riskBadge(r.risk_level)}</td>
            <td><div style="max-width:180px;white-space:normal">${flagChips(r.flags)}</div></td>
            <td>${decisionBadge(r.decision)}</td>
            <td style="font-size:0.75rem;color:#888;white-space:nowrap">${fmtDate(r.created_at)}</td>
        </tr>`).join('');
}

function renderFraudPagination(total, page, limit) {
    const container = document.getElementById('fraud-pagination');
    if (!container) return;
    const totalPages = Math.ceil(total / limit);
    if (totalPages <= 1) { container.innerHTML = ''; return; }

    let html = `<button class="fraud-page-btn" onclick="loadFraudDashboard(${page - 1})" ${page <= 1 ? 'disabled' : ''}><i class="fas fa-chevron-left"></i></button>`;
    for (let p = Math.max(1, page - 2); p <= Math.min(totalPages, page + 2); p++) {
        html += `<button class="fraud-page-btn ${p === page ? 'active' : ''}" onclick="loadFraudDashboard(${p})">${p}</button>`;
    }
    html += `<button class="fraud-page-btn" onclick="loadFraudDashboard(${page + 1})" ${page >= totalPages ? 'disabled' : ''}><i class="fas fa-chevron-right"></i></button>`;
    html += `<span style="color:#64748b;font-size:0.8rem;margin-left:8px">Page ${page} of ${totalPages} (${total} records)</span>`;
    container.innerHTML = html;
}

// ─── Filters ────────────────────────────────────────────────────
function applyFraudFilters() {
    FraudDashboard.filters.riskLevel = document.getElementById('fd-filter-risk')?.value || 'ALL';
    FraudDashboard.filters.method   = document.getElementById('fd-filter-method')?.value || 'ALL';
    FraudDashboard.filters.flagged  = document.getElementById('fd-filter-flagged')?.checked ? 'true' : '';
    FraudDashboard.filters.dateFrom = document.getElementById('fd-filter-from')?.value || '';
    FraudDashboard.filters.dateTo   = document.getElementById('fd-filter-to')?.value || '';
    FraudDashboard.filters.search   = document.getElementById('fd-search')?.value || '';
    loadFraudDashboard(1);
}

// ─── Detail Drawer ──────────────────────────────────────────────
async function openFraudDetail(paymentId) {
    FraudDashboard.drawerPaymentId = paymentId;
    const drawer = document.getElementById('fraud-drawer');
    const overlay = document.getElementById('fraud-drawer-overlay');
    const body = document.getElementById('fraud-drawer-body');

    drawer.classList.add('open');
    overlay.classList.add('show');
    body.innerHTML = `<div class="text-center py-5"><div class="spinner-border text-primary" style="width:2rem;height:2rem"></div></div>`;

    try {
        const res = await fetch(`/api/admin/fraud/${paymentId}`, { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to load payment detail');
        const data = await res.json();
        FraudDashboard.currentPayment = data.payment || {};
        body.innerHTML = buildFraudDrawerContent(data);
    } catch (err) {
        body.innerHTML = `<div class="alert alert-danger m-3">${err.message}</div>`;
    }
}

function closeFraudDrawer() {
    document.getElementById('fraud-drawer')?.classList.remove('open');
    document.getElementById('fraud-drawer-overlay')?.classList.remove('show');
    FraudDashboard.drawerPaymentId = null;
    FraudDashboard.currentPayment = null;
}

function buildFraudDrawerContent(d) {
    const p = d.payment || {};
    const receipt = d.receipts?.[0] || null;
    const flags = d.flags || [];
    const devices = d.devices || [];
    const score = p.risk_score;
    const level = p.risk_level || 'SAFE';
    const color = RISK_COLORS[level] || '#6366f1';

    const rawImgUrl = receipt?.file_path || receipt?.receipt_path || p.proof_image_url || '';
    const imgUrl = rawImgUrl ? (rawImgUrl.startsWith('http') || rawImgUrl.startsWith('/') ? rawImgUrl : '/' + rawImgUrl) : '';

    const circumference = 2 * Math.PI * 30;
    const fillOffset = (receipt || rawImgUrl) ? (circumference - (score / 100) * circumference) : circumference;

    // Check flags for parameter status
    const flagCodes = flags.map(f => f.flag_code || '');
    const hasAmountMismatch = flagCodes.includes('OCR_AMOUNT_MISMATCH');
    const hasDupRef = flagCodes.includes('DUPLICATE_REFERENCE_NUMBER');
    const hasOcrRefMismatch = flagCodes.includes('OCR_REFERENCE_MISMATCH');
    const hasUnreadable = flagCodes.includes('UNREADABLE_RECEIPT');
    const hasDupHash = flagCodes.includes('DUPLICATE_RECEIPT_HASH') || flagCodes.includes('SIMILAR_PHASH');

    const ourPrice = parseFloat(p.expected_amount) || parseFloat(p.room_monthly_rate) || parseFloat(p.amount) || 0;
    const claimedAmt = parseFloat(p.amount) || 0;
    const ocrPaid = (receipt && receipt.ocr_amount !== null && receipt.ocr_amount !== undefined) ? parseFloat(receipt.ocr_amount) : null;
    const actualPaid = ocrPaid !== null ? ocrPaid : claimedAmt;
    const remainingBalance = Math.max(0, ourPrice - actualPaid);

    const isAmountValid = !hasAmountMismatch && (ourPrice > 0 ? Math.abs(claimedAmt - ourPrice) <= 1.0 && (ocrPaid === null || Math.abs(ocrPaid - ourPrice) <= 1.0) : true);

    let refBadge = `<span class="badge bg-success"><i class="fas fa-check me-1"></i>Verified Unique (${p.reference_number || 'N/A'})</span>`;
    if (hasDupRef) {
        refBadge = `<span class="badge bg-danger"><i class="fas fa-times me-1"></i>Duplicate Ref #</span>`;
    } else if (hasOcrRefMismatch) {
        refBadge = `<span class="badge bg-warning text-dark"><i class="fas fa-exclamation-triangle me-1"></i>OCR Mismatch (${receipt?.ocr_ref_number || 'Differs'})</span>`;
    } else if (!p.reference_number) {
        refBadge = `<span class="badge bg-secondary">No Ref #</span>`;
    }

    return `
    <!-- Score Ring -->
    <div class="score-ring-container">
        <div class="score-ring">
            <svg width="72" height="72" viewBox="0 0 72 72">
                <circle class="ring-bg" cx="36" cy="36" r="30"/>
                <circle class="ring-fill" cx="36" cy="36" r="30"
                    stroke="${color}"
                    stroke-dasharray="${circumference}"
                    stroke-dashoffset="${fillOffset}"/>
            </svg>
            <div class="ring-text">${score ?? '—'}</div>
        </div>
        <div class="score-ring-info">
            <div class="risk-label" style="color:${color}">${level}</div>
            <div style="font-size:0.85rem;color:#666;margin-top:3px">${DECISION_LABELS[p.decision] || '—'}</div>
            <div style="font-size:0.75rem;color:#999;margin-top:2px">Analyzed: ${fmtDate(p.analyzed_at)}</div>
        </div>
    </div>

    <!-- AI Parameter Verification Checklist -->
    <div class="drawer-section" style="background: rgba(30, 41, 59, 0.4); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 14px; margin-bottom: 16px;">
        <div class="drawer-section-title" style="color: #c5a059; margin-bottom: 12px; font-weight: 600;">
            <i class="fas fa-robot me-2"></i>AI Verification Checklist
        </div>
        
        <!-- 1. Amount Verification -->
        <div class="d-flex justify-content-between align-items-center mb-2" style="font-size: 0.82rem;">
            <span class="text-light"><i class="fas fa-money-bill-wave me-2 text-warning"></i>Payment Amount:</span>
            ${isAmountValid 
                ? `<span class="badge bg-success"><i class="fas fa-check me-1"></i>Match (${fmtMoney(claimedAmt)})</span>` 
                : `<span class="badge bg-danger"><i class="fas fa-times me-1"></i>Mismatch (OCR: ${ocrPaid !== null ? fmtMoney(ocrPaid) : 'N/A'} vs Price: ${fmtMoney(ourPrice)})</span>`}
        </div>

        <!-- 2. Reference Number Verification -->
        <div class="d-flex justify-content-between align-items-center mb-2" style="font-size: 0.82rem;">
            <span class="text-light"><i class="fas fa-hashtag me-2 text-info"></i>Reference Number:</span>
            ${refBadge}
        </div>

        <!-- 3. Time / Submission Verification -->
        <div class="d-flex justify-content-between align-items-center mb-2" style="font-size: 0.82rem;">
            <span class="text-light"><i class="fas fa-clock me-2 text-primary"></i>Submission Date/Time:</span>
            <span class="badge bg-info text-dark"><i class="fas fa-calendar-alt me-1"></i>${fmtDate(p.created_at)}</span>
        </div>

        <!-- 4. Receipt Image Integrity -->
        <div class="d-flex justify-content-between align-items-center" style="font-size: 0.82rem;">
            <span class="text-light"><i class="fas fa-file-image me-2 text-secondary"></i>Receipt Image Check:</span>
            ${imgUrl && !hasUnreadable && !hasDupHash
                ? `<span class="badge bg-success"><i class="fas fa-check me-1"></i>Valid & Unique Receipt</span>`
                : hasDupHash 
                    ? `<span class="badge bg-danger"><i class="fas fa-copy me-1"></i>Duplicate Image Hash</span>`
                    : `<span class="badge bg-warning text-dark"><i class="fas fa-eye-slash me-1"></i>Unreadable / Missing</span>`}
        </div>
    </div>

    <!-- Tenant & Payment Info -->
    <div class="drawer-section">
        <div class="drawer-section-title">Payment Information</div>
        ${drawerRow('Tenant', `<strong>${p.tenant_name || '—'}</strong>`)}
        ${drawerRow('Email', p.tenant_email || '—')}
        ${drawerRow('Phone', p.phone_number || '—')}
        ${drawerRow('Room', p.room_number || '—')}
        ${drawerRow('Payment ID', `#${p.id}`)}
        ${drawerRow('Booking/Bill ID', p.booking_id || '—')}
        ${drawerRow('Payment Method', p.payment_method || 'Manual Upload')}
        ${drawerRow('Our Price (Expected Rent)', `<strong>${fmtMoney(ourPrice)}</strong>`)}
        ${drawerRow('Claimed Amount Submitted', fmtMoney(claimedAmt))}
        ${drawerRow('OCR Verified Paid', ocrPaid !== null ? `<span class="${ocrPaid < ourPrice ? 'text-danger font-weight-bold' : 'text-success'}">${fmtMoney(ocrPaid)}</span>` : '—')}
        ${drawerRow('Calculated Remaining Balance', `<span class="text-warning font-weight-bold">${fmtMoney(remainingBalance)}</span>`)}
        ${drawerRow('Reference #', p.reference_number || '—')}
        ${drawerRow('Gateway TX ID', p.gateway_transaction_id || '—')}
        ${drawerRow('Gateway Status', p.gateway_status || '—')}
        ${drawerRow('Payment Status', `<span class="badge ${p.status === 'approved' ? 'bg-success' : p.status === 'rejected' ? 'bg-danger' : 'bg-warning text-dark'}">${(p.status || '').toUpperCase()}</span>`)}
        ${drawerRow('Submitted', fmtDate(p.created_at))}
    </div>

    <!-- Receipt -->
    <div class="drawer-section">
        <div class="drawer-section-title">Receipt & Hashes</div>
        ${imgUrl ? `
        <img src="${imgUrl}" class="receipt-preview-thumb mb-3" 
             onclick="openReceiptPreview('${imgUrl}')" 
             style="max-width:180px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);cursor:zoom-in;display:block;">
        ${drawerRow('SHA-256', `<span style="font-family:monospace;font-size:0.7rem;word-break:break-all">${receipt?.sha256_hash || '—'}</span>`)}
        ${drawerRow('pHash', `<span style="font-family:monospace;font-size:0.7rem">${receipt?.phash_value || '—'}</span>`)}
        ` : '<p style="color:#64748b;font-size:0.82rem">No receipt uploaded.</p>'}
    </div>

    <!-- OCR Results -->
    ${receipt ? `
    <div class="drawer-section">
        <div class="drawer-section-title">OCR Extracted Data</div>
        ${drawerRow('OCR Reference #', receipt.ocr_ref_number || '—')}
        ${drawerRow('OCR Amount', fmtMoney(receipt.ocr_amount))}
        ${drawerRow('OCR Timestamp', receipt.ocr_timestamp || '—')}
        <div style="margin-top:8px">
            <div style="font-size:0.75rem;color:#888;margin-bottom:6px">Raw OCR Text</div>
            <div class="ocr-text-box">${receipt.ocr_raw_text || '(no text extracted)'}</div>
        </div>
    </div>` : ''}

    <!-- Fraud Flags -->
    <div class="drawer-section">
        <div class="drawer-section-title">Fraud Flags (${flags.length})</div>
        ${flags.length === 0 ? '<p style="color:#64748b;font-size:0.82rem">No fraud flags detected.</p>' :
            flags.map(f => `
            <div class="fraud-flag-item">
                <div class="fraud-flag-icon"><i class="fas fa-exclamation-triangle"></i></div>
                <div class="fraud-flag-content">
                    <div class="flag-code">${f.flag_code}</div>
                    <div class="flag-desc">${f.flag_description || '—'}</div>
                </div>
            </div>`).join('')}
    </div>

    <!-- Device Fingerprints -->
    <div class="drawer-section">
        <div class="drawer-section-title">Device Fingerprints</div>
        ${devices.length === 0 ? '<p style="color:#888;font-size:0.82rem">No device data recorded.</p>' :
            devices.map(dv => `
            <div class="drawer-data-row">
                <span class="label"><i class="fas fa-fingerprint me-2" style="color:#c5a059"></i>Device</span>
                <span class="value">
                    <span style="font-family:monospace;font-size:0.7rem">${(dv.device_hash || '').substring(0, 24)}…</span>
                    ${dv.shared_by_count > 1 ? `<span class="badge bg-danger ms-1">Shared by ${dv.shared_by_count} accounts</span>` : ''}
                </span>
            </div>`).join('')}
    </div>

    ${p.admin_note ? `
    <div class="drawer-section">
        <div class="drawer-section-title">Admin Note</div>
        <div class="ocr-text-box">${p.admin_note}</div>
    </div>` : ''}`;
}

function drawerRow(label, value) {
    return `<div class="drawer-data-row"><span class="label">${label}</span><span class="value">${value}</span></div>`;
}

// ─── Manual Decision ────────────────────────────────────────────
async function submitFraudDecision(decision) {
    const pid = FraudDashboard.drawerPaymentId;
    if (!pid) return;
    const note = document.getElementById('fraud-admin-note')?.value || '';
    const labelMap = {
        MANUAL_APPROVED: 'Approve',
        MANUAL_BLOCKED: 'Block',
        MANUAL_PARTIAL: 'Accept Partial Payment'
    };
    const label = labelMap[decision] || decision;

    let expectedAmount = null;
    if (decision === 'MANUAL_PARTIAL') {
        const currP = FraudDashboard.currentPayment || {};
        const defaultExpected = currP.expected_amount || currP.room_monthly_rate || currP.monthly_rate || currP.amount || '';
        const input = prompt(`Enter TOTAL expected room rent/bill amount ("Our Price") for Payment #${pid} (₱):`, defaultExpected);
        if (input === null) return; // User cancelled prompt
        const parsed = parseFloat(input);
        if (!isNaN(parsed) && parsed > 0) expectedAmount = parsed;
    } else {
        if (!confirm(`${label} for payment #${pid}?`)) return;
    }

    try {
        const res = await fetch(`/api/admin/fraud/${pid}/decision`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision, note, expected_amount: expectedAmount }),
            credentials: 'include'
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update decision');
        showToast(`Payment #${pid} set to ${label} successfully.`, decision === 'MANUAL_BLOCKED' ? 'danger' : 'success');
        closeFraudDrawer();
        loadFraudDashboard(FraudDashboard.currentPage);
        loadFraudAnalytics();
    } catch (err) {
        showToast(err.message, 'danger');
    }
}

async function reRunAnalysis() {
    const pid = FraudDashboard.drawerPaymentId;
    if (!pid) return;
    showToast('Running fraud analysis...', 'info');
    try {
        const res = await fetch(`/api/admin/fraud/${pid}/analyze`, { 
            method: 'POST',
            credentials: 'include'
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        showToast(`Re-analysis complete. Score: ${data.score} (${data.riskLevel})`, 'success');
        openFraudDetail(pid);
        loadFraudDashboard(FraudDashboard.currentPage);
        loadFraudAnalytics();
    } catch (err) {
        showToast(err.message, 'danger');
    }
}

// ─── Receipt Preview Modal ──────────────────────────────────────
function openReceiptPreview(url) {
    if (!url) return;
    const formattedUrl = url.startsWith('http') || url.startsWith('/') ? url : '/' + url;
    const img = document.getElementById('fraud-receipt-preview-img');
    if (img) img.src = formattedUrl;
    const modalEl = document.getElementById('receiptPreviewModal');
    if (modalEl) {
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();
    }
}

// ─── Toast Notification ─────────────────────────────────────────
function showToast(message, type = 'info') {
    const container = document.getElementById('fraud-toast-container') || createToastContainer();
    const id = 'toast-' + Date.now();
    const icons = { success: 'check-circle', danger: 'exclamation-circle', info: 'info-circle', warning: 'exclamation-triangle' };
    const toast = document.createElement('div');
    toast.id = id;
    toast.className = `toast align-items-center text-bg-${type} border-0 show`;
    toast.style.cssText = 'min-width:280px;margin-top:8px';
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `
        <div class="d-flex">
            <div class="toast-body"><i class="fas fa-${icons[type] || 'info-circle'} me-2"></i>${message}</div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" onclick="this.closest('.toast').remove()"></button>
        </div>`;
    container.appendChild(toast);
    setTimeout(() => document.getElementById(id)?.remove(), 5000);
}

function createToastContainer() {
    const c = document.createElement('div');
    c.id = 'fraud-toast-container';
    c.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;display:flex;flex-direction:column;align-items:flex-end';
    document.body.appendChild(c);
    return c;
}

// ─── Init FingerprintJS ─────────────────────────────────────────
async function initFraudFingerprint() {
    if (typeof FingerprintJS === 'undefined') return;
    try {
        const fp = await FingerprintJS.load();
        const result = await fp.get();
        window._fraudDeviceHash = result.visitorId;
    } catch {}
}

// ─── Main entry point ────────────────────────────────────────────
function initFraudSection() {
    loadFraudAnalytics();
    loadFraudDashboard(1);
    initFraudFingerprint();
}
