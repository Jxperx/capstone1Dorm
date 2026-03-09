// --- Profile Functions ---
function previewProfileImage(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('profilePreview').src = e.target.result;
        }
        reader.readAsDataURL(input.files[0]);
    }
}

async function loadProfile() {
    try {
        const res = await fetch('/api/profile/me');
        if (!res.ok) throw new Error('Failed to load profile');
        const data = await res.json();

        // Populate fields
        document.getElementById('profileName').value = data.full_name || '';
        document.getElementById('profileEmail').value = data.email || '';
        document.getElementById('profilePhone').value = data.phone_number || '';
        document.getElementById('guardianName').value = data.guardian_name || '';
        document.getElementById('guardianAddress').value = data.guardian_address || '';
        document.getElementById('guardianContact').value = data.guardian_contact || '';
        
        // Room Info
        const roomText = data.room_number ? `Room ${data.room_number}` : 'No Room Assigned';
        document.getElementById('profileRoomDisplay').textContent = roomText;

        // Profile Image
        if (data.profile_image_url) {
            document.getElementById('profilePreview').src = data.profile_image_url;
            // Also update sidebar image if exists
            const sidebarImg = document.querySelector('.sidebar .profile-img');
            if (sidebarImg) sidebarImg.src = data.profile_image_url;
        }
    } catch (err) {
        console.error(err);
        alert('Error loading profile');
    }
}

async function saveProfile() {
    const requiredIds = ['profileName', 'profilePhone', 'guardianName', 'guardianAddress', 'guardianContact'];
    for (const id of requiredIds) {
        if (!document.getElementById(id).value.trim()) {
            alert('Please fill in all required fields marked with *');
            return;
        }
    }

    const formData = new FormData();
    formData.append('fullName', document.getElementById('profileName').value);
    formData.append('phone', document.getElementById('profilePhone').value);
    formData.append('guardianName', document.getElementById('guardianName').value);
    formData.append('guardianAddress', document.getElementById('guardianAddress').value);
    formData.append('guardianContact', document.getElementById('guardianContact').value);
    
    const fileInput = document.getElementById('profileImageInput');
    if (fileInput.files[0]) {
        formData.append('profileImage', fileInput.files[0]);
    }

    try {
        const res = await fetch('/api/profile/update', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        
        if (res.ok) {
            alert('Profile updated!');
            location.reload(); // Refresh to show new name/pic everywhere
        } else {
            alert('Error: ' + data.error);
        }
    } catch (err) {
        console.error(err);
        alert('Error saving profile');
    }
}
