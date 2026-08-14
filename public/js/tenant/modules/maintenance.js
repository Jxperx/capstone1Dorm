// Enhanced Tenant Maintenance Module
document.addEventListener('DOMContentLoaded', () => {
    initMaintenanceCategoryGrid();
    initMaintenanceDropzone();
    initMaintenanceSubmit();
});

// 1. Category Selection & Dynamic Troubleshooting Tips
function initMaintenanceCategoryGrid() {
    const grid = document.getElementById('maintCategoryGrid');
    if (!grid) return;

    grid.addEventListener('click', (e) => {
        const card = e.target.closest('.maint-category-card');
        if (!card) return;

        // Remove active class from all cards
        document.querySelectorAll('.maint-category-card').forEach(c => c.classList.remove('active'));
        
        // Activate clicked card
        card.classList.add('active');

        // Update hidden category input
        const categoryName = card.getAttribute('data-category');
        const titleInput = document.getElementById('maintenanceTitle');
        if (titleInput && categoryName) {
            titleInput.value = categoryName;
        }

        // Update Troubleshooting Tip text
        const tipText = card.getAttribute('data-tip');
        const tipContainer = document.getElementById('maintTipText');
        if (tipContainer && tipText) {
            tipContainer.textContent = tipText;
        }
    });
}

// 2. Photo Dropzone & Live Image Preview
function initMaintenanceDropzone() {
    const dropzone = document.getElementById('maintDropzone');
    const fileInput = document.getElementById('maintenanceProof');
    const previewContainer = document.getElementById('imagePreviewContainer');
    const previewImage = document.getElementById('imagePreview');
    const fileNameEl = document.getElementById('previewFileName');
    const fileSizeEl = document.getElementById('previewFileSize');
    const clearBtn = document.getElementById('clearImageBtn');

    if (!fileInput) return;

    // Trigger file dialog on dropzone click
    if (dropzone) {
        dropzone.addEventListener('click', () => fileInput.click());
    }

    // Handle file selection
    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (file) {
            if (file.size > 5 * 1024 * 1024) {
                alert('File size exceeds 5MB limit. Please choose a smaller image.');
                fileInput.value = '';
                return;
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                if (previewImage) previewImage.src = e.target.result;
                if (fileNameEl) fileNameEl.textContent = file.name;
                if (fileSizeEl) fileSizeEl.textContent = (file.size / 1024).toFixed(1) + ' KB';
                if (previewContainer) {
                    previewContainer.classList.remove('d-none');
                    previewContainer.classList.add('d-flex');
                }
            };
            reader.readAsDataURL(file);
        }
    });

    // Clear file selection
    if (clearBtn) {
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            fileInput.value = '';
            if (previewContainer) {
                previewContainer.classList.remove('d-flex');
                previewContainer.classList.add('d-none');
            }
            if (previewImage) previewImage.src = '';
        });
    }
}

// 3. Submit Maintenance Request
function initMaintenanceSubmit() {
    const submitBtn = document.getElementById('submitMaintenanceBtn');
    if (!submitBtn) return;

    submitBtn.addEventListener('click', async () => {
        const title = document.getElementById('maintenanceTitle')?.value || 'Maintenance Issue';
        const description = document.getElementById('maintenanceDescription')?.value?.trim();
        const urgencyLevel = document.getElementById('maintUrgency')?.value || 'normal';
        const preferredSchedule = document.getElementById('maintSchedule')?.value || 'Anytime';
        const fileInput = document.getElementById('maintenanceProof');
        const file = fileInput?.files[0];

        if (!description) {
            alert('Please describe the problem before submitting.');
            document.getElementById('maintenanceDescription')?.focus();
            return;
        }

        const formData = new FormData();
        formData.append('title', title);
        formData.append('description', description);
        formData.append('urgencyLevel', urgencyLevel);
        formData.append('preferredSchedule', preferredSchedule);
        if (file) {
            formData.append('image', file);
        }

        // Loading state
        const originalBtnHTML = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Submitting...';

        try {
            const res = await fetch('/api/maintenance/report', {
                method: 'POST',
                body: formData,
                credentials: 'include'
            });
            const data = await res.json();

            if (res.ok) {
                // Reset form
                document.getElementById('maintenanceDescription').value = '';
                if (fileInput) fileInput.value = '';
                const previewContainer = document.getElementById('imagePreviewContainer');
                if (previewContainer) {
                    previewContainer.classList.remove('d-flex');
                    previewContainer.classList.add('d-none');
                }

                // Hide Report Modal
                const reportModalEl = document.getElementById('maintenanceModal');
                const reportModal = bootstrap.Modal.getInstance(reportModalEl);
                if (reportModal) reportModal.hide();

                // Open Track Requests Modal & Reload
                loadMyMaintenanceRequests();
                const trackModalEl = document.getElementById('trackMaintenanceModal');
                const trackModal = bootstrap.Modal.getOrCreateInstance(trackModalEl);
                trackModal.show();

            } else {
                alert(data.error || 'Failed to submit report.');
            }
        } catch (err) {
            console.error('Error submitting maintenance report:', err);
            alert('An error occurred while submitting your maintenance request.');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalBtnHTML;
        }
    });
}

// 4. Fetch & Render Maintenance Requests
async function loadMyMaintenanceRequests() {
    const loadingEl = document.getElementById('maintRequestsLoading');
    const emptyEl = document.getElementById('maintRequestsEmpty');
    const listEl = document.getElementById('maintRequestsList');

    if (!listEl) return;

    if (loadingEl) loadingEl.classList.remove('d-none');
    if (emptyEl) emptyEl.classList.add('d-none');
    listEl.innerHTML = '';

    try {
        const res = await fetch('/api/maintenance/my-requests', { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to fetch requests');

        const requests = await res.json();

        if (loadingEl) loadingEl.classList.add('d-none');

        if (!requests || requests.length === 0) {
            if (emptyEl) emptyEl.classList.remove('d-none');
            return;
        }

        listEl.innerHTML = requests.map(req => renderMaintenanceTicketCard(req)).join('');

    } catch (err) {
        console.error('Error loading tenant maintenance tickets:', err);
        if (loadingEl) loadingEl.classList.add('d-none');
        listEl.innerHTML = `
            <div class="alert alert-danger text-center rounded-3">
                <i class="fas fa-exclamation-triangle me-2"></i> Failed to load maintenance tickets. Please try again.
            </div>
        `;
    }
}

// Render Individual Ticket Card HTML
function renderMaintenanceTicketCard(req) {
    const formattedDate = req.reported_at ? new Date(req.reported_at).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
    }) : 'Just now';

    // Status Badge
    let statusBadge = '';
    let step1Class = 'completed', step2Class = '', step3Class = '';

    if (req.status === 'resolved') {
        statusBadge = `<span class="badge bg-success px-3 py-2 rounded-pill"><i class="fas fa-check-circle me-1"></i> Resolved</span>`;
        step2Class = 'completed';
        step3Class = 'completed';
    } else if (req.status === 'in_progress') {
        statusBadge = `<span class="badge bg-info text-dark px-3 py-2 rounded-pill"><i class="fas fa-spinner fa-spin me-1"></i> In Progress</span>`;
        step2Class = 'active';
    } else {
        statusBadge = `<span class="badge bg-warning text-dark px-3 py-2 rounded-pill"><i class="fas fa-clock me-1"></i> Pending Review</span>`;
        step1Class = 'active';
    }

    // Urgency Badge
    let urgencyBadge = '';
    if (req.urgency_level === 'emergency') {
        urgencyBadge = `<span class="badge bg-danger rounded-pill"><i class="fas fa-exclamation-circle me-1"></i> Emergency</span>`;
    } else if (req.urgency_level === 'urgent') {
        urgencyBadge = `<span class="badge bg-warning text-dark rounded-pill"><i class="fas fa-exclamation-triangle me-1"></i> Urgent</span>`;
    } else {
        urgencyBadge = `<span class="badge bg-secondary rounded-pill">Normal</span>`;
    }

    // Rating Section HTML (for resolved requests)
    let ratingHTML = '';
    if (req.status === 'resolved') {
        if (req.rating) {
            const stars = '⭐'.repeat(req.rating);
            ratingHTML = `
                <div class="mt-3 bg-light p-3 rounded-3 border">
                    <div class="fw-bold small text-dark d-flex align-items-center">
                        <span class="me-2">Your Rating:</span> ${stars} (${req.rating}/5)
                    </div>
                    ${req.feedback_comment ? `<p class="text-muted small mb-0 mt-1">"${escapeHTML(req.feedback_comment)}"</p>` : ''}
                </div>
            `;
        } else {
            ratingHTML = `
                <div class="mt-3 bg-light p-3 rounded-3 border">
                    <div class="fw-bold small text-dark mb-2">Rate this repair experience:</div>
                    <div class="d-flex align-items-center gap-2 mb-2">
                        <div class="star-rating" id="starRatingGroup_${req.id}">
                            <input type="radio" id="star5_${req.id}" name="rating_${req.id}" value="5"><label for="star5_${req.id}">★</label>
                            <input type="radio" id="star4_${req.id}" name="rating_${req.id}" value="4"><label for="star4_${req.id}">★</label>
                            <input type="radio" id="star3_${req.id}" name="rating_${req.id}" value="3"><label for="star3_${req.id}">★</label>
                            <input type="radio" id="star2_${req.id}" name="rating_${req.id}" value="2"><label for="star2_${req.id}">★</label>
                            <input type="radio" id="star1_${req.id}" name="rating_${req.id}" value="1"><label for="star1_${req.id}">★</label>
                        </div>
                    </div>
                    <input type="text" id="ratingComment_${req.id}" class="form-control form-control-sm mb-2 rounded-3" placeholder="Optional feedback (e.g. Quick fix, very polite staff)...">
                    <button class="btn btn-sm btn-primary rounded-pill px-3" onclick="submitTicketRating(${req.id})">
                        Submit Rating
                    </button>
                </div>
            `;
        }
    }

    const photoUrl = req.photo_url || req.image_url;

    return `
        <div class="maint-ticket-card p-4">
            <div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-2">
                <div>
                    <h6 class="fw-bold text-dark mb-1 d-flex align-items-center gap-2">
                        ${escapeHTML(req.title)}
                        ${urgencyBadge}
                    </h6>
                    <small class="text-muted"><i class="far fa-calendar-alt me-1"></i> Reported on ${formattedDate}</small>
                </div>
                <div>${statusBadge}</div>
            </div>

            <!-- Ticket Details -->
            <p class="text-secondary small mb-3">${escapeHTML(req.description)}</p>

            ${req.preferred_schedule ? `
                <div class="small text-muted mb-2">
                    <i class="far fa-clock me-1 text-primary"></i> <strong>Preferred Visit:</strong> ${escapeHTML(req.preferred_schedule)}
                </div>
            ` : ''}

            <!-- Photo Thumbnail if present -->
            ${photoUrl ? `
                <div class="mb-3">
                    <a href="${photoUrl}" target="_blank">
                        <img src="${photoUrl}" alt="Attachment" class="rounded border shadow-sm" style="max-height: 120px; object-fit: cover;">
                    </a>
                </div>
            ` : ''}

            <!-- Real-time Progress Pipeline -->
            <div class="timeline-pipeline">
                <div class="timeline-step-item">
                    <div class="timeline-step ${step1Class}"><i class="fas fa-paper-plane"></i></div>
                    <span class="timeline-label">Reported</span>
                </div>
                <div class="timeline-step-item">
                    <div class="timeline-step ${step2Class}"><i class="fas fa-wrench"></i></div>
                    <span class="timeline-label">In Progress</span>
                </div>
                <div class="timeline-step-item">
                    <div class="timeline-step ${step3Class}"><i class="fas fa-check"></i></div>
                    <span class="timeline-label">Resolved</span>
                </div>
            </div>

            <!-- Rating HTML if resolved -->
            ${ratingHTML}
        </div>
    `;
}

// 5. Submit Rating & Feedback for Resolved Ticket
async function submitTicketRating(requestId) {
    const selectedStar = document.querySelector(`input[name="rating_${requestId}"]:checked`);
    if (!selectedStar) {
        alert('Please select a star rating (1-5) before submitting.');
        return;
    }

    const ratingValue = parseInt(selectedStar.value, 10);
    const commentInput = document.getElementById(`ratingComment_${requestId}`);
    const feedbackText = commentInput ? commentInput.value.trim() : '';

    try {
        const res = await fetch(`/api/maintenance/${requestId}/rate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rating: ratingValue, feedback: feedbackText }),
            credentials: 'include'
        });

        const data = await res.json();
        if (res.ok) {
            alert('Thank you for rating your maintenance service!');
            loadMyMaintenanceRequests(); // Refresh ticket list
        } else {
            alert(data.error || 'Failed to submit rating.');
        }
    } catch (err) {
        console.error('Error rating maintenance ticket:', err);
        alert('An error occurred while submitting your rating.');
    }
}

// Helper to escape HTML characters
function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, match => {
        const escapeMap = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        };
        return escapeMap[match];
    });
}

// Expose functions globally for HTML event handlers
window.loadMyMaintenanceRequests = loadMyMaintenanceRequests;
window.submitTicketRating = submitTicketRating;


