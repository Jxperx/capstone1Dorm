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
    } else if (diffHours >= 1) {
        elapsed = `${Math.floor(diffHours)}h ago`;
    } else {
        elapsed = 'Just now';
    }

    // Overdue check
    const thresholdHours = parseUrgencyHours(urgencyText);
    const isOverdue = thresholdHours !== null && diffHours > thresholdHours;

    return { elapsed, isOverdue, diffHours };
}

// ── Urgency Categorization ──
function categorizeRequest(req) {
    if (req.ai_priority === 'Emergency' || req.ai_is_emergency === true || req.ai_is_emergency === 1) {
        return 'Emergency';
    }
    if (req.ai_priority === 'High') {
        return 'High';
    }
    return 'Routine';
}

// ── Render single row for urgency column table ──
function renderUrgencyRow(req) {
    // Format date as MM/DD/YY (e.g., 09/05/26)
    const d = new Date(req.reported_at);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    const dateFormatted = `${mm}/${dd}/${yy}`;

    // Status badge style
    let statusBadgeClass = 'bg-warning text-dark';
    let statusText = 'Pending';
    if (req.status === 'in_progress') {
        statusBadgeClass = 'bg-primary text-white';
        statusText = 'In Progress';
    } else if (req.status === 'resolved') {
        statusBadgeClass = 'bg-success text-white';
        statusText = 'Resolved';
    }

    // Overdue or SLA flag
    const overdueFlag = req._isOverdue
        ? '<div class="mt-1"><span class="badge bg-danger" style="font-size: 0.65rem;">Overdue</span></div>'
        : '';

    const unitText = req.room_number ? req.room_number : '<span class="text-muted">Unassigned</span>';

    return `
        <tr style="cursor: pointer; transition: background-color 0.15s ease;"
            onclick="openMaintenanceDetailModal(${req.id})"
            class="align-middle"
            title="Click to view tenant contact, description, and update status">
            <td class="text-nowrap" style="font-size: 0.82rem; color: #555; font-weight: 500;">
                ${dateFormatted}
            </td>
            <td class="text-nowrap" style="font-size: 0.84rem; font-weight: 600; color: #1a1a2e;">
                ${unitText}
            </td>
            <td>
                <div class="text-truncate" style="max-width: 140px; font-weight: 500;" title="${req.title}">
                    ${req.title}
                </div>
                ${overdueFlag}
            </td>
            <td class="text-center text-nowrap">
                <span class="badge ${statusBadgeClass}" style="font-size: 0.72rem; padding: 4px 8px; letter-spacing: 0.02em;">
                    ${statusText}
                </span>
            </td>
        </tr>
    `;
}

// ── Render 3-Column Urgency Board ──
function renderMaintenanceBoard(requests) {
    // Process overdue status for stat counting and badge displays
    requests.forEach(r => {
        const info = getElapsedInfo(r.reported_at, r.ai_urgency);
        r._isOverdue = info.isOverdue;
        r._elapsed = info.elapsed;
    });

    const emergencyList = requests.filter(r => categorizeRequest(r) === 'Emergency');
    const highList      = requests.filter(r => categorizeRequest(r) === 'High');
    const routineList   = requests.filter(r => categorizeRequest(r) === 'Routine');

    // Sorter: pending first (newest reported_at first), then others
    const sortList = (list) => {
        return list.slice().sort((a, b) => {
            const aPending = a.status === 'pending' ? 1 : 0;
            const bPending = b.status === 'pending' ? 1 : 0;
            if (aPending !== bPending) return bPending - aPending;
            return new Date(b.reported_at) - new Date(a.reported_at);
        });
    };

    const sortedEmergency = sortList(emergencyList);
    const sortedHigh      = sortList(highList);
    const sortedRoutine   = sortList(routineList);

    // Update urgency column counts
    const updateCount = (id, count) => {
        const el = document.getElementById(id);
        if (el) el.textContent = count;
    };
    updateCount('maint-count-emergency', sortedEmergency.length);
    updateCount('maint-count-high', sortedHigh.length);
    updateCount('maint-count-routine', sortedRoutine.length);

    // Populate Urgency Column TBodies
    const populateTBody = (tbodyId, list, emptyMessage) => {
        const tbody = document.getElementById(tbodyId);
        if (!tbody) return;
        if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-muted" style="font-size: 0.85rem;">${emptyMessage}</td></tr>`;
        } else {
            tbody.innerHTML = list.map(req => renderUrgencyRow(req)).join('');
        }
    };

    populateTBody('maint-emergency-body', sortedEmergency, 'No emergency requests.');
    populateTBody('maint-high-body', sortedHigh, 'No high priority requests.');
    populateTBody('maint-routine-body', sortedRoutine, 'No routine requests.');
}

// Alias for backwards compatibility
function renderMaintenanceTable(requests) {
    renderMaintenanceBoard(requests);
}

// ── Update summary stat cards ──
function updateMaintenanceStats(requests) {
    const pending   = requests.filter(r => r.status === 'pending').length;
    const critical  = requests.filter(r => r.ai_priority === 'Emergency' || r.ai_priority === 'High' || r.ai_is_emergency).length;
    const inProg    = requests.filter(r => r.status === 'in_progress').length;
    const overdue   = requests.filter(r => r._isOverdue).length;

    const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    el('maint-stat-pending', pending);
    el('maint-stat-critical', critical);
    el('maint-stat-progress', inProg);
    el('maint-stat-overdue', overdue);
}

// ── Load Maintenance Requests from Server ──
async function loadMaintenance() {
    try {
        const res = await fetch('/api/admin/maintenance', { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        allMaintenanceRequests = await res.json();
        
        applyCurrentFilter();
        updateMaintenanceStats(allMaintenanceRequests);
    } catch (err) {
        console.error('[loadMaintenance] Error loading maintenance requests:', err);
    }
}

// ── Filter Requests ──
let currentMaintenanceFilter = 'all';

function filterMaintenance(filterValue, btnEl) {
    currentMaintenanceFilter = filterValue;

    // Update active button styling
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

    applyCurrentFilter();
}

function applyCurrentFilter() {
    let filtered;
    if (currentMaintenanceFilter === 'all') {
        filtered = allMaintenanceRequests;
    } else if (currentMaintenanceFilter === 'overdue') {
        allMaintenanceRequests.forEach(r => {
            const info = getElapsedInfo(r.reported_at, r.ai_urgency);
            r._isOverdue = info.isOverdue;
        });
        filtered = allMaintenanceRequests.filter(r => r._isOverdue);
    } else if (['pending', 'in_progress', 'resolved'].includes(currentMaintenanceFilter)) {
        filtered = allMaintenanceRequests.filter(r => r.status === currentMaintenanceFilter);
    } else if (currentMaintenanceFilter === 'Emergency') {
        filtered = allMaintenanceRequests.filter(r => categorizeRequest(r) === 'Emergency');
    } else if (currentMaintenanceFilter === 'High') {
        filtered = allMaintenanceRequests.filter(r => categorizeRequest(r) === 'High');
    } else if (currentMaintenanceFilter === 'Routine') {
        filtered = allMaintenanceRequests.filter(r => categorizeRequest(r) === 'Routine');
    } else {
        filtered = allMaintenanceRequests.filter(r => r.ai_priority === currentMaintenanceFilter);
    }

    renderMaintenanceBoard(filtered);
}

// ── Open Interactive Detail Modal (Click-to-Inspect) ──
function openMaintenanceDetailModal(id) {
    const req = allMaintenanceRequests.find(r => r.id == id);
    if (!req) return;

    // Title & Meta
    const titleEl = document.getElementById('maintDetailTitle');
    if (titleEl) titleEl.textContent = req.title || 'Maintenance Request';

    const metaEl = document.getElementById('maintDetailMeta');
    if (metaEl) {
        const d = new Date(req.reported_at);
        metaEl.textContent = `Reported on ${d.toLocaleDateString()} at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }

    // Priority Badge
    const priorityBadge = document.getElementById('maintDetailPriorityBadge');
    if (priorityBadge) {
        const category = categorizeRequest(req);
        if (category === 'Emergency') {
            priorityBadge.className = 'badge bg-danger';
            priorityBadge.textContent = 'Emergency';
        } else if (category === 'High') {
            priorityBadge.className = 'badge bg-warning text-dark';
            priorityBadge.textContent = 'High Priority';
        } else {
            priorityBadge.className = 'badge bg-secondary';
            priorityBadge.textContent = req.ai_priority || 'Routine';
        }
    }

    // Status Badge
    const statusBadge = document.getElementById('maintDetailStatusBadge');
    if (statusBadge) {
        if (req.status === 'resolved') {
            statusBadge.className = 'badge bg-success';
            statusBadge.textContent = 'Resolved';
        } else if (req.status === 'in_progress') {
            statusBadge.className = 'badge bg-primary';
            statusBadge.textContent = 'In Progress';
        } else {
            statusBadge.className = 'badge bg-warning text-dark';
            statusBadge.textContent = 'Pending';
        }
    }

    // Tenant info
    const tenantNameEl = document.getElementById('maintDetailTenantName');
    if (tenantNameEl) tenantNameEl.textContent = req.full_name || 'Unknown Tenant';

    const emailEl = document.getElementById('maintDetailEmail');
    if (emailEl) emailEl.textContent = req.email || 'No email on file';

    const phoneEl = document.getElementById('maintDetailPhone');
    if (phoneEl) phoneEl.textContent = req.phone_number || 'No contact number';

    const roomEl = document.getElementById('maintDetailRoomNumber');
    if (roomEl) roomEl.textContent = req.room_number ? `Room ${req.room_number}` : 'Unassigned Unit';

    // Elapsed / SLA Badge
    const elapsedBadge = document.getElementById('maintDetailElapsedBadge');
    if (elapsedBadge) {
        const info = getElapsedInfo(req.reported_at, req.ai_urgency);
        if (info.isOverdue) {
            elapsedBadge.innerHTML = `<span class="badge bg-danger">Overdue SLA</span> <span class="text-danger ms-1 fw-semibold">${info.elapsed}</span>`;
        } else {
            elapsedBadge.innerHTML = `<span class="badge bg-success-subtle text-success border border-success-subtle">Within SLA</span> <span class="text-muted ms-1">${info.elapsed}</span>`;
        }
    }

    // Complete Description
    const descEl = document.getElementById('maintDetailDescription');
    if (descEl) descEl.textContent = req.description || 'No description provided by tenant.';

    // AI Diagnostics
    const aiSection = document.getElementById('maintDetailAiSection');
    if (aiSection) {
        if (req.ai_summary || req.ai_category || req.ai_urgency) {
            aiSection.style.display = 'block';
            const aiSummaryEl = document.getElementById('maintDetailAiSummary');
            if (aiSummaryEl) aiSummaryEl.textContent = req.ai_summary || 'No diagnostic summary generated.';

            const aiCategoryEl = document.getElementById('maintDetailAiCategory');
            if (aiCategoryEl) aiCategoryEl.textContent = `Category: ${req.ai_category || 'General'}`;

            const aiUrgencyEl = document.getElementById('maintDetailAiUrgency');
            if (aiUrgencyEl) aiUrgencyEl.textContent = `SLA: ${req.ai_urgency || 'Standard'}`;

            const aiConfidenceEl = document.getElementById('maintDetailAiConfidence');
            if (aiConfidenceEl) {
                aiConfidenceEl.textContent = req.ai_confidence
                    ? `${Math.round(req.ai_confidence * 100)}%`
                    : 'N/A';
            }
        } else {
            aiSection.style.display = 'none';
        }
    }

    // Photo Proof
    const photoSection = document.getElementById('maintDetailPhotoSection');
    const photoImg = document.getElementById('maintDetailPhotoImg');
    if (photoSection && photoImg) {
        if (req.photo_url && req.photo_url !== 'null' && req.photo_url !== 'undefined') {
            photoSection.style.display = 'block';
            photoImg.src = req.photo_url;
        } else {
            photoSection.style.display = 'none';
            photoImg.src = '';
        }
    }

    // Update Form fields
    const idInput = document.getElementById('maintDetailId');
    if (idInput) idInput.value = req.id;

    const statusSelect = document.getElementById('maintDetailNewStatus');
    if (statusSelect) statusSelect.value = req.status || 'pending';

    const noteTextarea = document.getElementById('maintDetailAdminNote');
    if (noteTextarea) noteTextarea.value = req.admin_note || '';

    // Show modal
    const modalEl = document.getElementById('maintenanceDetailModal');
    if (modalEl) {
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();
    }
}

// ── Legacy proxy for backwards compatibility ──
function openUpdateStatusModal(id, currentStatus) {
    openMaintenanceDetailModal(id);
}

// ── Submit Status Update from Modal ──
async function submitModalStatusUpdate() {
    const idInput = document.getElementById('maintDetailId');
    const id = idInput ? idInput.value : null;
    if (!id) return;

    const status = document.getElementById('maintDetailNewStatus')?.value || 'pending';
    const adminNote = document.getElementById('maintDetailAdminNote')?.value.trim() || '';
    const submitBtn = document.getElementById('maintDetailSaveBtn');

    // UI Loading state
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Updating...';
    }

    try {
        const res = await fetch(`/api/admin/maintenance/${id}/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status, admin_note: adminNote }),
            credentials: 'include'
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update maintenance request');

        // Close modal
        const modalEl = document.getElementById('maintenanceDetailModal');
        if (modalEl) {
            const modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();
        }

        // Show clean notification (Zero Emojis)
        const statusLabel = status.replace('_', ' ').toUpperCase();
        showMaintenanceToast(`Request updated to ${statusLabel}. Tenant notified via email.`);

        // Refresh board in real time
        await loadMaintenance();
    } catch (err) {
        console.error('[submitModalStatusUpdate] Error:', err);
        showMaintenanceToast('Error updating maintenance status. Please try again.', 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-check me-1"></i>Update Status &amp; Notify Tenant';
        }
    }
}

// Fallback legacy submit function
function submitStatusUpdate() {
    submitModalStatusUpdate();
}

// ── Toast Notification (Academic Standard: Zero Emojis) ──
function showMaintenanceToast(message, type = 'success') {
    document.getElementById('maint-toast')?.remove();
    const bgColor = type === 'success'
        ? 'linear-gradient(135deg, #1a7a4a, #27ae60)'
        : 'linear-gradient(135deg, #8b1a1a, #e74c3c)';
    const icon = type === 'success'
        ? '<i class="fas fa-check"></i>'
        : '<i class="fas fa-times"></i>';

    const toast = document.createElement('div');
    toast.id = 'maint-toast';
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
        animation: toastIn 0.3s ease;
    `;
    toast.innerHTML = `
        <span style="width: 26px; height: 26px; border-radius: 50%; background: rgba(255,255,255,0.25); display: flex; align-items: center; justify-content: center; font-size: 0.8rem; flex-shrink: 0;">
            ${icon}
        </span>
        <span>${message}</span>
    `;

    if (!document.getElementById('maint-toast-style')) {
        const s = document.createElement('style');
        s.id = 'maint-toast-style';
        s.textContent = '@keyframes toastIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}@keyframes toastOut{from{opacity:1}to{opacity:0;transform:translateY(10px)}}';
        document.head.appendChild(s);
    }

    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'toastOut 0.35s ease forwards';
        setTimeout(() => toast.remove(), 400);
    }, 4000);
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
            showMaintenanceToast('Meter reading saved successfully.');
        } else {
            alert('Failed to record meter reading: ' + (data.error || 'Unknown error'));
        }
    } catch (err) {
        console.error('[submitAddReading]', err);
        alert('Network error. Please try again.');
    }
}

