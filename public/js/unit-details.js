function getRoomIdFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('roomId');
    return id ? parseInt(id, 10) : null;
}

let currentRoomId = null;

async function loadUnitDetails() {
    const roomId = getRoomIdFromQuery();
    currentRoomId = roomId;
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

        // ── Wire up new sidebar buttons ──────────────────────────────────────
        const visitBtn = document.getElementById('scheduleVisitBtn');
        if (visitBtn) {
            visitBtn.addEventListener('click', () => openVisitModal(roomId, room.room_number));
        }
        const rentBtn = document.getElementById('rentNowBtn');
        if (rentBtn) {
            rentBtn.addEventListener('click', () => handleRentNowClick(roomId, unitName));
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
            dorm:  'https://www.google.com/maps/embed?pb=!3m2!1sen!2sph!4v1775685460381!5m2!1sen!2sph!6m8!1m7!1sbSPznQdEBNgHTS7KmGUD0A!2m2!1d14.1846702!2d121.1375905!3f42.03968566802905!4f-9.663768123331309!5f0.7820865974627469',
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

        // Fetch visit availability then initialize calendar
        const visitData = await fetchVisitAvailability(roomId);
        initCalendar(isOccupied, data.leases || [], visitData);

    } catch (err) {
        console.error('Error loading unit details:', err);
    }
}

// ─── Fetch visit availability from API ───────────────────────────────────────
async function fetchVisitAvailability(roomId) {
    try {
        const res = await fetch(`/api/visits/availability/${roomId}`);
        if (!res.ok) return { bookedDates: [], maxPerSlot: 3 };
        return await res.json();
    } catch (_) {
        return { bookedDates: [], maxPerSlot: 3 };
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

function initCalendar(isOccupied, leases = [], visitData = {}) {
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

    // Build a set of fully-booked visit dates and partially-booked dates
    const bookedDates   = visitData.bookedDates || [];
    const visitDateSet  = new Set(bookedDates.filter(b => b.fullyBooked).map(b => b.date));
    const partialVisits = new Set(bookedDates.filter(b => !b.fullyBooked).map(b => b.date));

    // Add teal visit events for partial/full visit bookings
    bookedDates.forEach(b => {
        calendarEvents.push({
            title: b.fullyBooked ? 'VISITS FULL' : 'VISIT SLOTS',
            start: b.date,
            allDay: true,
            display: 'block',
            color: b.fullyBooked ? '#0891b2' : '#06b6d4',
            textColor: '#ffffff',
            extendedProps: { isVisit: true }
        });
    });

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
                if (ev.extendedProps?.isVisit) return false;
                return dateStr >= ev.start && dateStr <= ev.end;
            });

            if (isDateOccupied) {
                arg.el.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
                arg.el.style.border = '1px solid rgba(239, 68, 68, 0.3)';
            } else {
                arg.el.style.backgroundColor = 'rgba(34, 197, 94, 0.12)';
                arg.el.style.border = '1px solid rgba(34, 197, 94, 0.2)';
            }

            // Mon/Tue — mark as not available for visits
            const dayOfWeek = arg.date.getDay(); // 1=Mon, 2=Tue
            if (dayOfWeek === 1 || dayOfWeek === 2) {
                arg.el.style.opacity = '0.5';
                arg.el.title = 'Not available for site visits (Mon–Tue)';
            }
        }
    });

    calendar.render();
}


// ════════════════════════════════════════════════════════════════════
//  VISIT MODAL LOGIC
// ════════════════════════════════════════════════════════════════════

let visitAvailabilityCache = null;

async function openVisitModal(unitId, unitName) {
    if (!visitAvailabilityCache) {
        visitAvailabilityCache = await fetchVisitAvailability(unitId);
    }

    const modal = document.getElementById('visitModal');
    if (!modal) return;

    document.getElementById('visitUnitLabel').textContent = unitName || `Unit #${unitId}`;

    // Reset form fields
    ['visitDate','visitSlot','visitName','visitPhone','visitEmail','visitNotes'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    document.getElementById('slotHint').textContent = '';
    document.getElementById('visitErrors').style.display = 'none';
    document.getElementById('visitErrors').innerHTML  = '';
    document.getElementById('visitSuccess').style.display  = 'none';
    document.getElementById('visitFormBody').style.display = 'block';

    // Set min date to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    document.getElementById('visitDate').min = tomorrow.toISOString().split('T')[0];

    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeVisitModal() {
    const modal = document.getElementById('visitModal');
    if (modal) { modal.classList.remove('open'); document.body.style.overflow = ''; }
}

// Validate slot availability when date + slot changes
function updateSlotAvailability() {
    const dateVal = document.getElementById('visitDate').value;
    const slotVal = document.getElementById('visitSlot').value;
    const hint    = document.getElementById('slotHint');
    if (!dateVal || !slotVal || !visitAvailabilityCache) { hint.textContent = ''; return; }

    const dateObj = new Date(dateVal + 'T00:00:00');
    const day = dateObj.getDay();

    if (day === 1 || day === 2) {
        hint.textContent = '⚠️ Monday and Tuesday are not available for visits.';
        hint.style.color = '#ef4444';
        return;
    }

    const bookedEntry = visitAvailabilityCache.bookedDates?.find(b => b.date === dateVal);
    const bookedCount = bookedEntry?.slots?.[slotVal] || 0;
    const maxPerSlot  = visitAvailabilityCache.maxPerSlot || 3;
    const remaining   = maxPerSlot - bookedCount;

    if (remaining <= 0) {
        hint.textContent = '❌ This slot is fully booked. Please choose another.';
        hint.style.color = '#ef4444';
    } else if (remaining === 1) {
        hint.textContent = '⚠️ Only 1 slot remaining!';
        hint.style.color = '#eab308';
    } else {
        hint.textContent = `✅ ${remaining} slot(s) available`;
        hint.style.color = '#22c55e';
    }
}

async function submitVisitForm() {

    const unitId   = currentRoomId;
    const date     = document.getElementById('visitDate').value;
    const slot     = document.getElementById('visitSlot').value;
    const name     = document.getElementById('visitName').value.trim();
    const email    = document.getElementById('visitEmail').value.trim();
    const phone    = document.getElementById('visitPhone').value.trim();
    const notes    = document.getElementById('visitNotes').value.trim();
    const errEl    = document.getElementById('visitErrors');
    const submitBtn = document.getElementById('visitSubmitBtn');

    errEl.style.display = 'none';
    errEl.innerHTML = '';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Scheduling…';

    try {
        const res = await fetch('/api/visits/schedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ unit_id: unitId, visit_date: date, time_slot: slot, name, email, phone, notes })
        });
        const data = await res.json();

        if (data.success) {
            document.getElementById('visitFormBody').style.display = 'none';
            document.getElementById('visitSuccess').style.display = 'block';
            visitAvailabilityCache = null; // refresh next time
        } else {
            errEl.innerHTML = (data.errors || ['Unknown error.']).map(e => `<li>${e}</li>`).join('');
            errEl.style.display = 'block';
        }
    } catch (_) {
        errEl.innerHTML = '<li>Network error. Please try again.</li>';
        errEl.style.display = 'block';
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Schedule Visit';
    }
}


// ════════════════════════════════════════════════════════════════════
//  RENT NOW MODAL LOGIC
// ════════════════════════════════════════════════════════════════════

let rentUnitId   = null;
let rentStep     = 1;
let rentFormData = {};

async function handleRentNowClick(unitId, unitName) {
    // Check auth first
    try {
        const res  = await fetch('/api/applications/check-auth');
        const data = await res.json();

        if (!data.loggedIn) {
            // Redirect to login with a return URL
            const returnUrl = encodeURIComponent(window.location.href);
            window.location.href = `/login?returnTo=${returnUrl}&reason=rent`;
            return;
        }

        // User is logged in — open the rent modal
        rentUnitId = unitId;
        openRentModal(unitId, unitName, data.user);
    } catch (_) {
        window.location.href = '/login';
    }
}

function openRentModal(unitId, unitName, user) {
    rentStep = 1;
    rentFormData = {};

    const modal = document.getElementById('rentModal');
    if (!modal) return;

    document.getElementById('rentUnitLabel').textContent = unitName || `Unit #${unitId}`;
    document.getElementById('rentSuccess').style.display = 'none';
    document.getElementById('rentWizard').style.display  = 'block';
    document.getElementById('rentErrors').style.display  = 'none';
    document.getElementById('rentErrors').innerHTML      = '';

    // Pre-fill name from session
    if (user?.name) {
        const nameEl = document.getElementById('rentFullName');
        if (nameEl) nameEl.value = user.name;
    }

    // Set min move-in date to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    document.getElementById('rentMoveIn').min = tomorrow.toISOString().split('T')[0];

    showRentStep(1);
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeRentModal() {
    const modal = document.getElementById('rentModal');
    if (modal) { modal.classList.remove('open'); document.body.style.overflow = ''; }
}

function showRentStep(step) {
    rentStep = step;
    for (let i = 1; i <= 3; i++) {
        const el = document.getElementById(`rentStep${i}`);
        if (el) el.style.display = (i === step) ? 'block' : 'none';
        const dot = document.getElementById(`stepDot${i}`);
        if (dot) {
            dot.className = 'step-dot' + (i === step ? ' active' : i < step ? ' done' : '');
        }
    }
}

function rentNext() {
    const errEl = document.getElementById('rentErrors');
    errEl.style.display = 'none';

    if (rentStep === 1) {
        const phone  = document.getElementById('rentPhone').value.trim();
        const moveIn = document.getElementById('rentMoveIn').value;
        const stay   = document.getElementById('rentStay').value;

        const errors = [];
        if (!phone)  errors.push('Phone number is required.');
        if (!moveIn) errors.push('Move-in date is required.');
        if (!stay || parseInt(stay) < 1) errors.push('Please enter intended stay duration.');

        if (errors.length) {
            errEl.innerHTML = errors.map(e => `<li>${e}</li>`).join('');
            errEl.style.display = 'block';
            return;
        }

        rentFormData.phone             = phone;
        rentFormData.guardian_phone    = document.getElementById('rentGuardianPhone').value.trim();
        rentFormData.move_in_date      = moveIn;
        rentFormData.intended_stay_months = parseInt(stay);
        rentFormData.message           = document.getElementById('rentMessage').value.trim();

        // Populate review step
        populateReview();
        showRentStep(2);

    } else if (rentStep === 2) {
        // ID upload step — just proceed, validation on submit
        showRentStep(3);
    }
}

function rentBack() {
    if (rentStep > 1) showRentStep(rentStep - 1);
}

function populateReview() {
    const moveInDate = new Date(rentFormData.move_in_date);
    document.getElementById('reviewUnit').textContent     = document.getElementById('rentUnitLabel').textContent;
    document.getElementById('reviewMoveIn').textContent   = moveInDate.toDateString();
    document.getElementById('reviewStay').textContent     = `${rentFormData.intended_stay_months} month(s)`;
    document.getElementById('reviewPhone').textContent    = rentFormData.phone;
}

async function submitRentApplication() {
    const errEl     = document.getElementById('rentErrors');
    const submitBtn = document.getElementById('rentSubmitBtn');

    errEl.style.display = 'none';
    errEl.innerHTML = '';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';

    const formData = new FormData();
    formData.append('unit_id',               rentUnitId);
    formData.append('move_in_date',          rentFormData.move_in_date);
    formData.append('intended_stay_months',  rentFormData.intended_stay_months);
    formData.append('phone',                 rentFormData.phone);
    formData.append('guardian_phone',        rentFormData.guardian_phone || '');
    formData.append('message',               rentFormData.message || '');

    const schoolId = document.getElementById('rentSchoolId').files[0];
    const govtId   = document.getElementById('rentGovtId').files[0];
    if (schoolId) formData.append('school_id', schoolId);
    if (govtId)   formData.append('govt_id',   govtId);

    try {
        const res  = await fetch('/api/applications/submit', { method: 'POST', body: formData });
        const data = await res.json();

        if (data.success) {
            document.getElementById('rentWizard').style.display  = 'none';
            document.getElementById('rentSuccess').style.display = 'block';
        } else {
            errEl.innerHTML = (data.errors || ['Unknown error.']).map(e => `<li>${e}</li>`).join('');
            errEl.style.display = 'block';
        }
    } catch (_) {
        errEl.innerHTML = '<li>Network error. Please try again.</li>';
        errEl.style.display = 'block';
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Application';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadUnitDetails();

    // Close modals when clicking the dark backdrop
    document.getElementById('visitModal')?.addEventListener('click', e => {
        if (e.target === e.currentTarget) closeVisitModal();
    });
    document.getElementById('rentModal')?.addEventListener('click', e => {
        if (e.target === e.currentTarget) closeRentModal();
    });
});
