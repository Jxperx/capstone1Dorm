// ── Fetch helper with cold-start retry ──
const RETRY_DELAYS = [0, 3000, 6000, 12000]; // immediate, 3s, 6s, 12s

async function fetchWithRetry(url) {
    for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
        if (RETRY_DELAYS[attempt] > 0) {
            await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
        }
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (err) {
            console.warn(`[Landing] Fetch attempt ${attempt + 1}/${RETRY_DELAYS.length} failed:`, err.message);
            if (attempt === RETRY_DELAYS.length - 1) throw err;
        }
    }
}

async function loadRooms() {
    try {
        const data = await fetchWithRetry('/api/rooms');
        const rooms = Array.isArray(data) ? data : (data.rooms || []);
        
        const condoContainer = document.getElementById('condoList');
        const dormContainer = document.getElementById('dormList');
        
        condoContainer.innerHTML = '';
        dormContainer.innerHTML = '';

        // Add sample images mapping
        const condoImages = [
            'room1.jpg',
            'example2.jpeg'
        ];
        const dormImages = [
            'https://images.unsplash.com/photo-1555854877-bab0e564b8d5?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80',
            'https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80',
            'https://images.unsplash.com/photo-1540518614846-7eded433c457?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80'
        ];

        let hasCondo = false;
        let hasDorm = false;

        // Separate and render Condo grid
        const condoRooms = rooms.filter(r => (r.room_type || '').toLowerCase() === 'condo');
        condoRooms.forEach((room, index) => {
            hasCondo = true;
            const imgUrl = room.cover_image || condoImages[index % condoImages.length];
            condoContainer.innerHTML += createCardHTML(room, imgUrl, false);
        });

        // Separate and render single Featured Dorm
        const dormRooms = rooms.filter(r => {
            const rt = (r.room_type || '').toLowerCase();
            return rt === 'dorm' || rt === 'room' || rt === 'dormitory';
        });
        if (dormRooms.length > 0) {
            hasDorm = true;
            const featuredDorm = dormRooms[0];
            const imgUrl = featuredDorm.cover_image || dormImages[0 % dormImages.length];
            dormContainer.innerHTML = `<div class="featured-container">${createCardHTML(featuredDorm, imgUrl, true)}</div>`;
        }

        if (!hasCondo) {
            condoContainer.innerHTML = '<div style="text-align: center; width: 100%; padding: 40px; color: #888;">No condo units available at the moment.</div>';
        }
        if (!hasDorm) {
            dormContainer.innerHTML = '<div style="text-align: center; width: 100%; padding: 40px; color: #888;">No dorm rooms available at the moment.</div>';
        }

    } catch (err) {
        console.error(err);
        document.getElementById('condoList').innerHTML = 'Error loading units.';
        document.getElementById('dormList').innerHTML = 'Error loading units.';
    }
}

// Helper to create card HTML (Standard vs Featured)
function createCardHTML(room, imgUrl, isFeatured) {
    const cardClass = isFeatured ? 'unit-card featured-card' : 'unit-card';
    const typeLabel = (room.room_type || 'Dorm').toUpperCase();
    const prefix = room.room_type === 'condo' ? 'Unit' : 'Room';
    
    return `
        <div class="${cardClass}">
            <div class="card-image" style="background-image: url('${imgUrl}'); background-size: cover; background-position: center;">
                <div class="badge">${typeLabel}</div>
            </div>
            <div class="card-content">
                <h3 class="card-title">${prefix} ${room.room_number}</h3>
                <p class="card-features">Capacity: ${room.capacity} Persons • WiFi Included • AC</p>
                <div class="card-price">
                    ₱${room.monthly_rate} <span>/month</span>
                </div>
                <div class="card-actions">
                    <a href="/unit.html?roomId=${room.id}" class="btn btn-card">View Details</a>
                    <a href="/login" class="btn btn-outline btn-card">Book Now</a>
                </div>
            </div>
        </div>
    `;
}

document.addEventListener('DOMContentLoaded', function () {
    loadRooms();

    // ── Sticky nav scroll enhancement (UI only) ──────────────
    const nav = document.getElementById('mainNav');
    if (nav) {
        window.addEventListener('scroll', function () {
            if (window.scrollY > 40) {
                nav.classList.add('scrolled');
            } else {
                nav.classList.remove('scrolled');
            }
        }, { passive: true });
    }
});
