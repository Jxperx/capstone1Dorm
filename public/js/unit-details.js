function getRoomIdFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('roomId');
    return id ? parseInt(id, 10) : null;
}

async function loadUnitDetails() {
    const roomId = getRoomIdFromQuery();
    if (!roomId) {
        document.getElementById('unitTitle').textContent = 'Unit not found';
        document.getElementById('unitSubtitle').textContent = 'Missing room id in the URL.';
        return;
    }

    try {
        const res = await fetch('/api/rooms/' + roomId);
        if (!res.ok) {
            document.getElementById('unitTitle').textContent = 'Unit not found';
            document.getElementById('unitSubtitle').textContent = 'This unit does not exist or was removed.';
            return;
        }
        const data = await res.json();
        const room = data.room;
        const media = data.media || {};

        const isCondo = room.room_type === 'condo';
        const unitName = (isCondo ? 'Condo Unit ' : 'Dorm Room ') + room.room_number;

        // UI Updates
        document.getElementById('unitTitle').textContent = unitName;
        document.getElementById('unitSubtitle').textContent = `Professional ${isCondo ? 'Condo' : 'Dorm'} Living Experience`;
        
        const statusBadge = document.getElementById('unitStatusBadge');
        const isOccupied = room.status === 'occupied';
        statusBadge.textContent = isOccupied ? 'Currently Occupied' : 'Available for Rent';
        statusBadge.className = 'status-badge ' + (isOccupied ? 'status-occupied' : 'status-available');

        document.getElementById('infoType').textContent = isCondo ? 'Premium Condo' : 'Standard Dormitory';
        document.getElementById('infoRoomNumber').textContent = room.room_number;
        document.getElementById('infoCapacity').textContent = room.capacity;
        document.getElementById('infoRate').textContent = room.monthly_rate;

        // Hero Image
        const heroImg = document.getElementById('heroImage');
        if (media.image_url) {
            heroImg.src = media.image_url;
        } else {
            heroImg.src = 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1350&q=80';
        }

        // Media Elements
        const imagesEl = document.getElementById('unitImages');
        const videoEl = document.getElementById('unitVideo');
        const mapEl = document.getElementById('unitMap');

        if (media.image_url) {
            imagesEl.innerHTML = `<img src="${media.image_url}" alt="Unit" style="width:100%; height:400px; object-fit:cover;">`;
        } else {
            imagesEl.innerHTML = '<div class="media-placeholder"><span>No gallery images available.</span></div>';
        }

        if (media.video_url) {
            videoEl.innerHTML = `<video controls style="width:100%; display:block;"><source src="${media.video_url}"></video>`;
        } else {
            videoEl.innerHTML = '<div class="media-placeholder"><span>Video tour coming soon.</span></div>';
        }

        if (media.map_embed_url) {
            mapEl.innerHTML = media.map_embed_url;
            const iframe = mapEl.querySelector('iframe');
            if (iframe) {
                iframe.width = "100%";
                iframe.height = "400";
                iframe.style.border = "0";
                iframe.style.display = "block";
            }
        } else {
            mapEl.innerHTML = '<div class="media-placeholder"><span>Map location not set.</span></div>';
        }

        // Initialize Calendar
        initCalendar(isOccupied);

    } catch (err) {
        console.error('Error loading unit details:', err);
        document.getElementById('unitSubtitle').textContent = 'Error loading unit details. Please try again later.';
    }
}

function initCalendar(isOccupied) {
    const calendarEl = document.getElementById('calendar');
    const calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: ''
        },
        events: isOccupied ? [
            {
                title: 'Occupied',
                start: '2020-01-01',
                end: '2030-12-31',
                display: 'background',
                color: '#feb2b2'
            }
        ] : [
            {
                title: 'Available',
                start: '2020-01-01',
                end: '2030-12-31',
                display: 'background',
                color: '#b2f5ea'
            }
        ],
        height: 'auto'
    });
    calendar.render();
}

document.addEventListener('DOMContentLoaded', loadUnitDetails);
