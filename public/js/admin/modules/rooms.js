// --- 2. Load Rooms ---
let allRooms = []; // Global cache for rooms

async function loadRooms() {
    try {
        const res = await fetch('/api/rooms');
        allRooms = await res.json(); // Update global cache
        
        const dormsBody = document.getElementById('dormsTableBody');
        const condosBody = document.getElementById('condosTableBody');
        
        if (dormsBody) dormsBody.innerHTML = '';
        if (condosBody) condosBody.innerHTML = '';

        allRooms.forEach(room => {
            const row = `
                <tr>
                    <td><strong>${room.room_number}</strong></td>
                    <td><span class="badge ${room.room_type === 'condo' ? 'bg-info' : 'bg-secondary'}">${(room.room_type || 'dorm').toUpperCase()}</span></td>
                    <td>${room.capacity} Beds</td>
                    <td>₱${room.monthly_rate}</td>
                    <td><span class="badge bg-success">Active</span></td>
                    <td>
                        <button class="btn btn-sm btn-outline-primary me-1" onclick="openRoomModal(${room.id})"><i class="fas fa-edit"></i></button>
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteRoom(${room.id})"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>
            `;

            if (room.room_type === 'condo') {
                if (condosBody) condosBody.innerHTML += row;
            } else {
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
            body: JSON.stringify(data)
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
        const res = await fetch(`/api/admin/rooms/${id}`, { method: 'DELETE' });
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

async function loadPropertyMediaAdmin() {
    try {
        const res = await fetch('/api/property-media');
        if (!res.ok) {
            return;
        }
        const data = await res.json();

        const condo = data.condo || data.Condo || null;
        const dorm = data.dorm || data.Dorm || null;

        function fillForm(prefix, item) {
            if (!item) return;
            const form = document.getElementById(prefix + 'MediaForm');
            if (!form) return;
            const mapField = form.querySelector('textarea[name="mapEmbed"]');
            if (mapField) {
                mapField.value = item.map_embed_url || '';
            }
        }

        fillForm('condo', condo);
        fillForm('dorm', dorm);
    } catch (err) {
        console.error(err);
    }
}

async function savePropertyMedia(type) {
    const formId = type === 'condo' ? 'condoMediaForm' : 'dormMediaForm';
    const form = document.getElementById(formId);
    if (!form) return;

    const formData = new FormData(form);

    try {
        const res = await fetch(`/api/admin/property-media/${type}`, {
            method: 'POST',
            body: formData
        });
        const result = await res.json();
        if (res.ok) {
            alert(result.message || 'Media saved successfully');
        } else {
            alert(result.error || 'Failed to save media');
        }
    } catch (err) {
        console.error(err);
        alert('Error saving media');
    }
}

document.addEventListener('DOMContentLoaded', function () {
    loadRooms();
    loadPropertyMediaAdmin();
});
