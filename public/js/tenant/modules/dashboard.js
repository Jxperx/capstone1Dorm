async function loadDashboardData() {
    try {
        const res = await fetch('/api/profile/me');
        if (!res.ok) throw new Error('Failed to load profile');
        const data = await res.json();

        // 1. Update Personal Info
        const firstName = data.full_name ? data.full_name.split(' ')[0] : 'Tenant';
        document.getElementById('welcomeName').textContent = `Hey, ${firstName}! 👋`;
        document.getElementById('sidebarName').textContent = data.full_name || 'Tenant';
        
        // 2. Update Room Info
        if (data.room_number) {
            const roomType = (data.room_type || 'dorm').toUpperCase();
            const roomDetails = `${data.capacity || 0} Bed ${roomType === 'CONDO' ? 'Unit' : 'Dormitory'} • AC • WiFi`;
            
            document.getElementById('sidebarRoom').textContent = `${roomType === 'CONDO' ? 'Unit' : 'Room'} ${data.room_number}`;
            document.getElementById('cardRoomNumber').textContent = `${roomType === 'CONDO' ? 'Unit' : 'Room'} ${data.room_number}`;
            document.getElementById('cardRoomType').textContent = roomType;
            document.getElementById('cardRoomType').className = `badge ${roomType === 'CONDO' ? 'bg-info' : 'bg-primary'}`;
            document.getElementById('cardRoomDetails').textContent = roomDetails;
        } else {
            document.getElementById('sidebarRoom').textContent = 'No Room Assigned';
            document.getElementById('cardRoomNumber').textContent = 'No Room Assigned';
        }

        // 3. Update Profile Image
        if (data.profile_image_url) {
            const sidebarImg = document.querySelector('.sidebar .profile-img');
            const mobileImg = document.querySelector('.dropdown img'); // Mobile header
            if (sidebarImg) sidebarImg.src = data.profile_image_url;
            if (mobileImg) mobileImg.src = data.profile_image_url;
        }

    } catch (err) {
        console.error('Error loading dashboard data:', err);
    }
}
