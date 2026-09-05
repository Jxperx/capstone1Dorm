// ═══════════════════════════════════════════════════
//  ROOM & UNIT MANAGEMENT MODULE
// ═══════════════════════════════════════════════════

// --- Enterprise Toast & Confirmation Helpers ---
window.showEnterpriseToast = function(message, type = 'success') {
    const container = document.getElementById('enterpriseToastContainer');
    if (!container) {
        console.log(`[Enterprise Toast ${type}]:`, message);
        return;
    }

    let iconClass = 'fa-check-circle text-success';
    let borderClass = 'border-success';
    let titleText = 'Success';
    if (type === 'error' || type === 'danger') {
        iconClass = 'fa-exclamation-circle text-danger';
        borderClass = 'border-danger';
        titleText = 'Notice';
    } else if (type === 'warning') {
        iconClass = 'fa-exclamation-triangle text-warning';
        borderClass = 'border-warning';
        titleText = 'Warning';
    } else if (type === 'info') {
        iconClass = 'fa-info-circle text-info';
        borderClass = 'border-info';
        titleText = 'Information';
    }

    const toastId = 'toast_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    const toastHtml = `
        <div id="${toastId}" class="toast align-items-center border-start border-4 ${borderClass} bg-white shadow-lg rounded-3 mb-2" role="alert" aria-live="assertive" aria-atomic="true">
            <div class="toast-header border-0 bg-white py-2 px-3">
                <i class="fas ${iconClass} me-2"></i>
                <strong class="me-auto text-dark" style="font-size: 0.85rem;">${titleText}</strong>
                <button type="button" class="btn-close ms-2" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
            <div class="toast-body py-2 px-3 text-secondary" style="font-size: 0.9rem;">
                ${message}
            </div>
        </div>
    `;
    container.insertAdjacentHTML('beforeend', toastHtml);
    const toastEl = document.getElementById(toastId);
    if (toastEl && window.bootstrap && bootstrap.Toast) {
        const bsToast = new bootstrap.Toast(toastEl, { delay: 4000 });
        toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
        bsToast.show();
    } else {
        setTimeout(() => toastEl?.remove(), 4000);
    }
};

let enterpriseConfirmCallback = null;
window.showEnterpriseConfirm = function({ title = 'Confirm Action', message, confirmText = 'Confirm', confirmClass = 'btn-danger', iconClass = 'fas fa-exclamation-triangle text-warning', onConfirm }) {
    const modalEl = document.getElementById('enterpriseConfirmModal');
    if (!modalEl || !window.bootstrap) {
        if (confirm(message)) {
            if (typeof onConfirm === 'function') onConfirm();
        }
        return;
    }
    const titleEl = document.getElementById('enterpriseConfirmTitle');
    const msgEl = document.getElementById('enterpriseConfirmMessage');
    const iconEl = document.getElementById('enterpriseConfirmIcon');
    const btnEl = document.getElementById('enterpriseConfirmActionBtn');

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    if (iconEl) iconEl.className = iconClass + ' me-2';
    if (btnEl) {
        btnEl.textContent = confirmText;
        btnEl.className = `btn rounded-pill px-4 fw-semibold ${confirmClass}`;
        enterpriseConfirmCallback = onConfirm;
        btnEl.onclick = () => {
            const bsModal = bootstrap.Modal.getInstance(modalEl);
            if (bsModal) bsModal.hide();
            if (typeof enterpriseConfirmCallback === 'function') {
                enterpriseConfirmCallback();
            }
        };
    }
    const bsModal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
    bsModal.show();
};

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// --- Global Caches & State ---
let allRooms = [];
let currentOpenUnitModalRoomId = null;
let currentRoomFilter = 'all'; // 'all' | 'available' | 'occupied'
let currentRoomSearchQuery = '';

// --- Metric Ribbon Calculation ---
function updateInventoryMetrics(rooms) {
    if (!Array.isArray(rooms)) return;
    const totalUnits = rooms.length;
    let dormsCount = 0;
    let condosCount = 0;
    let totalResidents = 0;
    let totalCapacity = 0;
    let availableUnits = 0;
    let occupiedUnits = 0;

    rooms.forEach(r => {
        const isCondo = r.room_type === 'condo';
        const active = Number(r.active_tenants) || 0;
        const capacity = isCondo ? 1 : (Number(r.capacity) || 1);

        if (isCondo) condosCount++;
        else dormsCount++;

        totalResidents += active;
        totalCapacity += capacity;

        if (isCondo) {
            if (active > 0) occupiedUnits++;
            else availableUnits++;
        } else {
            if (active >= capacity) occupiedUnits++;
            else availableUnits++;
        }
    });

    const occupancyRate = totalCapacity > 0 ? Math.round((totalResidents / totalCapacity) * 100) : 0;

    const elTotalUnits = document.getElementById('metricTotalUnits');
    const elUnitsSub = document.getElementById('metricUnitsSub');
    const elAvailable = document.getElementById('metricAvailableUnits');
    const elAvailableSub = document.getElementById('metricAvailableSub');
    const elOccupied = document.getElementById('metricOccupiedUnits');
    const elOccupiedSub = document.getElementById('metricOccupiedSub');
    const elResidents = document.getElementById('metricTotalResidents');
    const elResidentsSub = document.getElementById('metricResidentsSub');
    const elRate = document.getElementById('metricOccupancyRate');
    const elRateSub = document.getElementById('metricRateSub');

    if (elTotalUnits) elTotalUnits.textContent = totalUnits;
    if (elUnitsSub) elUnitsSub.textContent = `${dormsCount} Dorms, ${condosCount} Condos`;
    if (elAvailable) elAvailable.textContent = availableUnits;
    if (elAvailableSub) elAvailableSub.textContent = `${availableUnits} units with open capacity`;
    if (elOccupied) elOccupied.textContent = occupiedUnits;
    if (elOccupiedSub) elOccupiedSub.textContent = `${occupiedUnits} fully occupied`;
    if (elResidents) elResidents.textContent = totalResidents;
    if (elResidentsSub) elResidentsSub.textContent = `${totalCapacity} total bed/unit capacity`;
    if (elRate) elRate.textContent = `${occupancyRate}%`;
    if (elRateSub) elRateSub.textContent = `${totalResidents} of ${totalCapacity} utilized`;
}

// --- Search & Filter Controls ---
function setRoomFilter(filterType) {
    currentRoomFilter = filterType;
    document.querySelectorAll('.room-filter-btn').forEach(btn => {
        const type = btn.getAttribute('data-filter') || btn.id.replace('btnFilter', '').toLowerCase();
        if (type === filterType) {
            btn.classList.add('active');
            if (filterType === 'all') btn.className = 'btn btn-sm btn-primary rounded-pill px-3 room-filter-btn active';
            else if (filterType === 'available') btn.className = 'btn btn-sm btn-success rounded-pill px-3 room-filter-btn active';
            else if (filterType === 'occupied') btn.className = 'btn btn-sm btn-danger rounded-pill px-3 room-filter-btn active';
        } else {
            btn.classList.remove('active');
            if (type === 'all') btn.className = 'btn btn-sm btn-outline-primary rounded-pill px-3 room-filter-btn';
            else if (type === 'available') btn.className = 'btn btn-sm btn-outline-success rounded-pill px-3 room-filter-btn';
            else if (type === 'occupied') btn.className = 'btn btn-sm btn-outline-danger rounded-pill px-3 room-filter-btn';
        }
    });
    applyRoomFilters();
}

function filterRoomTables() {
    const input = document.getElementById('roomSearchInput');
    currentRoomSearchQuery = input ? input.value.trim().toLowerCase() : '';
    applyRoomFilters();
}

function applyRoomFilters() {
    const dormRows = document.querySelectorAll('#dormsTableBody tr[data-room-number]');
    const condoRows = document.querySelectorAll('#condosTableBody tr[data-room-number]');

    let visibleDorms = 0;
    dormRows.forEach(row => {
        const roomNum = (row.getAttribute('data-room-number') || '').toLowerCase();
        const isAvailable = row.getAttribute('data-available') === 'true';

        let matchesFilter = true;
        if (currentRoomFilter === 'available') matchesFilter = isAvailable;
        else if (currentRoomFilter === 'occupied') matchesFilter = !isAvailable;

        let matchesSearch = true;
        if (currentRoomSearchQuery) {
            matchesSearch = roomNum.includes(currentRoomSearchQuery);
        }

        if (matchesFilter && matchesSearch) {
            row.style.display = '';
            visibleDorms++;
        } else {
            row.style.display = 'none';
        }
    });

    let dormEmptyMsg = document.getElementById('dormEmptyFilterMsg');
    if (visibleDorms === 0 && dormRows.length > 0) {
        if (!dormEmptyMsg) {
            const tr = document.createElement('tr');
            tr.id = 'dormEmptyFilterMsg';
            tr.innerHTML = '<td colspan="6" class="text-center py-4 text-muted"><i class="fas fa-search me-2"></i>No dormitories match your search or filter.</td>';
            document.getElementById('dormsTableBody')?.appendChild(tr);
        }
    } else if (dormEmptyMsg) {
        dormEmptyMsg.remove();
    }

    let visibleCondos = 0;
    condoRows.forEach(row => {
        const roomNum = (row.getAttribute('data-room-number') || '').toLowerCase();
        const isAvailable = row.getAttribute('data-available') === 'true';

        let matchesFilter = true;
        if (currentRoomFilter === 'available') matchesFilter = isAvailable;
        else if (currentRoomFilter === 'occupied') matchesFilter = !isAvailable;

        let matchesSearch = true;
        if (currentRoomSearchQuery) {
            matchesSearch = roomNum.includes(currentRoomSearchQuery);
        }

        if (matchesFilter && matchesSearch) {
            row.style.display = '';
            visibleCondos++;
        } else {
            row.style.display = 'none';
        }
    });

    let condoEmptyMsg = document.getElementById('condoEmptyFilterMsg');
    if (visibleCondos === 0 && condoRows.length > 0) {
        if (!condoEmptyMsg) {
            const tr = document.createElement('tr');
            tr.id = 'condoEmptyFilterMsg';
            tr.innerHTML = '<td colspan="3" class="text-center py-4 text-muted"><i class="fas fa-search me-2"></i>No condo units match your search or filter.</td>';
            document.getElementById('condosTableBody')?.appendChild(tr);
        }
    } else if (condoEmptyMsg) {
        condoEmptyMsg.remove();
    }
}

// --- Unit Occupants Modal (Condo & Dorm) ---
async function openUnitOccupantsModal(roomId, isBackgroundRefresh = false) {
    try {
        currentOpenUnitModalRoomId = roomId;
        let room = allRooms.find(r => Number(r.id) === Number(roomId));
        if (!room) {
            await loadRooms();
            room = allRooms.find(r => Number(r.id) === Number(roomId));
        }
        if (!room) {
            console.error('Room not found for id:', roomId);
            return;
        }

        const modalEl = document.getElementById('unitOccupantsModal');
        if (!modalEl) {
            console.error('unitOccupantsModal element not found in DOM');
            return;
        }

        const titleEl = document.getElementById('unitModalTitle');
        const typeBadge = document.getElementById('unitModalTypeBadge');
        const metaEl = document.getElementById('unitModalMeta');
        const occupancyText = document.getElementById('unitModalOccupancyText');
        const editBtn = document.getElementById('unitModalEditRoomBtn');

        const isCondo = room.room_type === 'condo';
        const capacity = Number(room.capacity) || 1;
        const monthlyRateFormatted = Number(room.monthly_rate || 0).toLocaleString();

        if (titleEl) titleEl.textContent = `${isCondo ? 'Condo Unit' : 'Room'} ${room.room_number}`;
        if (typeBadge) {
            typeBadge.textContent = isCondo ? 'Condo Unit' : 'Dormitory';
            typeBadge.className = isCondo ? 'badge bg-info text-dark text-uppercase fw-semibold' : 'badge bg-secondary text-uppercase fw-semibold';
        }

        if (editBtn) {
            editBtn.onclick = () => {
                const inst = bootstrap.Modal.getInstance(modalEl);
                if (inst) inst.hide();
                openRoomModal(room.id);
            };
        }

        // Fetch latest tenants for this specific room
        let occupants = [];
        try {
            const res = await fetch(`/api/rooms/${room.id}/occupants`, { credentials: 'include' });
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data)) {
                    occupants = data;
                }
            }
            
            // Fallback to general admin tenants if dedicated endpoint was empty or unavailable
            if (occupants.length === 0) {
                const fallbackRes = await fetch('/api/admin/tenants', { credentials: 'include' });
                if (fallbackRes.ok) {
                    const allTenants = await fallbackRes.json();
                    if (Array.isArray(allTenants)) {
                        occupants = allTenants.filter(t => (Number(t.room_id) === Number(room.id) || String(t.room_number) === String(room.room_number)) && t.status !== 'archived');
                    }
                }
            }
        } catch (e) {
            console.error('Error fetching occupants for unit modal:', e);
        }

        const activeCount = occupants.length;
        const countEl = document.getElementById('unitModalOccupantsCount');
        const vacantCountEl = document.getElementById('unitModalVacantCount');
        const occupancyLabelEl = document.getElementById('unitModalOccupancyLabel');
        const occupantsTitleEl = document.getElementById('unitModalOccupantsTitleText');
        const capacitySection = document.getElementById('unitAvailableCapacitySection');
        const capacityTitleEl = document.getElementById('unitModalCapacityTitleText');
        const listEl = document.getElementById('unitOccupantsList');
        const vacantListEl = document.getElementById('unitVacantSlotsList');

        if (isCondo) {
            // ── CONDO UNIT (Whole Unit Rental Model) ──
            if (metaEl) metaEl.textContent = `Monthly Rate: PHP ${monthlyRateFormatted} | Whole Unit Rental`;
            if (occupancyLabelEl) occupancyLabelEl.textContent = 'Unit Status:';
            
            const isOccupied = activeCount > 0;
            if (occupancyText) {
                occupancyText.innerHTML = isOccupied
                    ? '<span class="badge bg-danger text-uppercase fw-semibold" style="letter-spacing:0.5px;font-size:0.85rem;">OCCUPIED</span>'
                    : '<span class="badge bg-success text-uppercase fw-semibold" style="letter-spacing:0.5px;font-size:0.85rem;">AVAILABLE</span>';
            }

            if (occupantsTitleEl) occupantsTitleEl.textContent = 'Current Tenant';
            if (countEl) countEl.textContent = activeCount;

            // Render Condo Tenant
            if (listEl) {
                if (!isOccupied) {
                    listEl.innerHTML = `
                        <div class="p-4 text-center border rounded bg-light text-muted">
                            <p class="mb-1 fw-semibold text-dark">No tenant currently assigned to this condo unit.</p>
                            <small>Assign a tenant below to occupy this unit.</small>
                        </div>
                    `;
                } else {
                    listEl.innerHTML = occupants.map((t) => {
                        const profileImg = t.profile_image_url || 'https://via.placeholder.com/44';
                        const statusBadge = t.status === 'pending'
                            ? '<span class="badge bg-warning text-dark text-uppercase fw-semibold" style="letter-spacing:0.5px;">PENDING SETUP</span>'
                            : t.status === 'active'
                            ? '<span class="badge bg-success text-uppercase fw-semibold" style="letter-spacing:0.5px;">ACTIVE</span>'
                            : '<span class="badge bg-secondary text-uppercase fw-semibold" style="letter-spacing:0.5px;">ARCHIVED</span>';

                        const leaseStart = t.lease_start_date ? new Date(t.lease_start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not set';
                        const leaseEnd = t.lease_end_date ? new Date(t.lease_end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not set';
                        const tData = JSON.stringify(t).replace(/'/g, "&apos;");

                        let expiryBadge = '';
                        if (t.lease_end_date) {
                            const endDate = new Date(t.lease_end_date);
                            const today = new Date();
                            today.setHours(0, 0, 0, 0);
                            endDate.setHours(0, 0, 0, 0);
                            const diffTime = endDate.getTime() - today.getTime();
                            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                            if (diffDays < 0) {
                                const absDays = Math.abs(diffDays);
                                expiryBadge = `<span class="badge bg-danger text-uppercase fw-semibold" style="letter-spacing:0.5px;">[EXPIRED ${absDays} ${absDays === 1 ? 'DAY' : 'DAYS'} AGO]</span>`;
                            } else if (diffDays <= 30) {
                                expiryBadge = `<span class="badge bg-warning text-dark text-uppercase fw-semibold" style="letter-spacing:0.5px;">[EXPIRES IN ${diffDays} ${diffDays === 1 ? 'DAY' : 'DAYS'}]</span>`;
                            } else {
                                expiryBadge = `<span class="badge bg-info text-dark text-uppercase fw-semibold" style="letter-spacing:0.5px;">[ACTIVE - ${diffDays} DAYS LEFT]</span>`;
                            }
                        }

                        return `
                            <div class="card mb-3 border shadow-sm">
                                <div class="card-body p-3">
                                    <div class="d-flex justify-content-between align-items-start flex-wrap gap-2">
                                        <div class="d-flex align-items-center">
                                            <img src="${profileImg}" class="rounded-circle me-3 border" width="44" height="44" style="object-fit: cover;">
                                            <div>
                                                <div class="d-flex align-items-center gap-2 flex-wrap">
                                                    <h6 class="mb-0 fw-bold text-dark">${escapeHtml(t.full_name)}</h6>
                                                    <span class="badge bg-light text-dark border">Condo Resident</span>
                                                    ${expiryBadge}
                                                </div>
                                                <div class="text-muted small mt-1">
                                                    ${escapeHtml(t.email)} | Contact: ${escapeHtml(t.phone_number || 'N/A')}
                                                </div>
                                                <div class="text-secondary small mt-1">
                                                    Guardian: ${t.guardian_name ? `${escapeHtml(t.guardian_name)} (${escapeHtml(t.guardian_contact || 'N/A')})` : 'Not provided'}
                                                </div>
                                            </div>
                                        </div>
                                        <div class="text-end">
                                            <div>${statusBadge}</div>
                                            <div class="small text-muted mt-1">Lease: ${leaseStart} to ${leaseEnd}</div>
                                        </div>
                                    </div>
                                    <div class="d-flex justify-content-end gap-2 mt-3 pt-2 border-top flex-wrap">
                                        <button class="btn btn-sm btn-outline-secondary" onclick="resendTenantInvite(${t.id})">
                                            Resend Setup Link
                                        </button>
                                        <button class="btn btn-sm btn-outline-primary" data-tenant='${tData}' onclick='openEditTenantModalFromBtn(this)'>
                                            Edit Profile
                                        </button>
                                        <button class="btn btn-sm btn-outline-info" onclick="openTransferTenantModal(${t.id}, '${escapeHtml(t.full_name)}', ${room.id})">
                                            <i class="fas fa-exchange-alt me-1"></i> Transfer Unit
                                        </button>
                                        <button class="btn btn-sm btn-outline-warning text-dark" onclick="openQuickLeaseExtension(${t.id}, '${escapeHtml(t.full_name)}', 'Condo Unit ${room.room_number}', '${t.lease_end_date || ''}')">
                                            <i class="fas fa-file-signature me-1"></i> Extend Lease
                                        </button>
                                        <button class="btn btn-sm btn-outline-warning text-dark" onclick="endLease(${t.id})">
                                            End Lease
                                        </button>
                                        <button class="btn btn-sm btn-outline-danger" onclick="deleteTenant(${t.id})">
                                            Remove
                                        </button>
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('');
                }
            }

            // Available Capacity Section for Condo
            if (capacitySection) {
                if (isOccupied) {
                    capacitySection.style.display = 'none';
                } else {
                    capacitySection.style.display = 'block';
                    if (capacityTitleEl) capacityTitleEl.textContent = 'Unit Availability';
                    if (vacantCountEl) vacantCountEl.textContent = 'Vacant';
                    if (vacantListEl) {
                        vacantListEl.innerHTML = `
                            <div class="border border-dashed rounded p-3 mb-2 d-flex justify-content-between align-items-center bg-light flex-wrap gap-2">
                                <div>
                                    <div class="fw-semibold text-dark">Condo Unit is Vacant</div>
                                    <div class="small text-muted">Ready to assign a tenant to this unit</div>
                                </div>
                                <button class="btn btn-sm btn-primary" onclick="assignTenantToRoom(${room.id})">
                                    Assign Tenant to Unit
                                </button>
                            </div>
                        `;
                    }
                }
            }

        } else {
            // ── DORMITORY (Multi-Bed / Shared Capacity Model) ──
            const vacantCount = Math.max(0, capacity - activeCount);
            if (metaEl) metaEl.textContent = `Monthly Rate: PHP ${monthlyRateFormatted} | Capacity: ${capacity} ${capacity === 1 ? 'Bed' : 'Beds'}`;
            if (occupancyLabelEl) occupancyLabelEl.textContent = 'Current Occupancy:';

            if (occupancyText) {
                const pct = Math.round((activeCount / capacity) * 100);
                let badgeClass = 'text-success';
                if (pct >= 100) badgeClass = 'text-danger';
                else if (pct >= 50) badgeClass = 'text-warning';
                occupancyText.innerHTML = `<span class="${badgeClass}">${activeCount} of ${capacity} Occupied (${pct}%)</span>`;
            }

            if (occupantsTitleEl) occupantsTitleEl.textContent = 'Active Occupants';
            if (countEl) countEl.textContent = activeCount;

            // Render Dorm Occupants
            if (listEl) {
                if (occupants.length === 0) {
                    listEl.innerHTML = `
                        <div class="p-4 text-center border rounded bg-light text-muted">
                            <p class="mb-1 fw-semibold text-dark">No active occupants assigned to this dormitory.</p>
                            <small>Select an available bed slot below to assign a new tenant.</small>
                        </div>
                    `;
                } else {
                    listEl.innerHTML = occupants.map((t, idx) => {
                        const bedLetter = String.fromCharCode(65 + (idx % 26));
                        const profileImg = t.profile_image_url || 'https://via.placeholder.com/44';

                        const statusBadge = t.status === 'pending'
                            ? '<span class="badge bg-warning text-dark text-uppercase fw-semibold" style="letter-spacing:0.5px;">PENDING SETUP</span>'
                            : t.status === 'active'
                            ? '<span class="badge bg-success text-uppercase fw-semibold" style="letter-spacing:0.5px;">ACTIVE</span>'
                            : '<span class="badge bg-secondary text-uppercase fw-semibold" style="letter-spacing:0.5px;">ARCHIVED</span>';

                        const leaseStart = t.lease_start_date ? new Date(t.lease_start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not set';
                        const leaseEnd = t.lease_end_date ? new Date(t.lease_end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not set';
                        const tData = JSON.stringify(t).replace(/'/g, "&apos;");

                        let expiryBadge = '';
                        if (t.lease_end_date) {
                            const endDate = new Date(t.lease_end_date);
                            const today = new Date();
                            today.setHours(0, 0, 0, 0);
                            endDate.setHours(0, 0, 0, 0);
                            const diffTime = endDate.getTime() - today.getTime();
                            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                            if (diffDays < 0) {
                                const absDays = Math.abs(diffDays);
                                expiryBadge = `<span class="badge bg-danger text-uppercase fw-semibold" style="letter-spacing:0.5px;">[EXPIRED ${absDays} ${absDays === 1 ? 'DAY' : 'DAYS'} AGO]</span>`;
                            } else if (diffDays <= 30) {
                                expiryBadge = `<span class="badge bg-warning text-dark text-uppercase fw-semibold" style="letter-spacing:0.5px;">[EXPIRES IN ${diffDays} ${diffDays === 1 ? 'DAY' : 'DAYS'}]</span>`;
                            } else {
                                expiryBadge = `<span class="badge bg-info text-dark text-uppercase fw-semibold" style="letter-spacing:0.5px;">[ACTIVE - ${diffDays} DAYS LEFT]</span>`;
                            }
                        }

                        return `
                            <div class="card mb-3 border shadow-sm">
                                <div class="card-body p-3">
                                    <div class="d-flex justify-content-between align-items-start flex-wrap gap-2">
                                        <div class="d-flex align-items-center">
                                            <img src="${profileImg}" class="rounded-circle me-3 border" width="44" height="44" style="object-fit: cover;">
                                            <div>
                                                <div class="d-flex align-items-center gap-2 flex-wrap">
                                                    <h6 class="mb-0 fw-bold text-dark">${escapeHtml(t.full_name)}</h6>
                                                    <span class="badge bg-light text-dark border">Bed ${bedLetter}</span>
                                                    ${expiryBadge}
                                                </div>
                                                <div class="text-muted small mt-1">
                                                    ${escapeHtml(t.email)} | Contact: ${escapeHtml(t.phone_number || 'N/A')}
                                                </div>
                                                <div class="text-secondary small mt-1">
                                                    Guardian: ${t.guardian_name ? `${escapeHtml(t.guardian_name)} (${escapeHtml(t.guardian_contact || 'N/A')})` : 'Not provided'}
                                                </div>
                                            </div>
                                        </div>
                                        <div class="text-end">
                                            <div>${statusBadge}</div>
                                            <div class="small text-muted mt-1">Lease: ${leaseStart} to ${leaseEnd}</div>
                                        </div>
                                    </div>
                                    <div class="d-flex justify-content-end gap-2 mt-3 pt-2 border-top flex-wrap">
                                        <button class="btn btn-sm btn-outline-secondary" onclick="resendTenantInvite(${t.id})">
                                            Resend Setup Link
                                        </button>
                                        <button class="btn btn-sm btn-outline-primary" data-tenant='${tData}' onclick='openEditTenantModalFromBtn(this)'>
                                            Edit Profile
                                        </button>
                                        <button class="btn btn-sm btn-outline-info" onclick="openTransferTenantModal(${t.id}, '${escapeHtml(t.full_name)}', ${room.id})">
                                            <i class="fas fa-exchange-alt me-1"></i> Transfer Unit
                                        </button>
                                        <button class="btn btn-sm btn-outline-warning text-dark" onclick="openQuickLeaseExtension(${t.id}, '${escapeHtml(t.full_name)}', 'Room ${room.room_number}', '${t.lease_end_date || ''}')">
                                            <i class="fas fa-file-signature me-1"></i> Extend Lease
                                        </button>
                                        <button class="btn btn-sm btn-outline-danger" onclick="endLease(${t.id})">
                                            End Lease
                                        </button>
                                        <button class="btn btn-sm btn-outline-danger" onclick="deleteTenant(${t.id})">
                                            Remove
                                        </button>
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('');
                }
            }

            // Available Capacity Section for Dormitory
            if (capacitySection) {
                capacitySection.style.display = 'block';
                if (capacityTitleEl) capacityTitleEl.textContent = 'Available Capacity';
                if (vacantCountEl) vacantCountEl.textContent = vacantCount;
                if (vacantListEl) {
                    if (vacantCount === 0) {
                        vacantListEl.innerHTML = `
                            <div class="p-3 text-center border rounded bg-light text-muted small">
                                This dormitory is currently at full capacity (${capacity} of ${capacity} beds occupied).
                            </div>
                        `;
                    } else {
                        let vacantHtml = '';
                        for (let i = 0; i < vacantCount; i++) {
                            const bedLetter = String.fromCharCode(65 + activeCount + i);
                            vacantHtml += `
                                <div class="border border-dashed rounded p-3 mb-2 d-flex justify-content-between align-items-center bg-light flex-wrap gap-2">
                                    <div>
                                        <div class="fw-semibold text-dark">Vacant Bed Slot (${bedLetter})</div>
                                        <div class="small text-muted">Ready for new tenant assignment</div>
                                    </div>
                                    <button class="btn btn-sm btn-primary" onclick="assignTenantToRoom(${room.id})">
                                        Assign Tenant to Bed ${bedLetter}
                                    </button>
                                </div>
                            `;
                        }
                        vacantListEl.innerHTML = vacantHtml;
                    }
                }
            }
        }

        if (!isBackgroundRefresh) {
            const bsModal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
            bsModal.show();
        }
    } catch (err) {
        console.error('Error opening unit occupants modal:', err);
    }
}

function assignTenantToRoom(roomId) {
    const modalEl = document.getElementById('unitOccupantsModal');
    const bsModal = bootstrap.Modal.getInstance(modalEl);
    if (bsModal) bsModal.hide();
    prepareAddTenant(roomId);
}

// --- Tenant Unit Transfer Logic ---
function openTransferTenantModal(tenantId, tenantName, currentRoomId) {
    const tenantIdEl = document.getElementById('transferTenantId');
    const curRoomIdEl = document.getElementById('transferCurrentRoomId');
    const tenantNameEl = document.getElementById('transferTenantName');
    const curRoomNameEl = document.getElementById('transferCurrentRoomName');
    const targetSelect = document.getElementById('transferTargetRoomSelect');

    if (tenantIdEl) tenantIdEl.value = tenantId;
    if (curRoomIdEl) curRoomIdEl.value = currentRoomId;
    if (tenantNameEl) tenantNameEl.textContent = tenantName;

    const curRoom = allRooms.find(r => Number(r.id) === Number(currentRoomId));
    if (curRoomNameEl) {
        curRoomNameEl.textContent = curRoom ? `${curRoom.room_type === 'condo' ? 'Condo Unit' : 'Room'} ${curRoom.room_number}` : `Room #${currentRoomId}`;
    }

    if (targetSelect) {
        targetSelect.innerHTML = '<option value="">-- Select Available Unit --</option>';
        const availableRooms = allRooms.filter(r => {
            if (Number(r.id) === Number(currentRoomId)) return false;
            const active = Number(r.active_tenants) || 0;
            const cap = r.room_type === 'condo' ? 1 : (Number(r.capacity) || 1);
            return active < cap;
        });

        if (availableRooms.length === 0) {
            targetSelect.innerHTML += '<option value="" disabled>No other units currently have open capacity</option>';
        } else {
            availableRooms.forEach(r => {
                const isCondo = r.room_type === 'condo';
                const active = Number(r.active_tenants) || 0;
                const cap = isCondo ? 1 : (Number(r.capacity) || 1);
                const openSlots = cap - active;
                const slotText = isCondo ? 'Vacant Unit' : `${openSlots} of ${cap} beds available`;
                const label = `${isCondo ? 'Condo Unit' : 'Room'} ${r.room_number} (PHP ${Number(r.monthly_rate).toLocaleString()}/mo - ${slotText})`;
                targetSelect.innerHTML += `<option value="${r.id}">${label}</option>`;
            });
        }
    }

    const modalEl = document.getElementById('transferTenantModal');
    if (modalEl) {
        const bsModal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
        bsModal.show();
    }
}

async function submitTenantTransfer() {
    const tenantId = document.getElementById('transferTenantId')?.value;
    const targetRoomId = document.getElementById('transferTargetRoomSelect')?.value;
    const btn = document.getElementById('transferSubmitBtn');

    if (!tenantId || !targetRoomId) {
        window.showEnterpriseToast('Please select an available target room or unit.', 'warning');
        return;
    }

    const origBtnHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Transferring...';
    }

    try {
        const res = await fetch(`/api/admin/tenants/${tenantId}/transfer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetRoomId: parseInt(targetRoomId, 10) }),
            credentials: 'include'
        });
        const data = await res.json();

        if (res.ok) {
            const modalEl = document.getElementById('transferTenantModal');
            if (modalEl) {
                const bsModal = bootstrap.Modal.getInstance(modalEl);
                if (bsModal) bsModal.hide();
            }
            window.showEnterpriseToast(data.message || 'Tenant transferred successfully.');
            await loadRooms();
        } else {
            window.showEnterpriseToast(data.error || 'Failed to transfer tenant.', 'error');
        }
    } catch (err) {
        console.error('[Tenant Transfer Error]:', err);
        window.showEnterpriseToast('Network error transferring tenant.', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = origBtnHtml;
        }
    }
}

// --- Quick Lease Extension Shortcut ---
function openQuickLeaseExtension(tenantId, tenantName, roomName, leaseEndDate) {
    const tenantIdEl = document.getElementById('renewTenantId');
    const tenantNameEl = document.getElementById('renewTenantName');
    const tenantRoomEl = document.getElementById('renewTenantRoom');
    const currentEndEl = document.getElementById('renewCurrentEnd');

    if (tenantIdEl) tenantIdEl.value = tenantId;
    if (tenantNameEl) tenantNameEl.textContent = tenantName;
    if (tenantRoomEl) tenantRoomEl.textContent = roomName;
    if (currentEndEl) {
        currentEndEl.textContent = leaseEndDate ? new Date(leaseEndDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A';
    }

    if (typeof setQuickExtension === 'function') {
        setQuickExtension(6);
    } else {
        let baseDate = leaseEndDate ? new Date(leaseEndDate) : new Date();
        if (isNaN(baseDate.getTime()) || baseDate < new Date()) baseDate = new Date();
        baseDate.setMonth(baseDate.getMonth() + 6);
        const inputEl = document.getElementById('renewNewEndDate');
        if (inputEl) inputEl.value = baseDate.toISOString().split('T')[0];
    }

    const modalEl = document.getElementById('renewLeaseModal');
    if (modalEl) {
        const bsModal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
        bsModal.show();
    }
}

// --- Room Create / Edit / Delete ---
function openRoomModal(roomId = null) {
    const modalTitle = document.getElementById('roomModalTitle');
    const form = document.getElementById('roomForm');
    document.getElementById('roomId').value = '';
    
    if (roomId) {
        const room = allRooms.find(r => r.id === roomId);
        if (room) {
            modalTitle.textContent = 'Edit Room';
            document.getElementById('roomId').value = room.id;
            document.getElementById('roomNumber').value = room.room_number;
            document.getElementById('roomType').value = room.room_type || 'dorm';
            document.getElementById('roomCapacity').value = room.capacity;
            document.getElementById('roomRate').value = room.monthly_rate;
        }
    } else {
        modalTitle.textContent = 'Add New Room';
        form.reset();
        document.getElementById('roomType').value = 'dorm';
    }
    new bootstrap.Modal(document.getElementById('roomModal')).show();
}

async function submitSaveRoom() {
    const id = document.getElementById('roomId').value;
    const roomNumber = document.getElementById('roomNumber').value.trim();
    const roomType = document.getElementById('roomType').value;
    const capacity = parseInt(document.getElementById('roomCapacity').value, 10);
    const monthlyRate = parseFloat(document.getElementById('roomRate').value);

    if (!roomNumber) {
        window.showEnterpriseToast('Please enter a room or unit number.', 'warning');
        return;
    }

    const data = {
        room_number: roomNumber,
        room_type: roomType,
        capacity: capacity,
        monthly_rate: monthlyRate
    };

    const url = id ? `/api/admin/rooms/${id}` : '/api/admin/rooms';
    const method = id ? 'PUT' : 'POST';

    try {
        const res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
            credentials: 'include'
        });
        const result = await res.json();
        
        if (res.ok) {
            window.showEnterpriseToast(result.message || 'Room saved successfully.');
            const modalEl = document.getElementById('roomModal');
            if (modalEl) {
                const inst = bootstrap.Modal.getInstance(modalEl);
                if (inst) inst.hide();
            }
            loadRooms();
        } else {
            window.showEnterpriseToast(result.error || 'Failed to save room.', 'error');
        }
    } catch (err) {
        console.error(err);
        window.showEnterpriseToast('Error saving room.', 'error');
    }
}

async function deleteRoom(id) {
    const room = allRooms.find(r => Number(r.id) === Number(id));
    const roomName = room ? `${room.room_type === 'condo' ? 'Condo Unit' : 'Room'} ${room.room_number}` : 'this room';

    window.showEnterpriseConfirm({
        title: 'Delete Room / Unit',
        message: `Are you sure you want to delete ${roomName}? This action cannot be undone.`,
        confirmText: 'Delete Unit',
        confirmClass: 'btn-danger',
        iconClass: 'fas fa-trash-alt text-danger',
        onConfirm: async () => {
            try {
                const res = await fetch(`/api/admin/rooms/${id}`, { 
                    method: 'DELETE',
                    credentials: 'include'
                });
                const result = await res.json();
                
                if (res.ok) {
                    window.showEnterpriseToast(result.message || 'Room deleted successfully.');
                    loadRooms();
                } else {
                    window.showEnterpriseToast(result.error || 'Failed to delete room.', 'error');
                }
            } catch (err) {
                console.error(err);
                window.showEnterpriseToast('Error deleting room.', 'error');
            }
        }
    });
}

// ═══════════════════════════════════════════════════
//  UNIT MEDIA MANAGER
// ═══════════════════════════════════════════════════

let currentMediaRoomId = null;
let currentMediaRoomType = null;

async function loadPropertyMediaAdmin() {
    const select = document.getElementById('mediaUnitSelect');
    if (!select) return;

    if (!allRooms || allRooms.length === 0) {
        try {
            const res = await fetch('/api/rooms', { credentials: 'include' });
            if (res.ok) {
                allRooms = await res.json();
            }
        } catch (err) {
            console.error('Error fetching rooms for media dropdown:', err);
        }
    }

    select.innerHTML = '<option value="">-- Choose a unit --</option>';
    if (allRooms && allRooms.length > 0) {
        allRooms.forEach(room => {
            const label = room.room_type === 'condo' ? `Condo ${room.room_number}` : `Dorm ${room.room_number}`;
            select.innerHTML += `<option value="${room.id}" data-type="${room.room_type}">${label}</option>`;
        });
    }
}

async function loadUnitGallery() {
    const select = document.getElementById('mediaUnitSelect');
    const panel = document.getElementById('mediaManagerPanel');
    const roomId = select.value;

    if (!roomId) {
        panel.style.display = 'none';
        currentMediaRoomId = null;
        return;
    }

    currentMediaRoomId = parseInt(roomId);
    currentMediaRoomType = select.options[select.selectedIndex].dataset.type;
    panel.style.display = 'block';

    // Update info
    const room = allRooms.find(r => r.id === currentMediaRoomId);
    const info = document.getElementById('mediaUnitInfo');
    if (room && info) {
        info.innerHTML = `<i class="fas fa-info-circle me-1"></i>Managing media for <strong>${room.room_type === 'condo' ? 'Condo' : 'Dorm'} ${room.room_number}</strong>`;
    }

    // Load gallery images
    try {
        const res = await fetch(`/api/rooms/gallery/${currentMediaRoomId}`, { credentials: 'include' });
        const images = await res.json();
        renderGalleryGrid(images);
    } catch (err) {
        console.error('Error loading gallery:', err);
    }

    // Load video & map (per-type from property_media)
    try {
        const res = await fetch('/api/property-media', { credentials: 'include' });
        if (res.ok) {
            const data = await res.json();
            const media = data[currentMediaRoomType] || {};

            // Video preview
            const videoPreview = document.getElementById('currentVideoPreview');
            if (media.video_url) {
                videoPreview.innerHTML = `<video src="${media.video_url}" controls style="width:100%;max-height:200px;border-radius:8px;"></video>`;
            } else {
                videoPreview.innerHTML = '<div style="color:#aaa;font-size:0.85rem;">No video uploaded yet</div>';
            }

            // Map embed
            const mapField = document.getElementById('mediaMapEmbed');
            if (mapField) mapField.value = media.map_embed_url || '';
            previewMapEmbed();
        }
    } catch (err) {
        console.error('Error loading media:', err);
    }
}

function renderGalleryGrid(images) {
    const grid = document.getElementById('galleryGrid');
    const count = document.getElementById('galleryCount');
    if (!grid) return;

    count.textContent = `${images.length} photo${images.length !== 1 ? 's' : ''}`;

    if (images.length === 0) {
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:24px;color:#aaa;font-size:0.85rem;"><i class="fas fa-image" style="font-size:1.5rem;margin-bottom:8px;display:block;"></i>No photos yet — upload some below</div>';
        return;
    }

    grid.innerHTML = images.map(img => `
        <div style="position:relative;border-radius:8px;overflow:hidden;aspect-ratio:1;background:#f0f0f0;">
            <img src="${img.image_url}" alt="${img.caption || 'Room photo'}" style="width:100%;height:100%;object-fit:cover;">
            <button onclick="deleteGalleryImage(${img.id})" style="position:absolute;top:6px;right:6px;width:26px;height:26px;border-radius:50%;border:none;background:rgba(220,53,69,0.9);color:#fff;font-size:0.75rem;cursor:pointer;display:flex;align-items:center;justify-content:center;opacity:0.7;transition:opacity 0.2s;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.7'" title="Delete this photo">
                <i class="fas fa-times"></i>
            </button>
            ${img.sort_order === 0 ? '<div style="position:absolute;bottom:6px;left:6px;background:rgba(197,160,89,0.9);color:#fff;font-size:0.65rem;padding:2px 8px;border-radius:10px;font-weight:600;">COVER</div>' : ''}
        </div>
    `).join('');
}

// Upload zone — drag & drop + click
document.addEventListener('DOMContentLoaded', function() {
    const zone = document.getElementById('uploadZone');
    const input = document.getElementById('galleryFileInput');
    if (!zone || !input) return;

    zone.addEventListener('click', e => {
        if (e.target !== input) input.click();
    });
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.style.borderColor = '#c5a059'; zone.style.background = '#fef9f0'; });
    zone.addEventListener('dragleave', e => { e.preventDefault(); zone.style.borderColor = '#ccc'; zone.style.background = '#fafafa'; });
    zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.style.borderColor = '#ccc'; zone.style.background = '#fafafa';
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            uploadGalleryImages(e.dataTransfer.files);
        }
    });
});

async function uploadGalleryImages(customFiles = null) {
    if (!currentMediaRoomId) return alert('Please select a unit first');
    const input = document.getElementById('galleryFileInput');
    const files = customFiles || (input ? input.files : null);
    if (!files || files.length === 0) return;

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
        formData.append('images', files[i]);
    }

    const zone = document.getElementById('uploadZone');
    const origHtml = zone ? zone.innerHTML : '';
    if (zone) {
        zone.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size:1.5rem;color:#c5a059;"></i><div style="margin-top:8px;font-size:0.85rem;color:#888;">Uploading...</div>';
    }

    try {
        const res = await fetch(`/api/admin/rooms/gallery/${currentMediaRoomId}`, {
            method: 'POST',
            body: formData,
            credentials: 'include'
        });
        const data = await res.json();
        if (res.ok) {
            renderGalleryGrid(data.gallery);
            showMediaToast(data.message);
        } else {
            showMediaToast(data.error || 'Upload failed', 'error');
        }
    } catch (err) {
        console.error(err);
        showMediaToast('Error uploading images', 'error');
    }

    if (zone) zone.innerHTML = origHtml;
    if (input) input.value = '';
}

async function deleteGalleryImage(imageId) {
    window.showEnterpriseConfirm({
        title: 'Delete Photo',
        message: 'Are you sure you want to permanently delete this photo from the gallery?',
        confirmText: 'Delete Photo',
        confirmClass: 'btn-danger',
        iconClass: 'fas fa-trash-alt text-danger',
        onConfirm: async () => {
            try {
                const res = await fetch(`/api/admin/rooms/gallery/image/${imageId}`, {
                    method: 'DELETE',
                    credentials: 'include'
                });
                if (res.ok) {
                    loadUnitGallery();
                    window.showEnterpriseToast('Photo deleted successfully.');
                } else {
                    window.showEnterpriseToast('Failed to delete photo.', 'error');
                }
            } catch (err) {
                console.error(err);
                window.showEnterpriseToast('Error deleting photo.', 'error');
            }
        }
    });
}

function previewMapEmbed() {
    const textarea = document.getElementById('mediaMapEmbed');
    const preview = document.getElementById('mapPreview');
    if (!textarea || !preview) return;

    const val = textarea.value.trim();
    if (!val) {
        preview.innerHTML = '<span style="color:#aaa;">Map preview will appear here</span>';
        return;
    }

    if (val.includes('<iframe')) {
        preview.innerHTML = val;
        const iframe = preview.querySelector('iframe');
        if (iframe) { iframe.width = '100%'; iframe.height = '100%'; iframe.style.border = '0'; }
    } else if (val.startsWith('http')) {
        preview.innerHTML = `<iframe src="${val}" width="100%" height="100%" style="border:0;" allowfullscreen loading="lazy"></iframe>`;
    } else {
        preview.innerHTML = '<span style="color:#e74c3c;font-size:0.8rem;">Invalid embed code or URL</span>';
    }
}

async function saveMediaSettings() {
    if (!currentMediaRoomType) return window.showEnterpriseToast('Please select a unit first.', 'warning');

    const formData = new FormData();
    const videoInput = document.getElementById('mediaVideoInput');
    if (videoInput && videoInput.files[0]) formData.append('video', videoInput.files[0]);

    const mapEmbed = document.getElementById('mediaMapEmbed')?.value || '';
    formData.append('mapEmbed', mapEmbed);

    try {
        const res = await fetch(`/api/admin/property-media/${currentMediaRoomType}`, {
            method: 'POST',
            body: formData,
            credentials: 'include'
        });
        const data = await res.json();
        if (res.ok) {
            window.showEnterpriseToast(data.message || 'Settings saved successfully.');
            loadUnitGallery();
        } else {
            window.showEnterpriseToast(data.error || 'Failed to save settings.', 'error');
        }
    } catch (err) {
        console.error(err);
        window.showEnterpriseToast('Error saving settings.', 'error');
    }
}

function showMediaToast(message, type = 'success') {
    window.showEnterpriseToast(message, type);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
        loadRooms();
        loadPropertyMediaAdmin();
    });
} else {
    loadRooms();
    loadPropertyMediaAdmin();
}
