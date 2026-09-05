// --- 2. Load Rooms & Occupancy ---
let allRooms = []; // Global cache for rooms
let currentOpenUnitModalRoomId = null;

async function loadRooms() {
    try {
        const res = await fetch('/api/rooms', { credentials: 'include' });
        allRooms = await res.json(); // Update global cache
        if (typeof loadPropertyMediaAdmin === 'function') loadPropertyMediaAdmin();
        
        const dormsBody = document.getElementById('dormsTableBody');
        const condosBody = document.getElementById('condosTableBody');
        
        if (dormsBody) dormsBody.innerHTML = '';
        if (condosBody) condosBody.innerHTML = '';

        allRooms.forEach(room => {
            const activeTenants = room.active_tenants || 0;
            const capacity = room.capacity || 1;
            const fillPct = Math.round((activeTenants / capacity) * 100);
            const isFull = activeTenants >= capacity;

            // Occupancy bar color thresholds
            let barColor = '#198754'; // enterprise green
            if (fillPct >= 80) barColor = '#dc3545';      // red
            else if (fillPct >= 50) barColor = '#fd7e14';  // amber

            // Status badge: FULL or Active
            const statusBadge = isFull
                ? '<span class="badge bg-danger text-uppercase fw-semibold" style="letter-spacing:0.5px;">FULL</span>'
                : '<span class="badge bg-success text-uppercase fw-semibold" style="letter-spacing:0.5px;">ACTIVE</span>';

            const rateFormatted = Number(room.monthly_rate || 0).toLocaleString();

            if (room.room_type === 'condo') {
                const isOccupied = activeTenants > 0;
                const condoStatus = isOccupied
                    ? '<span class="badge bg-danger text-uppercase fw-semibold" style="letter-spacing:0.5px;">OCCUPIED</span>'
                    : '<span class="badge bg-success text-uppercase fw-semibold" style="letter-spacing:0.5px;">AVAILABLE</span>';
                
                const row = `
                    <tr style="cursor:pointer;" onclick="if (!event.target.closest('button')) openUnitOccupantsModal(${room.id})">
                        <td><strong>${room.room_number}</strong></td>
                        <td>PHP ${rateFormatted}</td>
                        <td>
                            <span class="badge bg-light text-dark border">${activeTenants} / ${capacity}</span>
                        </td>
                        <td>${condoStatus}</td>
                        <td class="text-end">
                            <button class="btn btn-sm btn-primary me-1" onclick="openUnitOccupantsModal(${room.id})" title="Inspect occupants and capacity">
                                Occupants
                            </button>
                            <button class="btn btn-sm btn-outline-secondary me-1" onclick="openRoomModal(${room.id})" title="Edit unit specifications">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn btn-sm btn-outline-danger" onclick="deleteRoom(${room.id})" title="Delete unit">
                                <i class="fas fa-trash"></i>
                            </button>
                        </td>
                    </tr>
                `;
                if (condosBody) condosBody.innerHTML += row;
            } else {
                const row = `
                    <tr style="cursor:pointer;" onclick="if (!event.target.closest('button')) openUnitOccupantsModal(${room.id})">
                        <td><strong>${room.room_number}</strong></td>
                        <td>${room.capacity} Beds</td>
                        <td>PHP ${rateFormatted}</td>
                        <td>
                            <div style="display:flex;align-items:center;gap:8px;width:130px;">
                                <div style="width:80px;background:#e9ecef;border-radius:6px;height:8px;overflow:hidden;">
                                    <div style="width:${fillPct}%;height:100%;background:${barColor};border-radius:6px;transition:width 0.4s ease;"></div>
                                </div>
                                <span style="font-size:0.82rem;font-weight:600;color:${barColor};white-space:nowrap;width:36px;text-align:right;">${activeTenants}/${capacity}</span>
                            </div>
                        </td>
                        <td>${statusBadge}</td>
                        <td class="text-end">
                            <button class="btn btn-sm btn-primary me-1" onclick="openUnitOccupantsModal(${room.id})" title="Inspect occupants and capacity">
                                Occupants
                            </button>
                            <button class="btn btn-sm btn-outline-secondary me-1" onclick="openRoomModal(${room.id})" title="Edit room specifications">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn btn-sm btn-outline-danger" onclick="deleteRoom(${room.id})" title="Delete room">
                                <i class="fas fa-trash"></i>
                            </button>
                        </td>
                    </tr>
                `;
                if (dormsBody) dormsBody.innerHTML += row;
            }
        });

        // If the unit occupants modal is currently open, refresh its content silently
        const modalEl = document.getElementById('unitOccupantsModal');
        if (modalEl && modalEl.classList.contains('show') && currentOpenUnitModalRoomId) {
            openUnitOccupantsModal(currentOpenUnitModalRoomId, true);
        }
    } catch (err) {
        console.error('Error loading rooms:', err);
    }
}

async function openUnitOccupantsModal(roomId, isBackgroundRefresh = false) {
    currentOpenUnitModalRoomId = roomId;
    const room = allRooms.find(r => r.id === roomId);
    if (!room) return;

    const titleEl = document.getElementById('unitModalTitle');
    const typeBadge = document.getElementById('unitModalTypeBadge');
    const metaEl = document.getElementById('unitModalMeta');
    const occupancyText = document.getElementById('unitModalOccupancyText');
    const editBtn = document.getElementById('unitModalEditRoomBtn');

    const isCondo = room.room_type === 'condo';
    const capacity = room.capacity || 1;
    const monthlyRateFormatted = Number(room.monthly_rate || 0).toLocaleString();

    if (titleEl) titleEl.textContent = `${isCondo ? 'Condo Unit' : 'Room'} ${room.room_number}`;
    if (typeBadge) {
        typeBadge.textContent = isCondo ? 'Condo Unit' : 'Dormitory';
        typeBadge.className = isCondo ? 'badge bg-info text-dark text-uppercase fw-semibold' : 'badge bg-secondary text-uppercase fw-semibold';
    }
    if (metaEl) metaEl.textContent = `Monthly Rate: PHP ${monthlyRateFormatted} | Capacity: ${capacity} ${capacity === 1 ? 'Bed' : 'Beds'}`;
    if (editBtn) {
        editBtn.onclick = () => {
            const modalEl = document.getElementById('unitOccupantsModal');
            const inst = bootstrap.Modal.getInstance(modalEl);
            if (inst) inst.hide();
            openRoomModal(room.id);
        };
    }

    // Fetch latest tenants data
    let tenants = [];
    try {
        const res = await fetch('/api/admin/tenants', { credentials: 'include' });
        if (res.ok) {
            tenants = await res.json();
        }
    } catch (e) {
        console.error('Error fetching tenants for unit modal:', e);
    }

    // Filter occupants assigned to this specific room (by room_id or room_number)
    const occupants = tenants.filter(t => (t.room_id === room.id || String(t.room_number) === String(room.room_number)) && t.status !== 'archived');
    const activeCount = occupants.length;
    const vacantCount = Math.max(0, capacity - activeCount);

    if (occupancyText) {
        const pct = Math.round((activeCount / capacity) * 100);
        let badgeClass = 'text-success';
        if (pct >= 100) badgeClass = 'text-danger';
        else if (pct >= 50) badgeClass = 'text-warning';
        occupancyText.innerHTML = `<span class="${badgeClass}">${activeCount} of ${capacity} Occupied (${pct}%)</span>`;
    }

    const countEl = document.getElementById('unitModalOccupantsCount');
    if (countEl) countEl.textContent = activeCount;

    const vacantCountEl = document.getElementById('unitModalVacantCount');
    if (vacantCountEl) vacantCountEl.textContent = vacantCount;

    // Render Occupants
    const listEl = document.getElementById('unitOccupantsList');
    if (listEl) {
        if (occupants.length === 0) {
            listEl.innerHTML = `
                <div class="p-4 text-center border rounded bg-light text-muted">
                    <p class="mb-1 fw-semibold text-dark">No active occupants assigned to this unit.</p>
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

                return `
                    <div class="card mb-3 border shadow-sm">
                        <div class="card-body p-3">
                            <div class="d-flex justify-content-between align-items-start flex-wrap gap-2">
                                <div class="d-flex align-items-center">
                                    <img src="${profileImg}" class="rounded-circle me-3 border" width="44" height="44" style="object-fit: cover;">
                                    <div>
                                        <div class="d-flex align-items-center gap-2">
                                            <h6 class="mb-0 fw-bold text-dark">${t.full_name}</h6>
                                            <span class="badge bg-light text-dark border">Bed ${bedLetter}</span>
                                        </div>
                                        <div class="text-muted small mt-1">
                                            ${t.email} | Contact: ${t.phone_number || 'N/A'}
                                        </div>
                                        <div class="text-secondary small mt-1">
                                            Guardian: ${t.guardian_name ? `${t.guardian_name} (${t.guardian_contact || 'N/A'})` : 'Not provided'}
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

    // Render Vacant Slots
    const vacantListEl = document.getElementById('unitVacantSlotsList');
    if (vacantListEl) {
        if (vacantCount === 0) {
            vacantListEl.innerHTML = `
                <div class="p-3 text-center border rounded bg-light text-muted small">
                    This unit is currently at full capacity (${capacity} of ${capacity} beds occupied).
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

    if (!isBackgroundRefresh) {
        const modalEl = document.getElementById('unitOccupantsModal');
        const bsModal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
        bsModal.show();
    }
}

function assignTenantToRoom(roomId) {
    const modalEl = document.getElementById('unitOccupantsModal');
    const bsModal = bootstrap.Modal.getInstance(modalEl);
    if (bsModal) bsModal.hide();
    prepareAddTenant(roomId);
}

// --- Room Management Functions ---
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
        document.getElementById('roomType').value = 'dorm'; // Default
    }
    new bootstrap.Modal(document.getElementById('roomModal')).show();
}

async function submitSaveRoom() {
    const id = document.getElementById('roomId').value;
    const data = {
        room_number: document.getElementById('roomNumber').value,
        room_type: document.getElementById('roomType').value,
        capacity: parseInt(document.getElementById('roomCapacity').value),
        monthly_rate: parseFloat(document.getElementById('roomRate').value)
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
            alert(result.message);
            bootstrap.Modal.getInstance(document.getElementById('roomModal')).hide();
            loadRooms();
        } else {
            alert(result.error || 'Failed to save room');
        }
    } catch (err) {
        console.error(err);
        alert('Error saving room');
    }
}

async function deleteRoom(id) {
    if (!confirm('Are you sure you want to delete this room?')) return;
    
    try {
        const res = await fetch(`/api/admin/rooms/${id}`, { 
            method: 'DELETE',
            credentials: 'include'
        });
        const result = await res.json();
        
        if (res.ok) {
            loadRooms();
        } else {
            alert(result.error || 'Failed to delete room');
        }
    } catch (err) {
        console.error(err);
        alert('Error deleting room');
    }
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
    if (!confirm('Delete this photo?')) return;
    try {
        const res = await fetch(`/api/admin/rooms/gallery/image/${imageId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        if (res.ok) {
            loadUnitGallery();
            showMediaToast('Photo deleted');
        }
    } catch (err) {
        console.error(err);
    }
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
    if (!currentMediaRoomType) return alert('Please select a unit first');

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
            showMediaToast(data.message || 'Settings saved');
            loadUnitGallery();
        } else {
            showMediaToast(data.error || 'Failed to save', 'error');
        }
    } catch (err) {
        console.error(err);
        showMediaToast('Error saving settings', 'error');
    }
}

function showMediaToast(message, type = 'success') {
    document.getElementById('media-toast')?.remove();
    const bg = type === 'success' ? 'linear-gradient(135deg,#1a7a4a,#27ae60)' : 'linear-gradient(135deg,#8b1a1a,#e74c3c)';
    const icon = type === 'success' ? '✓' : '✕';
    const toast = document.createElement('div');
    toast.id = 'media-toast';
    toast.style.cssText = `position:fixed;bottom:32px;right:32px;z-index:99999;background:${bg};color:#fff;padding:14px 22px;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,0.35);font-size:0.9rem;display:flex;align-items:center;gap:10px;animation:toastIn 0.35s ease;`;
    toast.innerHTML = `<span style="width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,0.25);display:flex;align-items:center;justify-content:center;font-weight:bold;">${icon}</span><span>${message}</span>`;
    if (!document.getElementById('media-toast-style')) {
        const s = document.createElement('style');
        s.id = 'media-toast-style';
        s.textContent = '@keyframes toastIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}';
        document.head.appendChild(s);
    }
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

document.addEventListener('DOMContentLoaded', function () {
    loadRooms();
    loadPropertyMediaAdmin();
});
