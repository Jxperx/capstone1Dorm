async function loadRooms() {
    try {
        const res = await fetch('/api/rooms');
        const rooms = await res.json();
        
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

        rooms.forEach((room, index) => {
            const isCondo = room.room_type === 'condo';
            const container = isCondo ? condoContainer : dormContainer;
            
            if (isCondo) hasCondo = true;
            else hasDorm = true;

            const typeLabel = (room.room_type || 'Dorm').toUpperCase();
            
            // Pick random image
            const imgList = isCondo ? condoImages : dormImages;
            const imgUrl = imgList[index % imgList.length];

            container.innerHTML += `
                <div class="unit-card">
                    <div class="img-container">
                        <img src="${imgUrl}" alt="Room">
                        <span class="badge">${typeLabel}</span>
                    </div>
                    <div class="unit-info">
                        <h3>${isCondo ? 'Unit' : 'Room'} ${room.room_number}</h3>
                        <p class="details">Capacity: ${room.capacity} Persons • WiFi Included • AC</p>
                        <div class="price">$${room.monthly_rate}<span>/month</span></div>
                        <div style="display:flex;gap:8px;flex-wrap:wrap;">
                            <a href="/unit.html?roomId=${room.id}" class="btn btn-card">View Details</a>
                            <a href="/login" class="btn btn-outline btn-card">Book Now</a>
                        </div>
                    </div>
                </div>
            `;
        });

        if (!hasCondo) {
            condoContainer.innerHTML = '<div style="text-align: center; width: 100%; grid-column: 1/-1; padding: 40px; color: #888;">No condo units available at the moment.</div>';
        }
        if (!hasDorm) {
            dormContainer.innerHTML = '<div style="text-align: center; width: 100%; grid-column: 1/-1; padding: 40px; color: #888;">No dorm rooms available at the moment.</div>';
        }

    } catch (err) {
        console.error(err);
        document.getElementById('condoList').innerHTML = 'Error loading units.';
        document.getElementById('dormList').innerHTML = 'Error loading units.';
    }
}

document.addEventListener('DOMContentLoaded', function () {
    loadRooms();
});
