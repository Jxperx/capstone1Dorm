function getRoomIdFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('roomId');
    return id ? parseInt(id, 10) : null;
}

const STANDARD_GALLERY_ITEMS = [
    { url: '/images/gallery/bedroom.jpg', title: 'Bedroom Suite' },
    { url: '/images/gallery/kitchen.jpg', title: 'Kitchen & Dining Area' },
    { url: '/images/gallery/bath.jpg', title: 'Private Bathroom' },
    { url: '/images/gallery/hallway.jpg', title: 'Corridor & Hallway' },
    { url: '/images/gallery/exterior.jpg', title: 'Exterior & Courtyard' }
];

let currentGalleryList = [...STANDARD_GALLERY_ITEMS];
let currentPhotoIndex = 0;
let isGalleryCoverMode = false;
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
        const unitTitleEl = document.getElementById('unitTitle');
        if (unitTitleEl) unitTitleEl.textContent = unitName;
        
        const unitSubtitleEl = document.getElementById('unitSubtitle');
        if (unitSubtitleEl) unitSubtitleEl.textContent = `Professional ${isCondo ? 'Condo' : 'Dorm'} Living Experience`;
        
        const statusBadge = document.getElementById('unitStatusBadge');
        const isOccupied = room.status === 'occupied';
        if (statusBadge) {
            statusBadge.textContent = isOccupied ? 'Currently Occupied' : 'Available for Rent';
            statusBadge.className = 'status-badge-v2 ' + (isOccupied ? 'status-occupied-v2' : 'status-available-v2');
        }

        const propTypeName = isCondo ? 'Premium Condo' : 'Standard Dormitory';
        const formattedMonthlyRate = (room.monthly_rate != null && !isNaN(Number(room.monthly_rate)))
            ? Number(room.monthly_rate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : (room.monthly_rate || '0.00');
        const capacityText = room.capacity != null ? `${room.capacity}` : '0';
        const roomNumberText = room.room_number || '';
        const floorAreaText = isCondo ? '36.0 sqm' : '28.5 sqm';
        const amenitiesText = isCondo ? 'WiFi, AC, Kitchenette, Bath' : 'WiFi, AC, Bed, Desk';

        // Helper to update elements safely
        const safeSetText = (id, text) => {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        };

        // Update Top Hero Specs Bar
        safeSetText('heroType', propTypeName);
        safeSetText('heroRoomNumber', roomNumberText);
        safeSetText('heroCapacity', capacityText);
        safeSetText('heroRate', formattedMonthlyRate);
        safeSetText('heroFloorArea', floorAreaText);

        // Update Sidebar Unit Summary Card
        safeSetText('infoType', propTypeName);
        safeSetText('infoRoomNumber', roomNumberText);
        safeSetText('infoCapacity', capacityText);
        safeSetText('infoRate', formattedMonthlyRate);
        safeSetText('infoFloorArea', floorAreaText);
        safeSetText('infoAmenities', amenitiesText);

        // Fallback: Also update any elements matching querySelectorAll in case of any duplicate references
        document.querySelectorAll('#infoType').forEach(el => el.textContent = propTypeName);
        document.querySelectorAll('#infoRoomNumber').forEach(el => el.textContent = roomNumberText);
        document.querySelectorAll('#infoCapacity').forEach(el => el.textContent = capacityText);
        document.querySelectorAll('#infoRate').forEach(el => el.textContent = formattedMonthlyRate);

        const dbGallery = (data.gallery || []).map(g => g.image_url).filter(Boolean);
        let galleryList;
        if (dbGallery.length > 0) {
            galleryList = [...dbGallery];
            if (galleryList.length < 5) {
                STANDARD_GALLERY_ITEMS.forEach(item => {
                    if (galleryList.length < 5 && !galleryList.includes(item.url)) {
                        galleryList.push(item.url);
                    }
                });
            } else {
                galleryList = galleryList.slice(0, 5);
            }
        } else {
            galleryList = STANDARD_GALLERY_ITEMS.map(i => i.url);
        }

        // Initialize Thumbnails & Showcase (strictly 5 pictures)
        initGalleryThumbnails(galleryList);

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

// ─── Gallery & Lightbox Controller ──────────────────────────────────────────
function syncActivePhoto(index) {
    if (!currentGalleryList || currentGalleryList.length === 0) return;
    currentPhotoIndex = ((index % currentGalleryList.length) + currentGalleryList.length) % currentGalleryList.length;
    const item = currentGalleryList[currentPhotoIndex];
    if (!item) return;

    // Update main showcase
    const mainImg = document.getElementById('heroImage');
    if (mainImg) {
        mainImg.src = item.url;
        mainImg.alt = item.title || 'Unit Photo';
        mainImg.onerror = function() {
            this.src = STANDARD_GALLERY_ITEMS[currentPhotoIndex % 5].url;
        };
    }
    const bgBlur = document.getElementById('galleryBgBlur');
    if (bgBlur) {
        bgBlur.style.backgroundImage = `url("${item.url}")`;
    }

    // Update main page thumbnail active classes
    const mainThumbs = document.querySelectorAll('#galleryThumbs .thumb-item');
    mainThumbs.forEach((thumb, idx) => {
        if (idx === currentPhotoIndex) {
            thumb.classList.add('active');
        } else {
            thumb.classList.remove('active');
        }
    });

    // Update Lightbox if elements exist
    const lbImg = document.getElementById('lightboxImage');
    if (lbImg) {
        lbImg.src = item.url;
        lbImg.alt = item.title || 'Unit Photo';
        lbImg.onerror = function() {
            this.src = STANDARD_GALLERY_ITEMS[currentPhotoIndex % 5].url;
        };
    }
    const lbCat = document.getElementById('lightboxCategory');
    if (lbCat) {
        lbCat.textContent = item.title || 'Unit Photo';
    }
    const lbCounter = document.getElementById('lightboxCounter');
    if (lbCounter) {
        lbCounter.textContent = `Photo ${currentPhotoIndex + 1} of ${currentGalleryList.length}`;
    }

    // Update Lightbox thumbnail active classes
    const lbThumbs = document.querySelectorAll('#lightboxThumbsBar .lightbox-thumb-item');
    lbThumbs.forEach((thumb, idx) => {
        if (idx === currentPhotoIndex) {
            thumb.classList.add('active');
            thumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        } else {
            thumb.classList.remove('active');
        }
    });
}

function toggleGalleryFit(e) {
    if (e) e.stopPropagation();
    isGalleryCoverMode = !isGalleryCoverMode;
    const mainImg = document.getElementById('heroImage');
    const fitLabel = document.getElementById('fitLabel');
    const fitIcon = document.getElementById('fitIcon');

    if (mainImg) {
        if (isGalleryCoverMode) {
            mainImg.classList.add('fill-mode');
        } else {
            mainImg.classList.remove('fill-mode');
        }
    }
    if (fitLabel) {
        fitLabel.textContent = isGalleryCoverMode ? 'Fit' : 'Fill';
    }
    if (fitIcon) {
        fitIcon.className = isGalleryCoverMode ? 'fas fa-compress-arrows-alt' : 'fas fa-expand-arrows-alt';
    }
}

function openGalleryLightbox(index) {
    if (typeof index === 'number') {
        syncActivePhoto(index);
    } else {
        syncActivePhoto(currentPhotoIndex);
    }
    const modal = document.getElementById('imageLightboxModal');
    if (modal) {
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}

function closeGalleryLightbox() {
    const modal = document.getElementById('imageLightboxModal');
    if (modal) {
        modal.classList.remove('open');
        document.body.style.overflow = '';
    }
}

function prevLightboxPhoto(e) {
    if (e) e.stopPropagation();
    syncActivePhoto(currentPhotoIndex - 1);
}

function nextLightboxPhoto(e) {
    if (e) e.stopPropagation();
    syncActivePhoto(currentPhotoIndex + 1);
}

function handleLightboxBackdropClick(e) {
    if (e.target.id === 'imageLightboxModal' || e.target.classList.contains('lightbox-viewport') || e.target.classList.contains('lightbox-image-wrap')) {
        closeGalleryLightbox();
    }
}

function initGalleryThumbnails(images = []) {
    const thumbContainer = document.getElementById('galleryThumbs');
    const lbThumbsBar = document.getElementById('lightboxThumbsBar');

    const defaultTitles = [
        'Bedroom Suite',
        'Kitchen & Dining Area',
        'Private Bathroom',
        'Corridor & Hallway',
        'Exterior & Courtyard'
    ];

    let list = [];
    if (Array.isArray(images) && images.length > 0) {
        images.forEach((img, idx) => {
            const url = typeof img === 'string' ? img : (img.url || img.image_url);
            if (url && !url.includes('unsplash.com')) {
                list.push({
                    url: url,
                    title: (typeof img === 'object' && img.title) ? img.title : (defaultTitles[idx] || `Unit Photo ${idx + 1}`)
                });
            }
        });
    }

    if (list.length === 0) {
        list = [...STANDARD_GALLERY_ITEMS];
    }
    currentGalleryList = list.slice(0, 5); // Strictly 5 pictures

    if (thumbContainer) {
        thumbContainer.innerHTML = '';
        currentGalleryList.forEach((item, index) => {
            const thumb = document.createElement('div');
            thumb.className = `thumb-item ${index === 0 ? 'active' : ''}`;
            thumb.title = `${item.title} (Click to switch, click big image for full view)`;
            thumb.innerHTML = `<img src="${item.url}" alt="${item.title}" onerror="this.src='${STANDARD_GALLERY_ITEMS[index % 5].url}'">`;
            thumb.onclick = () => {
                syncActivePhoto(index);
            };
            thumbContainer.appendChild(thumb);
        });
    }

    if (lbThumbsBar) {
        lbThumbsBar.innerHTML = '';
        currentGalleryList.forEach((item, index) => {
            const thumb = document.createElement('div');
            thumb.className = `lightbox-thumb-item ${index === 0 ? 'active' : ''}`;
            thumb.title = item.title;
            thumb.innerHTML = `<img src="${item.url}" alt="${item.title}" onerror="this.src='${STANDARD_GALLERY_ITEMS[index % 5].url}'">`;
            thumb.onclick = (e) => {
                e.stopPropagation();
                syncActivePhoto(index);
            };
            lbThumbsBar.appendChild(thumb);
        });
    }

    syncActivePhoto(0);
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
        height: 'auto',
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
        hint.textContent = 'Notice: Monday and Tuesday are not available for visits.';
        hint.style.color = '#ef4444';
        return;
    }

    const bookedEntry = visitAvailabilityCache.bookedDates?.find(b => b.date === dateVal);
    const bookedCount = bookedEntry?.slots?.[slotVal] || 0;
    const maxPerSlot  = visitAvailabilityCache.maxPerSlot || 3;
    const remaining   = maxPerSlot - bookedCount;

    if (remaining <= 0) {
        hint.textContent = 'This slot is fully booked. Please choose another.';
        hint.style.color = '#ef4444';
    } else if (remaining === 1) {
        hint.textContent = 'Notice: Only 1 slot remaining.';
        hint.style.color = '#eab308';
    } else {
        hint.textContent = `${remaining} slot(s) available`;
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

    // Keyboard navigation for Lightbox
    document.addEventListener('keydown', e => {
        const modal = document.getElementById('imageLightboxModal');
        if (!modal || !modal.classList.contains('open')) return;

        if (e.key === 'Escape') {
            closeGalleryLightbox();
        } else if (e.key === 'ArrowLeft') {
            prevLightboxPhoto();
        } else if (e.key === 'ArrowRight') {
            nextLightboxPhoto();
        }
    });
});
