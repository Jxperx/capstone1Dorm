// --- Profile Functions ---
async function openProfileModal() {
    try {
        const res = await fetch('/api/profile/me');
        const data = await res.json();
        if (res.ok) {
            document.getElementById('profileName').value = data.full_name;
            document.getElementById('profilePhone').value = data.phone_number || '';
            document.getElementById('profileEmail').value = data.email;
            document.getElementById('profilePreview').src = data.profile_image_url || 'https://via.placeholder.com/150';
            
            new bootstrap.Modal(document.getElementById('profileModal')).show();
        } else {
            alert('Error loading profile');
        }
    } catch (err) {
        console.error(err);
    }
}

async function saveProfile() {
    const formData = new FormData();
    formData.append('fullName', document.getElementById('profileName').value);
    formData.append('phone', document.getElementById('profilePhone').value);
    
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
            location.reload();
        } else {
            alert('Error: ' + data.error);
        }
    } catch (err) {
        console.error(err);
        alert('Error saving profile');
    }
}

function previewProfileImage(input, previewId) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById(previewId).src = e.target.result;
        }
        reader.readAsDataURL(input.files[0]);
    }
}
