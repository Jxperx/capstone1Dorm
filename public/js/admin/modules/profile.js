// --- Admin Profile Functions ---

function syncTopNavProfile(data) {
    if (!data) return;
    const nameEl = document.getElementById('topNavAdminName');
    if (nameEl && data.full_name) {
        nameEl.textContent = data.full_name;
    }
    const avatarEl = document.getElementById('topNavAdminAvatar');
    if (avatarEl && data.profile_image_url) {
        avatarEl.src = data.profile_image_url;
    }
}

async function loadTopNavProfile() {
    try {
        const res = await fetch('/api/profile/me', { credentials: 'include' });
        if (res.ok) {
            const data = await res.json();
            syncTopNavProfile(data);
        }
    } catch (err) {
        console.error('Failed to fetch admin profile for topbar:', err);
    }
}

async function openProfileModal() {
    try {
        const res = await fetch('/api/profile/me', { credentials: 'include' });
        const data = await res.json();
        if (res.ok) {
            const nameInput = document.getElementById('profileName');
            const phoneInput = document.getElementById('profilePhone');
            const emailInput = document.getElementById('profileEmail');
            const previewImg = document.getElementById('profilePreview');

            if (nameInput) nameInput.value = data.full_name || '';
            if (phoneInput) phoneInput.value = data.phone_number || '';
            if (emailInput) emailInput.value = data.email || '';
            if (previewImg) previewImg.src = data.profile_image_url || 'https://via.placeholder.com/150';
            
            syncTopNavProfile(data);

            const modalEl = document.getElementById('profileModal');
            if (modalEl && typeof bootstrap !== 'undefined') {
                const modalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
                modalInstance.show();
            }
        } else {
            alert('Unable to load profile data. Please try again.');
        }
    } catch (err) {
        console.error('Error opening profile modal:', err);
        alert('Network error while loading profile.');
    }
}

async function saveProfile() {
    const nameInput = document.getElementById('profileName');
    const phoneInput = document.getElementById('profilePhone');
    const saveBtn = document.getElementById('btnSaveAdminProfile');

    if (!nameInput || !nameInput.value.trim()) {
        alert('Full name is required.');
        if (nameInput) nameInput.focus();
        return;
    }

    const formData = new FormData();
    formData.append('fullName', nameInput.value.trim());
    formData.append('phone', phoneInput ? phoneInput.value.trim() : '');
    
    const fileInput = document.getElementById('profileImageInput');
    if (fileInput && fileInput.files && fileInput.files[0]) {
        formData.append('profileImage', fileInput.files[0]);
    }

    const originalBtnHtml = saveBtn ? saveBtn.innerHTML : 'Save Changes';
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status"></span>Saving...';
    }

    try {
        const res = await fetch('/api/profile/update', {
            method: 'POST',
            body: formData,
            credentials: 'include'
        });
        const data = await res.json();
        if (res.ok) {
            // Update topbar profile immediately
            syncTopNavProfile({
                full_name: nameInput.value.trim(),
                profile_image_url: document.getElementById('profilePreview') ? document.getElementById('profilePreview').src : null
            });

            // If enterprise toast is available, show it; otherwise alert
            if (typeof showEnterpriseToast === 'function') {
                showEnterpriseToast('Profile updated successfully', 'success');
            } else {
                alert('Profile updated successfully!');
            }

            const modalEl = document.getElementById('profileModal');
            if (modalEl && typeof bootstrap !== 'undefined') {
                const modalInstance = bootstrap.Modal.getInstance(modalEl);
                if (modalInstance) modalInstance.hide();
            }
        } else {
            alert('Error: ' + (data.error || 'Failed to update profile.'));
        }
    } catch (err) {
        console.error('Error updating profile:', err);
        alert('An unexpected error occurred while saving your profile.');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = originalBtnHtml;
        }
    }
}

function previewProfileImage(input, previewId) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const previewEl = document.getElementById(previewId);
            if (previewEl) previewEl.src = e.target.result;
        };
        reader.readAsDataURL(input.files[0]);
    }
}

// Auto-load top navbar profile when document is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadTopNavProfile);
} else {
    loadTopNavProfile();
}
