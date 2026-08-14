function getRoomIdFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('roomId');
    return id ? parseInt(id, 10) : null;
}

async function loadUnitDetails() {
    const roomId = getRoomIdFromQuery();
    if (!roomId) {
        document.getElementById('unitTitle').textContent = 'Unit not found';
        return;
    }

    try {
        const res = await fetch('/api/rooms/' + roomId);
        if (!res.ok) {
            document.getElementById('unitTitle').textContent = 'Unit not found';
            return;
        }
        const data = await res.json();
        const room = data.room;
        const media = data.media || {};

        const isCondo = room.room_type === 'condo';
        const unitName = (isCondo ? 'Condo Unit ' : 'Dorm Room ') + room.room_number;

        // ── Book This Unit button — redirect to Inquire form, pre-select unit ──
        const bookBtn = document.getElementById('bookBtnLink');
        if (bookBtn) {
            bookBtn.href = `index.html?unit=${roomId}#inquire`;
            bookBtn.textContent = 'Inquire Today';
        }

        // UI Updates
        document.getElementById('unitTitle').textContent = unitName;
        document.getElementById('unitSubtitle').textContent = `Professional ${isCondo ? 'Condo' : 'Dorm'} Living Experience`;
        
        const statusBadge = document.getElementById('unitStatusBadge');
        const isOccupied = room.status === 'occupied';
        statusBadge.textContent = isOccupied ? 'Currently Occupied' : 'Available for Rent';
        statusBadge.className = 'status-badge-v2 ' + (isOccupied ? 'status-occupied-v2' : 'status-available-v2');

        document.getElementById('infoType').textContent = isCondo ? 'Premium Condo' : 'Standard Dormitory';
        document.getElementById('infoRoomNumber').textContent = room.room_number;
        document.getElementById('infoCapacity').textContent = room.capacity;
        document.getElementById('infoRate').textContent = room.monthly_rate;

        const dbGallery = (data.gallery || []).map(g => g.image_url);

        // Gallery Main Setup
        const mainImg = document.getElementById('heroImage');
        const defaultImg = '/images/gallery/bedroom.jpg';
        const initialImg = dbGallery[0] || media.image_url || defaultImg;
        mainImg.src = initialImg;

        // Initialize Thumbnails
        initGalleryThumbnails(initialImg, dbGallery);

        // Fallback map embeds per property type
        const FALLBACK_MAPS = {
            dorm:  'https://www.google.com/maps/embed?pb=!3m2!1sen!2sph!4v1775685460381!5m2!1sen!2sph!6m8!1m7!1s2ga9JEFvoZQ1AgYXzo4SlQ!2m2!1d14.18461196793502!2d121.1375198833002!3f101.9223496897032!4f-6.111879035718218!5f0.7820865974627469',
            condo: 'https://www.google.com/maps/embed?pb=!3m2!1sen!2sph!4v1775685884257!5m2!1sen!2sph!6m8!1m7!1sriOdGSCtvHmZQKl0O6Aauw!2m2!1d14.24048350795415!2d121.0425856352331!3f129.15545414837314!4f-2.0124363928627105!5f0.7820865974627469'
        };

        // 360 Tour / Map
        const mapEl = document.getElementById('unitMap');
        const mediaLabelEl = document.querySelector('.media-label-v2:last-of-type');

        const embedSrc = media.map_embed_url
            ? null  // raw HTML stored in DB — handle below
            : (FALLBACK_MAPS[isCondo ? 'condo' : 'dorm'] || null);

        if (media.map_embed_url) {
            // DB has a raw embed HTML snippet
            if (mediaLabelEl) mediaLabelEl.textContent = 'EliteStay — 360° Virtual Tour';
            mapEl.innerHTML = media.map_embed_url;
            const iframe = mapEl.querySelector('iframe');
            if (iframe) {
                iframe.width = '100%';
                iframe.height = '100%';
                iframe.style.border = '0';
                iframe.style.display = 'block';
            }
        } else if (embedSrc) {
            // Use fallback Google Maps Street View
            if (mediaLabelEl) mediaLabelEl.textContent = 'Location Map — Street View';
            mapEl.innerHTML = `<iframe
                src="${embedSrc}"
                width="100%" height="100%"
                style="border:0; display:block;"
                allowfullscreen="" loading="lazy"
                referrerpolicy="no-referrer-when-downgrade"
                title="${unitName} Location">
            </iframe>`;
        } else {
            if (mediaLabelEl) mediaLabelEl.textContent = 'EliteStay — 360° Virtual Tour';
            mapEl.innerHTML = '<div style="height:100%; display:flex; align-items:center; justify-content:center; color:#94a3b8; flex-direction:column; gap:10px;"><i class="fas fa-map-marked-alt fa-3x"></i><span>Map Not Available</span></div>';
        }

        // Initialize Calendar with active tenant leases
        initCalendar(isOccupied, data.leases || []);

    } catch (err) {
        console.error('Error loading unit details:', err);
    }
}

function initGalleryThumbnails(mainUrl, dbGallery = []) {
    const thumbContainer = document.getElementById('galleryThumbs');
    if (!thumbContainer) return;

    // Use DB gallery if present, otherwise fallback to local sample images
    let images = dbGallery.length > 0 ? dbGallery : [
        mainUrl,
        '/images/gallery/bedroom.jpg',
        '/images/gallery/kitchen.jpg',
        '/images/gallery/bath.jpg',
        '/images/gallery/hallway.jpg',
        '/images/gallery/exterior.jpg'
    ];

    images = images.filter(url => url && !url.includes('unsplash.com'));

    // De-duplicate
    const uniqueImages = [...new Set(images)];

    thumbContainer.innerHTML = '';
    uniqueImages.forEach((url, index) => {
        const thumb = document.createElement('div');
        thumb.className = `thumb-item ${index === 0 ? 'active' : ''}`;
        thumb.innerHTML = `<img src="${url}" alt="Unit View">`;
        thumb.onclick = () => {
            // Update main image
            document.getElementById('heroImage').src = url;
            // Update active state
            document.querySelectorAll('.thumb-item').forEach(t => t.classList.remove('active'));
            thumb.classList.add('active');
        };
        thumbContainer.appendChild(thumb);
    });
}

function initCalendar(isOccupied, leases = []) {
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl) return;

    let calendarEvents = [];

    // Map active tenant leases into occupied events if present
    if (leases && leases.length > 0) {
        leases.forEach(lease => {
            if (lease.lease_start_date) {
                const startDateStr = new Date(lease.lease_start_date).toISOString().split('T')[0];
                const endDateStr = lease.lease_end_date 
                    ? new Date(lease.lease_end_date).toISOString().split('T')[0]
                    : '2030-12-31';

                calendarEvents.push({
                    title: 'OCCUPIED',
                    start: startDateStr,
                    end: endDateStr,
                    display: 'block',
                    color: '#ef4444',
                    textColor: '#ffffff'
                });
            }
        });
    }

    // If unit status is occupied but no lease dates found, mark current year as occupied
    if (calendarEvents.length === 0 && isOccupied) {
        const now = new Date();
        const startOfYear = `${now.getFullYear()}-01-01`;
        const endOfYear = `${now.getFullYear()}-12-31`;

        calendarEvents.push({
            title: 'OCCUPIED',
            start: startOfYear,
            end: endOfYear,
            display: 'block',
            color: '#ef4444',
            textColor: '#ffffff'
        });
    }

    const calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: ''
        },
        height: 380,
        contentHeight: 340,
        events: calendarEvents,
        dayCellDidMount: function(arg) {
            const dateStr = arg.date.toISOString().split('T')[0];
            const isDateOccupied = calendarEvents.some(ev => {
                return dateStr >= ev.start && dateStr <= ev.end;
            });

            if (isDateOccupied) {
                arg.el.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
                arg.el.style.border = '1px solid rgba(239, 68, 68, 0.3)';
            } else {
                arg.el.style.backgroundColor = 'rgba(34, 197, 94, 0.12)';
                arg.el.style.border = '1px solid rgba(34, 197, 94, 0.2)';
            }
        }
    });

    calendar.render();
}


document.addEventListener('DOMContentLoaded', loadUnitDetails);

