// --- 2. Load Rooms ---
let allRooms = []; // Global cache for rooms

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
            let barColor = '#27ae60'; // green
            if (fillPct >= 80) barColor = '#e74c3c';      // red
            else if (fillPct >= 50) barColor = '#f39c12';  // amber

            // Status badge: FULL (red) or Active (green)
            const statusBadge = isFull
                ? '<span class="badge bg-danger">FULL</span>'
                : '<span class="badge bg-success">Active</span>';

            if (room.room_type === 'condo') {
                // Condo row — simplified: Unit + Status + actions
                const isOccupied = activeTenants > 0;
                const condoStatus = isOccupied
                    ? '<span class="badge bg-danger">Occupied</span>'
                    : '<span class="badge bg-success">Available</span>';
                const row = `
                    <tr>
                        <td><strong>${room.room_number}</strong></td>
                        <td>${condoStatus}</td>
                        <td>
                            <button class="btn btn-sm btn-outline-primary me-1" onclick="openRoomModal(${room.id})"><i class="fas fa-edit"></i></button>
                            <button class="btn btn-sm btn-outline-danger" onclick="deleteRoom(${room.id})"><i class="fas fa-trash"></i></button>
                        </td>
                    </tr>
                `;
                if (condosBody) condosBody.innerHTML += row;
            } else {
                // Dorm row — with occupancy column
                const row = `
                    <tr>
                        <td><strong>${room.room_number}</strong></td>
                        <td>${room.capacity} Beds</td>
                        <td>₱${room.monthly_rate}</td>
                        <td>
                            <div style="display:flex;align-items:center;gap:8px;width:130px;">
                                <div style="width:80px;background:#e9ecef;border-radius:6px;height:8px;overflow:hidden;">
                                    <div style="width:${fillPct}%;height:100%;background:${barColor};border-radius:6px;transition:width 0.4s ease;"></div>
                                </div>
                                <span style="font-size:0.82rem;font-weight:600;color:${barColor};white-space:nowrap;width:36px;text-align:right;">${activeTenants}/${capacity}</span>
                            </div>
                        </td>
                        <td>${statusBadge}</td>
                        <td>
                            <button class="btn btn-sm btn-outline-primary me-1" onclick="openRoomModal(${room.id})"><i class="fas fa-edit"></i></button>
                            <button class="btn btn-sm btn-outline-danger" onclick="deleteRoom(${room.id})"><i class="fas fa-trash"></i></button>
                        </td>
                    </tr>
                `;
                if (dormsBody) dormsBody.innerHTML += row;
            }
        });
    } catch (err) {
        console.error(err);
    }
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
