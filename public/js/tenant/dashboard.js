document.addEventListener('DOMContentLoaded', () => {
    // Load common dashboard data
    if (typeof loadDashboardData === 'function') {
        loadDashboardData();
    }

    // ---------------------------------------------------------------
    //  GCash Modal – Bill ID Linkage
    // ---------------------------------------------------------------
    // When the "Pay with GCash" button on any bill row is clicked,
    // transfer its data-bill-id into the modal's hidden input.
    const openGcashBtn = document.getElementById('openGcashModalBtn');
    const gcashBillIdInput = document.getElementById('gcash-bill-id');

    // Helper to prefill GCash modal inputs
    function prefillGcashModal() {
        const amountInput = document.getElementById('payment-amount');
        const descInput = document.getElementById('payment-description');
        
        const currentBillText = document.getElementById('currentBillAmount')?.textContent || '';
        const numericAmount = currentBillText.replace(/[^0-9.]/g, '');
        
        if (amountInput && (!amountInput.value || amountInput.value === '0')) {
            if (numericAmount && parseFloat(numericAmount) > 0) {
                amountInput.value = parseFloat(numericAmount).toFixed(2);
            }
        }

        if (descInput && !descInput.value) {
            const roomNo = document.getElementById('cardRoomNumber')?.textContent || 'Room';
            descInput.value = `Monthly Rent Payment (${roomNo})`;
        }
    }

    if (openGcashBtn && gcashBillIdInput) {
        openGcashBtn.addEventListener('click', () => {
            const billId = openGcashBtn.getAttribute('data-bill-id') || '';
            gcashBillIdInput.value = billId;
            prefillGcashModal();
            console.log('[GCash] Opening modal for bill_id:', billId);
        });
    }

    // Also support dynamic bill rows
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.gcash-pay-btn') || e.target.closest('[data-bs-target="#gcashModal"]');
        if (btn) {
            if (gcashBillIdInput) {
                const billId = btn.getAttribute('data-bill-id') || '';
                gcashBillIdInput.value = billId;
            }
            prefillGcashModal();
        }
    });


    // ---------------------------------------------------------------
    //  GCash Form Submission
    // ---------------------------------------------------------------
    const gcashForm = document.getElementById('gcash-payment-form');
    if (gcashForm) {
        gcashForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const amount      = document.getElementById('payment-amount').value;
            const description = document.getElementById('payment-description').value;
            const billId      = document.getElementById('gcash-bill-id').value;

            // Fetch current user details for PayMongo billing info
            let userData = { full_name: 'Tenant', email: '', phone_number: '' };
            try {
                const userRes = await fetch('/api/current-user');
                if (userRes.ok) userData = await userRes.json();
            } catch (err) {
                console.warn('[GCash] Could not fetch current user:', err);
            }

            const paymentDetails = {
                amount:      parseFloat(amount),
                description: description,
                name:        userData.full_name,
                email:       userData.email,
                phone:       userData.phone_number,
                bill_id:     billId   // ← the specific payment record ID
            };

            console.log('[GCash] Sending payload:', paymentDetails);

            const submitBtn = gcashForm.querySelector('button[type="submit"]');
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Generating QR...';
            }

            try {
                const res    = await fetch('/api/paymongo/qrph', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify(paymentDetails)
                });
                const result = await res.json();

                if (res.ok && result.redirect_url) {
                    // PayMongo Payment Intent QRPH returns a redirect checkout URL that displays the QR directly
                    window.location.href = result.redirect_url;
                } else if (res.ok && result.success && result.qr_image) {
                    // Fallback to older direct API structure if supported
                    gcashForm.style.display = 'none';

                    const qrContainer = document.getElementById('qr-container');
                    const qrImage = document.getElementById('qr-image');
                    const qrRef = document.getElementById('qr-reference');
                    
                    if (qrContainer && qrImage) {
                        qrContainer.classList.remove('d-none');
                        if (result.qr_image.startsWith('data:image')) {
                            qrImage.src = result.qr_image;
                        } else {
                            qrImage.src = `data:image/png;base64,${result.qr_image}`;
                        }
                        
                        const activeCodeId = result.code_id || result.reference_id || 'N/A';
                        if (qrRef) {
                            qrRef.textContent = activeCodeId;
                        }

                        // Start real-time status polling for PayMongo payment confirmation!
                        startQrStatusPolling(activeCodeId);
                    }

                    if (submitBtn) {
                        submitBtn.disabled    = false;
                        submitBtn.textContent = 'Generate QRPH Code';
                    }
                } else {
                    alert(result.message || result.error || 'Failed to initiate QRPH payment.');
                    if (submitBtn) {
                        submitBtn.disabled    = false;
                        submitBtn.textContent = 'Generate QRPH Code';
                    }
                }
            } catch (err) {
                console.error('[QRPH] payment error:', err);
                alert('An error occurred. Please try again.');
                if (submitBtn) {
                    submitBtn.disabled    = false;
                    submitBtn.textContent = 'Generate QRPH Code';
                }
            }
        });
    }
});

// ---------------------------------------------------------------
//  PayMongo QRPH Real-Time Status Listener & Completed UI Renderer
// ---------------------------------------------------------------
let qrPollInterval = null;

function stopQrPolling() {
    if (qrPollInterval) {
        clearInterval(qrPollInterval);
        qrPollInterval = null;
    }
}

// Stop polling when gcashModal is closed
document.addEventListener('DOMContentLoaded', () => {
    const gcashModalEl = document.getElementById('gcashModal');
    if (gcashModalEl) {
        gcashModalEl.addEventListener('hidden.bs.modal', () => {
            stopQrPolling();
            const gcashForm = document.getElementById('gcash-payment-form');
            if (gcashForm) gcashForm.style.display = 'block';
            const qrContainer = document.getElementById('qr-container');
            if (qrContainer) {
                qrContainer.classList.add('d-none');
                // Restore default QR container HTML structure if it was replaced by success screen
                qrContainer.className = 'text-center d-none mt-3 p-3 bg-light rounded-4 border';
                qrContainer.innerHTML = `
                    <h6 class="fw-bold text-primary mb-2"><i class="fas fa-qrcode me-1"></i> Scan to Pay via QRPH</h6>
                    <img id="qr-image" src="" alt="QR Code" class="img-fluid border rounded-3 p-2 bg-white mb-3 shadow-sm" style="max-height: 240px;">
                    
                    <div class="bg-white p-2 rounded-3 border mb-3">
                        <small class="text-muted d-block extra-small">PayMongo Reference Number:</small>
                        <span id="qr-reference" class="fw-bold text-dark font-monospace fs-6"></span>
                    </div>

                    <div class="alert alert-info py-2 px-3 small rounded-pill mb-3">
                        <i class="fas fa-spinner fa-spin me-2"></i> Real-time payment listener active...
                    </div>

                    <button type="button" class="btn btn-outline-secondary rounded-pill btn-sm w-100" data-bs-dismiss="modal">Close</button>
                `;
            }
        });
    }
});

function renderPaymentCompletedUI(codeId, amountPaid) {
    stopQrPolling();
    
    const qrContainer = document.getElementById('qr-container');
    if (!qrContainer) return;

    const formattedAmount = (amountPaid && amountPaid > 0) 
        ? '₱' + parseFloat(amountPaid).toLocaleString('en-US', { minimumFractionDigits: 2 })
        : (document.getElementById('payment-amount')?.value ? '₱' + parseFloat(document.getElementById('payment-amount').value).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '');

    qrContainer.classList.remove('d-none');
    qrContainer.className = 'text-center p-4 bg-white rounded-4 border border-success shadow-sm fade-in';
    qrContainer.innerHTML = `
        <div class="mb-3">
            <div class="bg-success text-white rounded-circle d-inline-flex align-items-center justify-content-center shadow-sm" style="width: 75px; height: 75px;">
                <i class="fas fa-check fa-2x"></i>
            </div>
        </div>
        <h4 class="fw-bold text-success mb-1" style="font-family: 'Playfair Display', serif;">Payment Completed & Done!</h4>
        <p class="text-muted small mb-3">PayMongo has confirmed receipt of <strong class="text-dark">${formattedAmount}</strong>.</p>
        
        <div class="bg-light p-3 rounded-3 border mb-4 text-start small">
            <div class="d-flex justify-content-between align-items-center mb-2">
                <span class="text-muted">Verification Status:</span>
                <span class="badge bg-success px-3 py-1 rounded-pill"><i class="fas fa-shield-alt me-1"></i> VERIFIED & PAID</span>
            </div>
            <div class="d-flex justify-content-between align-items-center">
                <span class="text-muted">PayMongo Reference ID:</span>
                <strong class="font-monospace text-dark">${codeId || 'N/A'}</strong>
            </div>
        </div>

        <div class="d-grid gap-2">
            <button type="button" class="btn btn-success rounded-pill fw-bold py-2" onclick="if(typeof loadHistory==='function') loadHistory();" data-bs-toggle="modal" data-bs-target="#historyModal">
                <i class="fas fa-file-invoice-dollar me-1"></i> View Receipt in History
            </button>
            <button type="button" class="btn btn-light rounded-pill" data-bs-dismiss="modal">Close</button>
        </div>
    `;
}

function startQrStatusPolling(codeId) {
    stopQrPolling();
    if (!codeId || codeId === 'N/A') return;

    console.log('[QRPH] Starting real-time status listener for:', codeId);

    // Initial check immediately
    checkStatus();

    // Poll every 3 seconds
    qrPollInterval = setInterval(checkStatus, 3000);

    async function checkStatus() {
        try {
            const billId = document.getElementById('gcash-bill-id')?.value || '';
            const res = await fetch(`/api/paymongo/status/${codeId}?bill_id=${billId}`);
            if (!res.ok) return;

            const data = await res.json();
            console.log('[QRPH Status Poll Result]:', data);

            if (data.paid) {
                renderPaymentCompletedUI(codeId, data.amount);
            }
        } catch (err) {
            console.warn('[QRPH Status Poll Error]:', err);
        }
    }
}

window.startQrStatusPolling = startQrStatusPolling;
window.renderPaymentCompletedUI = renderPaymentCompletedUI;

function switchTenantTab(tabId, btnElement) {
    document.querySelectorAll('.tenant-tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    if (btnElement) {
        btnElement.classList.add('active');
    }

    if (tabId === 'history') {
        const modalEl = document.getElementById('historyModal');
        if (modalEl && typeof bootstrap !== 'undefined') {
            new bootstrap.Modal(modalEl).show();
        }
    } else if (tabId === 'maintenance') {
        const modalEl = document.getElementById('trackMaintenanceModal');
        if (modalEl && typeof bootstrap !== 'undefined') {
            new bootstrap.Modal(modalEl).show();
        }
    } else if (tabId === 'feedback') {
        const modalEl = document.getElementById('feedbackModal');
        if (modalEl && typeof bootstrap !== 'undefined') {
            new bootstrap.Modal(modalEl).show();
        }
    } else if (tabId === 'profile') {
        const modalEl = document.getElementById('profileModal');
        if (modalEl && typeof bootstrap !== 'undefined') {
            new bootstrap.Modal(modalEl).show();
        }
    }
}

window.switchTenantTab = switchTenantTab;

