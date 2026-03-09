async function loadAvailableRooms() {
    try {
        const res = await fetch('/api/rooms');
        const rooms = await res.json();
        
        const condoContainer = document.getElementById('condoListModal');
        const dormContainer = document.getElementById('dormListModal');
        
        if (!condoContainer || !dormContainer) return;

        condoContainer.innerHTML = '';
        dormContainer.innerHTML = '';

        const condoImages = [
            'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80',
            'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80'
        ];
        const dormImages = [
            'https://images.unsplash.com/photo-1555854877-bab0e564b8d5?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80',
            'https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80',
            'https://images.unsplash.com/photo-1540518614846-7eded433c457?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80'
        ];

        rooms.forEach((room, index) => {
            const isCondo = room.room_type === 'condo';
            const container = isCondo ? condoContainer : dormContainer;
            const badgeClass = isCondo ? 'bg-info' : 'bg-secondary';
            const typeLabel = (room.room_type || 'Dorm').toUpperCase();
            
            const imgList = isCondo ? condoImages : dormImages;
            const imgUrl = imgList[index % imgList.length];

            container.innerHTML += `
                <div class="col-md-6">
                    <div class="card border-0 shadow-sm h-100">
                        <img src="${imgUrl}" class="card-img-top" style="height: 180px; object-fit: cover;" alt="Room">
                        <div class="card-body">
                            <div class="d-flex justify-content-between align-items-center mb-2">
                                <h6 class="card-title fw-bold mb-0">${isCondo ? 'Unit' : 'Room'} ${room.room_number}</h6>
                                <span class="badge ${badgeClass}">${typeLabel}</span>
                            </div>
                            <p class="text-muted small mb-3">Capacity: ${room.capacity} Persons</p>
                            <h5 class="fw-bold text-primary mb-0">₱${room.monthly_rate}<span class="text-muted small fw-normal">/mo</span></h5>
                        </div>
                    </div>
                </div>
            `;
        });
        
        if (condoContainer.innerHTML === '') condoContainer.innerHTML = '<p class="text-center w-100 text-muted">No condos available.</p>';
        if (dormContainer.innerHTML === '') dormContainer.innerHTML = '<p class="text-center w-100 text-muted">No dorms available.</p>';

    } catch (err) {
        console.error(err);
    }
}
