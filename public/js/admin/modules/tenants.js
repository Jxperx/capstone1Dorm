// --- 5. Load Tenants ---
async function loadTenants() {
    try {
        const res = await fetch('/api/admin/tenants', { credentials: 'include' });
        const tenants = await res.json();
        const tbody = document.getElementById('tenantsTableBody');
        tbody.innerHTML = '';

        if (tenants.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center">No tenants found.</td></tr>';
            return;
        }

        tenants.forEach(t => {
            const room = t.room_number ? `Room ${t.room_number}` : '<span class="text-danger">Unassigned</span>';
            const guardian = t.guardian_name ? 
                `${t.guardian_name}<br><small class="text-muted">${t.guardian_contact}</small>` : 
                '<span class="text-muted">Not provided</span>';
            
            const profileImg = t.profile_image_url || 'https://via.placeholder.com/40';

            // Status badge logic
            const statusBadgeHtml = t.status === 'pending'
                ? '<span class="badge bg-warning text-dark"><i class="fas fa-clock me-1"></i>Pending Setup</span>'
                : t.status === 'active'
                ? '<span class="badge bg-success">Active</span>'
                : '<span class="badge bg-secondary">Archived</span>';

            const endLeaseBtn = t.status === 'active' ? 
                `<button class="btn btn-sm btn-outline-danger" onclick="endLease(${t.id})"><i class="fas fa-sign-out-alt"></i> End Lease</button>` :
                '<span class="badge bg-secondary">Archived</span>';

            const resendInviteBtn = `<button class="btn btn-sm btn-outline-warning text-dark me-1" title="Resend Password Setup Link" onclick="resendTenantInvite(${t.id})"><i class="fas fa-link me-1"></i>Link</button>`;

            const tData = JSON.stringify(t).replace(/'/g, "&apos;");

            tbody.innerHTML += `
                <tr>
                    <td>
                        <div class="d-flex align-items-center">
                            <img src="${profileImg}" class="rounded-circle me-2" width="40" height="40" style="object-fit: cover;">
                            <div>
                                <strong>${t.full_name}</strong><br>
                                <small class="text-muted">${t.email}</small>
                            </div>
                        </div>
                    </td>
                    <td>${t.phone_number || 'N/A'}</td>
                    <td>${room}</td>
                    <td>${guardian}</td>
                    <td>${statusBadgeHtml}</td>
                    <td>
                        ${resendInviteBtn}
                        <button class="btn btn-sm btn-outline-primary me-1" data-tenant='${tData}' onclick='openEditTenantModalFromBtn(this)'>
                            <i class="fas fa-edit"></i> Edit
                        </button>
                        ${endLeaseBtn}
                        <button class="btn btn-sm btn-danger ms-1" onclick="deleteTenant(${t.id})">
                            <i class="fas fa-trash"></i> Remove
                        </button>
                    </td>
                </tr>
            `;
        });
    } catch (err) {
        console.error(err);
    }
}

async function deleteTenant(tenantId) {
    if (!confirm('Are you sure you want to PERMANENTLY remove this tenant? This will delete ALL their history (payments, maintenance, etc.) from the database. This action cannot be undone.')) return;

    try {
        const res = await fetch(`/api/admin/tenants/${tenantId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        const result = await res.json();

        if (res.ok) {
            alert(result.message);
            loadTenants();
            if (typeof loadRooms === 'function') loadRooms();
        } else {
            alert(result.error || 'Failed to remove tenant');
        }
    } catch (err) {
        console.error(err);
        alert('Error removing tenant');
    }
}

async function endLease(tenantId) {
    if (!confirm('Are you sure you want to end this lease? The tenant will be marked as moved out and the room will be vacated.')) return;

    try {
        const res = await fetch(`/api/admin/tenants/${tenantId}/end-lease`, {
            method: 'POST',
            credentials: 'include'
        });
        const result = await res.json();

        if (res.ok) {
            alert(result.message);
            loadTenants();
            loadRooms(); // Update room occupancy
        } else {
            alert(result.error || 'Failed to end lease');
        }
    } catch (err) {
        console.error(err);
        alert('Error ending lease');
    }
}

// Wrapper to handle the button click
function openEditTenantModalFromBtn(btn) {
    const tenant = JSON.parse(btn.dataset.tenant);
    openEditTenantModal(tenant);
}

async function openEditTenantModal(tenant) {
    if (!tenant) return;

    document.getElementById('editTenantId').value = tenant.id;
    document.getElementById('editTenantName').value = tenant.full_name;
    document.getElementById('editTenantPhone').value = tenant.phone_number || '';
    document.getElementById('editGuardianName').value = tenant.guardian_name || '';
    document.getElementById('editGuardianAddress').value = tenant.guardian_address || '';
    document.getElementById('editGuardianContact').value = tenant.guardian_contact || '';

    // Format dates for input (YYYY-MM-DD).
    // Always write to the inputs — including '' — so stale values from the
    // previously opened modal are cleared when a tenant has no dates set.
    document.getElementById('editTenantLeaseStart').value = tenant.lease_start_date
        ? new Date(tenant.lease_start_date).toISOString().split('T')[0]
        : '';
    document.getElementById('editTenantLeaseEnd').value = tenant.lease_end_date
        ? new Date(tenant.lease_end_date).toISOString().split('T')[0]
        : '';

    // Load rooms for dropdown
    if (typeof allRooms === 'undefined' || allRooms.length === 0) {
        try {
            const res = await fetch('/api/rooms', { credentials: 'include' });
            allRooms = await res.json();
        } catch(e) { console.error(e); }
    }

    const roomSelect = document.getElementById('editTenantRoom');
    roomSelect.innerHTML = '<option value="">Select Room... (Unassign)</option>';
    allRooms.forEach(room => {
        const selected = room.id === tenant.room_id ? 'selected' : '';
        roomSelect.innerHTML += `<option value="${room.id}" ${selected}>Room ${room.room_number} (Cap: ${room.capacity})</option>`;
    });

    new bootstrap.Modal(document.getElementById('editTenantModal')).show();
}

async function saveTenantChanges() {
    const tenantId = document.getElementById('editTenantId').value;
    const formData = new FormData();
    formData.append('fullName', document.getElementById('editTenantName').value);
    formData.append('phone', document.getElementById('editTenantPhone').value);
    formData.append('roomId', document.getElementById('editTenantRoom').value);
    formData.append('guardianName', document.getElementById('editGuardianName').value);
    formData.append('guardianAddress', document.getElementById('editGuardianAddress').value);
    formData.append('guardianContact', document.getElementById('editGuardianContact').value);
    formData.append('leaseStart', document.getElementById('editTenantLeaseStart').value);
    formData.append('leaseEnd', document.getElementById('editTenantLeaseEnd').value);

    try {
        const res = await fetch(`/api/admin/tenants/${tenantId}/update`, {
            method: 'POST',
            body: formData,
            credentials: 'include'
        });
        const data = await res.json();
        if (res.ok) {
            alert('Tenant updated successfully!');
            // FIX: Close the modal and refresh only the affected data tables instead of
            // reloading the entire page, which would lose the current dashboard section.
            const modalEl = document.getElementById('editTenantModal');
            const modalInstance = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
            modalInstance.hide();
            // Re-fetch tenant list and room occupancy in-place
            if (typeof loadTenants === 'function') loadTenants();
            if (typeof loadRooms   === 'function') loadRooms();
        } else {
            alert('Error: ' + data.error);
        }
    } catch (err) {
        console.error(err);
        alert('Error updating tenant');
    }
}

// --- Add Tenant Logic ---
async function prepareAddTenant() {
    // Load rooms if not already loaded
    if (typeof allRooms === 'undefined' || allRooms.length === 0) {
        try {
            const res = await fetch('/api/rooms');
            allRooms = await res.json();
        } catch (err) {
            console.error('Error loading rooms:', err);
        }
    }

    const select = document.getElementById('addTenantRoomSelect');
    select.innerHTML = '<option value="">Select Room (Optional)...</option>';
    
    allRooms.forEach(room => {
        select.innerHTML += `<option value="${room.id}">Room ${room.room_number} (${room.room_type}, Cap: ${room.capacity})</option>`;
    });
    
    // Set default date to today
    document.querySelector('input[name="lease_start"]').valueAsDate = new Date();

    new bootstrap.Modal(document.getElementById('addTenantModal')).show();
}

async function submitAddTenant() {
    const form = document.getElementById('addTenantForm');
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    try {
        const res = await fetch('/api/admin/tenants/create-account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
            credentials: 'include'
        });
        const result = await res.json();
        
        if (res.ok) {
            const modal = bootstrap.Modal.getInstance(document.getElementById('addTenantModal'));
            if (modal) modal.hide();
            form.reset();

            if (result.setupUrl) {
                prompt('✅ Tenant Account Created!\n\nCopy & send this Password Setup Link to the tenant:', result.setupUrl);
            } else {
                alert('✅ ' + (result.message || 'Tenant added successfully!'));
            }

            if (typeof loadTenants === 'function') loadTenants(); 
            if (typeof loadRooms === 'function') loadRooms(); 
        } else {
            alert('❌ ' + (result.error || 'Failed to add tenant'));
        }
    } catch (err) {
        console.error('Error adding tenant:', err);
        alert('An error occurred while adding tenant.');
    }
}

async function resendTenantInvite(tenantId) {
    try {
        const res = await fetch(`/api/admin/tenants/${tenantId}/resend-invite`, {
            method: 'POST',
            credentials: 'include'
        });
        const result = await res.json();

        if (res.ok && result.setupUrl) {
            prompt('📧 New Password Setup Link Generated!\n\nCopy & send this link to the tenant:', result.setupUrl);
        } else {
            alert('❌ ' + (result.error || 'Failed to generate setup link.'));
        }
    } catch (err) {
        console.error('Error resending invite:', err);
        alert('Network error generating setup link.');
    }
}
