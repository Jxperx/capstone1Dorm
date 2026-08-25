// public/js/admin/modules/maintenance.js
// ─────────────────────────────────────────────────────────────────────────────
// Enhanced: stat cards, overdue tracking, filters, admin notes, toast
// ─────────────────────────────────────────────────────────────────────────────

let allMaintenanceRequests = []; // Cache for filtering

const PRIORITY_ORDER = {
    'Emergency': 0,
    'High': 1,
    'Medium': 2,
    'Routine': 3,
    'Unclassified': 4
};

const PRIORITY_INLINE = {
    Emergency: 'background:#dc3545;color:#fff',
    High:      'background:#fd7e14;color:#fff',
    Medium:    'background:#ffc107;color:#222',
    Routine:   'background:#6c757d;color:#fff',
};

// ── Urgency text → hours mapping ──
const URGENCY_HOURS = {
    'immediate': 4,
    'within 24 hours': 24,
    'within 2-3 days': 72,
    'within 2–3 days': 72,
    'can be scheduled this week': 168,
    'can be scheduled': 168,
};

function parseUrgencyHours(urgencyText) {
    if (!urgencyText) return null;
    const lower = urgencyText.toLowerCase().trim();
    for (const [key, hours] of Object.entries(URGENCY_HOURS)) {
        if (lower.includes(key)) return hours;
    }
    return null;
}

function getElapsedInfo(reportedAt, urgencyText) {
    const now = new Date();
    const reported = new Date(reportedAt);
    const diffMs = now - reported;
    const diffHours = diffMs / (1000 * 60 * 60);
    const diffDays = Math.floor(diffHours / 24);
    const remainingHours = Math.floor(diffHours % 24);

    // Elapsed label
    let elapsed;
    if (diffDays > 0) {
        elapsed = remainingHours > 0 ? `${diffDays}d ${remainingHours}h ago` : `${diffDays}d ago`;
    } else {
        elapsed = `${Math.floor(diffHours)}h ago`;
    }

    // Overdue check
    const thresholdHours = parseUrgencyHours(urgencyText);
    const isOverdue = thresholdHours !== null && diffHours > thresholdHours;

    return { elapsed, isOverdue, diffHours };
}

function aiPriorityBadge(priority, isEmergency) {
    if (!priority) return '<span class="badge bg-light text-muted">Unclassified</span>';
    const style = PRIORITY_INLINE[priority] || 'background:#6c757d;color:#fff';
    const emBadge = isEmergency
        ? '<span class="badge bg-danger ms-1" title="Emergency!">🚨 EMERGENCY</span>'
        : '';
    return `<span class="badge rounded-pill" style="${style}">${priority}</span>${emBadge}`;
}

function renderMaintenanceRow(req, isNew = false) {
    const date = new Date(req.reported_at).toLocaleDateString();

    // Status badge
    const statusBadge = req.status === 'resolved'    ? 'bg-success'
                      : req.status === 'in_progress' ? 'bg-primary'
                      : 'bg-warning text-dark';

    // Photo button
    const photoBtn = req.photo_url
        ? `<button class="btn btn-sm btn-info text-white me-1" onclick="viewProof('${req.photo_url}')">
            <i class="fas fa-image"></i> Photo
           </button>`
        : '';

    // AI columns
    const priorityHtml  = aiPriorityBadge(req.ai_priority, !!req.ai_is_emergency);
    const category      = req.ai_category   || '<span class="text-muted">—</span>';
    const department    = req.ai_department  || '<span class="text-muted">—</span>';
    const aiSummary     = req.ai_summary
        ? `<div class="mt-1 text-muted small" style="font-style:italic;font-size:11px;">
            <i class="fas fa-robot me-1" style="color:#c5a059;"></i>${req.ai_summary}
           </div>`
        : '';

    // New request indicator
    const newIndicator = isNew ? '<span class="badge bg-primary ms-1" style="font-size:9px;">NEW</span>' : '';

    // Overdue / elapsed time
    const { elapsed, isOverdue } = getElapsedInfo(req.reported_at, req.ai_urgency);
    const urgencyLabel = req.ai_urgency || '<span class="text-muted">—</span>';
    const overdueHtml = isOverdue
        ? `<div class="mt-1"><span class="badge bg-danger" style="font-size:0.65rem;">🔴 OVERDUE</span> <span style="font-size:0.7rem;color:#e74c3c;">${elapsed}</span></div>`
        : `<div class="mt-1"><span style="font-size:0.7rem;color:#27ae60;">🟢 ${elapsed}</span></div>`;

    // Mark overdue on the request object for stat counting
    req._isOverdue = isOverdue;

    return `
        <tr>
            <td>${date}</td>
            <td>${req.full_name} ${newIndicator}</td>
            <td>${req.room_number || 'N/A'}</td>
            <td>
                <strong>${req.title}</strong><br>
                <small class="text-muted">${req.description}</small>
                ${aiSummary}
            </td>
            <td>${priorityHtml}</td>
            <td><small>${category}</small></td>
            <td><small>${department}</small></td>
            <td>
                <small>${urgencyLabel}</small>
                ${overdueHtml}
            </td>
            <td>
                <span class="badge ${statusBadge}">${req.status.replace('_', ' ').toUpperCase()}</span><br class="mb-1">
                ${photoBtn}
                <button class="btn btn-sm btn-outline-primary mt-1"
                    onclick="openUpdateStatusModal(${req.id}, '${req.status}')">Update</button>
            </td>
        </tr>
    `;
}

// ── Update summary stat cards ──
function updateMaintenanceStats(requests) {
    const pending   = requests.filter(r => r.status === 'pending').length;
    const critical  = requests.filter(r => r.ai_priority === 'Emergency' || r.ai_priority === 'High').length;
    const inProg    = requests.filter(r => r.status === 'in_progress').length;
    const overdue   = requests.filter(r => r._isOverdue).length;

    const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    el('maint-stat-pending', pending);
    el('maint-stat-critical', critical);
    el('maint-stat-progress', inProg);
    el('maint-stat-overdue', overdue);
}

// ── Render requests to table ──
function renderMaintenanceTable(requests) {
    const tbody = document.getElementById('maintenanceTableBody');
    if (!requests || requests.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center py-3 text-muted">No maintenance requests found.</td></tr>';
        return;
    }

    // Split: Pending (newest first) vs Others (AI priority sorted)
    const pending = requests.filter(r => r.status === 'pending');
    const others = requests.filter(r => r.status !== 'pending');

    pending.sort((a, b) => new Date(b.reported_at) - new Date(a.reported_at));
    others.sort((a, b) => {
        const pA = PRIORITY_ORDER[a.ai_priority || 'Routine'];
        const pB = PRIORITY_ORDER[b.ai_priority || 'Routine'];
        if (pA !== pB) return pA - pB;
        return new Date(b.reported_at) - new Date(a.reported_at);
    });

    let html = '';
    if (pending.length > 0) html += pending.map(req => renderMaintenanceRow(req, true)).join('');
    if (others.length > 0) html += others.map(req => renderMaintenanceRow(req, false)).join('');
    tbody.innerHTML = html;
}

// ── Load Maintenance ──
async function loadMaintenance() {
    try {
        const res = await fetch('/api/admin/maintenance', { credentials: 'include' });
        allMaintenanceRequests = await res.json();
        renderMaintenanceTable(allMaintenanceRequests);
        updateMaintenanceStats(allMaintenanceRequests);
    } catch (err) {
        console.error('Error loading maintenance:', err);
    }
}

// ── Filter ──
function filterMaintenance(filterValue, btnEl) {
    // Update active button state
    const container = document.getElementById('maintenanceFilters');
    if (container) {
        container.querySelectorAll('.btn').forEach(b => {
            b.classList.remove('active');
            b.style.background = '';
            b.style.color = '';
        });
        if (btnEl) {
            btnEl.classList.add('active');
            btnEl.style.background = '#1a1a2e';
            btnEl.style.color = '#fff';
        }
    }

    let filtered;
    if (filterValue === 'all') {
        filtered = allMaintenanceRequests;
    } else if (filterValue === 'overdue') {
        // Need to compute overdue first
        allMaintenanceRequests.forEach(r => {
            const info = getElapsedInfo(r.reported_at, r.ai_urgency);
            r._isOverdue = info.isOverdue;
        });
        filtered = allMaintenanceRequests.filter(r => r._isOverdue);
    } else if (['pending', 'in_progress'].includes(filterValue)) {
        filtered = allMaintenanceRequests.filter(r => r.status === filterValue);
    } else {
        // Priority filter (Emergency, High, Medium, Routine)
        filtered = allMaintenanceRequests.filter(r => r.ai_priority === filterValue);
    }

    renderMaintenanceTable(filtered);
}

// ── Status Modal ──
let currentMaintenanceId = null;

function openUpdateStatusModal(id, currentStatus) {
    currentMaintenanceId = id;
    document.getElementById('newStatus').value = currentStatus;
    const noteEl = document.getElementById('adminNote');
    if (noteEl) noteEl.value = '';
    new bootstrap.Modal(document.getElementById('updateStatusModal')).show();
}

// ── Toast notification ──
function showMaintenanceToast(message, type = 'success') {
    document.getElementById('maint-toast')?.remove();
    const bgColor = type === 'success' ? 'linear-gradient(135deg,#1a7a4a,#27ae60)' : 'linear-gradient(135deg,#8b1a1a,#e74c3c)';
    const icon = type === 'success' ? '✓' : '✕';
    const toast = document.createElement('div');
    toast.id = 'maint-toast';
    toast.style.cssText = `position:fixed;bottom:32px;right:32px;z-index:99999;background:${bgColor};color:#fff;padding:16px 24px;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,0.35);font-family:'Inter',sans-serif;font-size:0.92rem;display:flex;align-items:center;gap:10px;max-width:420px;line-height:1.4;animation:toastIn 0.35s ease;`;
    toast.innerHTML = `<span style="width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,0.25);display:flex;align-items:center;justify-content:center;font-weight:bold;flex-shrink:0;">${icon}</span><span>${message}</span>`;
    if (!document.getElementById('maint-toast-style')) {
        const s = document.createElement('style');
        s.id = 'maint-toast-style';
        s.textContent = '@keyframes toastIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}@keyframes toastOut{from{opacity:1}to{opacity:0;transform:translateY(10px)}}';
        document.head.appendChild(s);
    }
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.animation = 'toastOut 0.35s ease forwards'; setTimeout(() => toast.remove(), 400); }, 4000);
}

function submitStatusUpdate() {
    const status = document.getElementById('newStatus').value;
    const adminNote = document.getElementById('adminNote')?.value || '';

    fetch(`/api/admin/maintenance/${currentMaintenanceId}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, admin_note: adminNote }),
        credentials: 'include'
    })
    .then(res => res.json())
    .then(data => {
        // Close modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('updateStatusModal'));
        if (modal) modal.hide();
        // Show toast
        showMaintenanceToast(data.message + (status !== 'pending' ? ' — Tenant notified by email.' : ''));
        // Refresh table without page reload
        loadMaintenance();
    })
    .catch(err => {
        console.error(err);
        showMaintenanceToast('Error updating status. Please try again.', 'error');
    });
}

// ── Meter Readings ──────────────────────────────────────────────────────────

async function loadTenantsForCalc() {
    try {
        const res = await fetch('/api/admin/tenants', { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        const tenants = Array.isArray(data) ? data : (data.tenants || []);
        const sel = document.getElementById('readingTenantSelect');
        if (!sel) return;
        sel.innerHTML = '<option value="">-- Select Tenant --</option>';
        tenants.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = `${t.full_name} — Room ${t.room_number || 'N/A'}`;
            sel.appendChild(opt);
        });
    } catch (err) {
        console.error('[loadTenantsForCalc]', err);
    }
}

async function loadMeterReadings() {
    // Called from main.js on load — silently succeeds even if no UI element exists yet
    // Actual data is loaded when section is opened or modal is triggered
}

async function submitAddReading() {
    const tenantId = document.getElementById('readingTenantSelect')?.value;
    const form     = document.getElementById('addReadingForm');
    if (!tenantId) { alert('Please select a tenant.'); return; }

    const waterReading    = form.querySelector('[name="water_reading"]')?.value;
    const electricReading = form.querySelector('[name="electric_reading"]')?.value;

    if (!waterReading || !electricReading) {
        alert('Please fill in both water and electric readings.');
        return;
    }

    try {
        const res = await fetch('/api/admin/meter-readings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                tenant_id:        parseInt(tenantId),
                water_reading:    parseFloat(waterReading),
                electric_reading: parseFloat(electricReading),
                status:           'verified'
            })
        });
        const data = await res.json();
        if (res.ok) {
            // Close modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('addReadingModal'));
            if (modal) modal.hide();
            form.reset();
            showMaintenanceToast('✅ Meter reading saved successfully.');
        } else {
            alert('❌ Failed: ' + (data.error || 'Unknown error'));
        }
    } catch (err) {
        console.error('[submitAddReading]', err);
        alert('❌ Network error. Please try again.');
    }
}

