// --- 4. Load Maintenance ---
async function loadMaintenance() {
    try {
        const res = await fetch('/api/admin/maintenance');
        const requests = await res.json();
        const tbody = document.getElementById('maintenanceTableBody');
        tbody.innerHTML = '';

        if (requests.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center">No maintenance requests found.</td></tr>';
            return;
        }

        requests.forEach(req => {
            const date = new Date(req.reported_at).toLocaleDateString();
            const statusBadge = req.status === 'resolved' ? 'bg-success' : 
                                req.status === 'in_progress' ? 'bg-primary' : 'bg-warning text-dark';
            
            const photoBtn = req.image_url ? 
                `<button class="btn btn-sm btn-info text-white me-1" onclick="viewProof('${req.image_url}')"><i class="fas fa-image"></i> View Photo</button>` 
                : '';

            tbody.innerHTML += `
                <tr>
                    <td>${date}</td>
                    <td>${req.full_name}</td>
                    <td>${req.room_number || 'N/A'}</td>
                    <td>
                        <strong>${req.title}</strong><br>
                        <small class="text-muted">${req.description}</small>
                    </td>
                    <td><span class="badge ${statusBadge}">${req.status.replace('_', ' ').toUpperCase()}</span></td>
                    <td>
                        ${photoBtn}
                        <button class="btn btn-sm btn-outline-primary" onclick="openUpdateStatusModal(${req.id}, '${req.status}')">Update Status</button>
                    </td>
                </tr>
            `;
        });
    } catch (err) {
        console.error(err);
    }
}

// Status Modal Vars
let currentMaintenanceId = null;
function openUpdateStatusModal(id, currentStatus) {
    currentMaintenanceId = id;
    document.getElementById('newStatus').value = currentStatus;
    new bootstrap.Modal(document.getElementById('updateStatusModal')).show();
}

function submitStatusUpdate() {
    const status = document.getElementById('newStatus').value;
    fetch(`/api/maintenance/${currentMaintenanceId}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
    })
    .then(res => res.json())
    .then(data => {
        alert(data.message);
        location.reload();
    });
}
