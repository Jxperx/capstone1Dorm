// Tenant Payments & Payment History Module
document.addEventListener('DOMContentLoaded', () => {
    initPaymentUploadForm();
});

let paymentsCache = [];

// 1. File Upload Preview, OCR Scanning & Mandatory Validation
function initPaymentUploadForm() {
    const fileInput = document.getElementById('paymentProof');
    const fileNameDisplay = document.getElementById('fileName');
    const fileNameContainer = document.getElementById('fileNameDisplayContainer');
    const clearBtn = document.getElementById('clearPaymentProofBtn');
    const uploadArea = document.querySelector('.upload-area');
    const ocrAlert = document.getElementById('ocrScanAlert');
    const ocrText = document.getElementById('ocrScanText');

    if (fileInput) {
        fileInput.addEventListener('change', async function () {
            if (this.files && this.files[0]) {
                const file = this.files[0];
                if (file.size > 5 * 1024 * 1024) {
                    alert('File size exceeds 5MB limit. Please attach a smaller receipt photo.');
                    this.value = '';
                    return;
                }

                if (fileNameDisplay) fileNameDisplay.textContent = file.name;
                if (fileNameContainer) {
                    fileNameContainer.classList.remove('d-none');
                    fileNameContainer.classList.add('d-flex');
                }

                if (uploadArea) {
                    uploadArea.style.borderColor = '#28a745';
                    uploadArea.style.backgroundColor = 'rgba(40, 167, 69, 0.05)';
                }

                // OCR Receipt Scanner Integration
                if (ocrAlert && ocrText) {
                    ocrAlert.classList.remove('d-none');
                    ocrAlert.classList.add('d-flex');
                    ocrText.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i> Scanning receipt photo for Reference Number & Date...';

                    try {
                        const scanData = new FormData();
                        scanData.append('proof', file);
                        const scanRes = await fetch('/api/payments/scan-receipt', {
                            method: 'POST',
                            body: scanData,
                            credentials: 'include'
                        });
                        const scanResult = await scanRes.json();

                        if (scanResult.success) {
                            let detectedInfo = [];
                            
                            // Auto-fill reference number if detected
                            if (scanResult.referenceNumber) {
                                const refInput = document.getElementById('paymentReference');
                                if (refInput && !refInput.value) {
                                    refInput.value = scanResult.referenceNumber;
                                    detectedInfo.push(`Ref No: <strong>${scanResult.referenceNumber}</strong>`);
                                }
                            }

                            // Auto-fill amount if detected
                            if (scanResult.amount) {
                                const amountInput = document.getElementById('paymentAmount');
                                if (amountInput && !amountInput.value) {
                                    amountInput.value = scanResult.amount;
                                    detectedInfo.push(`Amount: <strong>₱${scanResult.amount}</strong>`);
                                }
                            }

                            if (detectedInfo.length > 0) {
                                ocrText.innerHTML = `✨ Auto-detected from receipt: ${detectedInfo.join(' | ')}. Please verify below!`;
                                ocrAlert.className = 'alert alert-success border-0 rounded-3 py-2 px-3 small d-flex align-items-center mb-3';
                            } else {
                                ocrAlert.classList.add('d-none');
                            }
                        } else {
                            ocrAlert.classList.add('d-none');
                        }
                    } catch (scanErr) {
                        console.log('OCR scan non-blocking notice:', scanErr);
                        ocrAlert.classList.add('d-none');
                    }
                }
            } else {
                if (fileNameDisplay) fileNameDisplay.textContent = '';
                if (fileNameContainer) {
                    fileNameContainer.classList.remove('d-flex');
                    fileNameContainer.classList.add('d-none');
                }
                if (uploadArea) {
                    uploadArea.style.borderColor = '';
                    uploadArea.style.backgroundColor = '';
                }
            }
        });
    }

    if (clearBtn && fileInput) {
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            fileInput.value = '';
            if (fileNameContainer) {
                fileNameContainer.classList.remove('d-flex');
                fileNameContainer.classList.add('d-none');
            }
            if (ocrAlert) ocrAlert.classList.add('d-none');
        });
    }

    // Submit Payment Verification
    const submitBtn = document.getElementById('submitPaymentBtn');
    if (submitBtn) {
        submitBtn.addEventListener('click', async () => {
            const amountInput = document.getElementById('paymentAmount');
            const amount = amountInput ? amountInput.value.trim() : '';
            const file = fileInput ? fileInput.files[0] : null;
            const referenceInput = document.getElementById('paymentReference');
            const referenceNumber = referenceInput ? referenceInput.value.trim() : '';
            const paymentDateInput = document.getElementById('paymentDate');
            const paymentDate = paymentDateInput ? paymentDateInput.value : '';

            // Strict Validation Checks:
            if (!amount || parseFloat(amount) <= 0) {
                alert('⚠️ Please enter the exact amount paid.');
                if (amountInput) amountInput.focus();
                return;
            }
            if (!file) {
                alert('⚠️ Please attach a screenshot/photo of your payment receipt.');
                return;
            }
            if (!paymentDate) {
                alert('⚠️ Payment Date is REQUIRED. Please select the date shown on your payment receipt screenshot.');
                if (paymentDateInput) paymentDateInput.focus();
                return;
            }
            if (!referenceNumber) {
                alert('⚠️ Reference Number is REQUIRED. Please enter the reference number shown on your payment receipt screenshot.');
                if (referenceInput) referenceInput.focus();
                return;
            }

            const formData = new FormData();
            formData.append('amount', amount);
            formData.append('proof', file);
            formData.append('paymentDate', paymentDate);
            formData.append('referenceNumber', referenceNumber);

            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Submitting & Verifying...';

            try {
                const res = await fetch('/api/payments/upload', {
                    method: 'POST',
                    body: formData,
                    credentials: 'include'
                });
                const data = await res.json();

                if (res.ok) {
                    alert('✅ Payment proof submitted successfully! We will review your reference number shortly.');
                    location.reload();
                } else {
                    alert('❌ Submission failed: ' + (data.error || 'Server error'));
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = '<i class="fas fa-paper-plane me-1"></i> Submit Payment';
                }
            } catch (err) {
                console.error(err);
                alert('❌ Error submitting payment. Please check your network connection.');
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fas fa-paper-plane me-1"></i> Submit Payment';
            }
        });
    }
}


// 2. Load Payment History Table & Receipts
async function loadHistory() {
    const tbody = document.getElementById('historyTableBody');
    const totalPaidEl = document.getElementById('totalPaidSummary');
    const receiptsCountEl = document.getElementById('totalReceiptsCount');

    if (!tbody) return;

    tbody.innerHTML = `
        <tr>
            <td colspan="5" class="text-center py-4 text-muted">
                <div class="spinner-border spinner-border-sm text-primary me-2"></div>
                Loading your payment records...
            </td>
        </tr>
    `;

    try {
        const res = await fetch('/api/payments/history', { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to load history');

        const payments = await res.json();
        paymentsCache = payments; // Store in memory for receipt modal

        if (!payments || payments.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="text-center py-5 text-muted">
                        <i class="fas fa-receipt fa-2x mb-2 text-secondary opacity-50 d-block"></i>
                        No payment history found yet. Upload your first proof of payment above.
                    </td>
                </tr>
            `;
            if (totalPaidEl) totalPaidEl.textContent = '₱0.00';
            if (receiptsCountEl) receiptsCountEl.textContent = '0 Receipts';
            return;
        }

        let totalApprovedSum = 0;
        let approvedCount = 0;

        tbody.innerHTML = payments.map((p, idx) => {
            const numAmount = parseFloat(p.amount) || 0;
            const isApproved = (p.status === 'approved');

            if (isApproved) {
                totalApprovedSum += numAmount;
                approvedCount++;
            }

            const formattedDate = p.payment_date 
                ? new Date(p.payment_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                : (p.created_at ? new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A');

            // Status Badge
            let statusBadge = '';
            if (isApproved) {
                statusBadge = `<span class="badge bg-success-subtle text-success border border-success px-3 py-1 rounded-pill"><i class="fas fa-check-circle me-1"></i> Approved</span>`;
            } else if (p.status === 'rejected') {
                statusBadge = `<span class="badge bg-danger-subtle text-danger border border-danger px-3 py-1 rounded-pill"><i class="fas fa-times-circle me-1"></i> Rejected</span>`;
            } else {
                statusBadge = `<span class="badge bg-warning-subtle text-warning-emphasis border border-warning px-3 py-1 rounded-pill"><i class="fas fa-clock me-1"></i> Under Review</span>`;
            }

            // Proof & Receipt Actions
            const proofUrl = p.proof_image_url || p.proof_url;
            let actionHTML = '';
            if (proofUrl) {
                actionHTML += `<a href="${proofUrl}" target="_blank" class="btn btn-sm btn-outline-secondary rounded-pill me-1"><i class="fas fa-image me-1"></i> Proof</a>`;
            }
            if (isApproved) {
                actionHTML += `<button class="btn btn-sm btn-success rounded-pill px-3" onclick="openReceiptModal(${idx})"><i class="fas fa-receipt me-1"></i> Receipt</button>`;
            }

            return `
                <tr>
                    <td class="ps-3 fw-semibold text-dark">${formattedDate}</td>
                    <td class="fw-bold text-dark">₱${numAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                    <td class="text-secondary small">${p.reference_number ? escapeHTML(p.reference_number) : '<span class="opacity-50">N/A</span>'}</td>
                    <td class="text-center">${actionHTML || '<span class="text-muted small">-</span>'}</td>
                    <td class="pe-3 text-end">${statusBadge}</td>
                </tr>
            `;
        }).join('');

        if (totalPaidEl) totalPaidEl.textContent = '₱' + totalApprovedSum.toLocaleString('en-US', { minimumFractionDigits: 2 });
        if (receiptsCountEl) receiptsCountEl.textContent = `${approvedCount} Receipt${approvedCount === 1 ? '' : 's'}`;

    } catch (err) {
        console.error('Error fetching payment history:', err);
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center py-4 text-danger">
                    <i class="fas fa-exclamation-triangle me-1"></i> Failed to load payment records.
                </td>
            </tr>
        `;
    }
}

// 3. Open Digital Receipt Modal
function openReceiptModal(paymentIndex) {
    const payment = paymentsCache[paymentIndex];
    if (!payment) return;

    const receiptNo = `RC-${String(payment.id).padStart(5, '0')}`;
    const amountVal = parseFloat(payment.amount) || 0;
    const formattedAmount = '₱' + amountVal.toLocaleString('en-US', { minimumFractionDigits: 2 });
    const formattedDate = payment.payment_date 
        ? new Date(payment.payment_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        : new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    // Fill elements
    const tagEl = document.getElementById('receiptNumberTag');
    const nameEl = document.getElementById('receiptTenantName');
    const roomEl = document.getElementById('receiptRoomNo');
    const dateEl = document.getElementById('receiptDate');
    const refEl = document.getElementById('receiptRef');
    const itemAmountEl = document.getElementById('receiptItemAmount');
    const totalAmountEl = document.getElementById('receiptTotalAmount');

    if (tagEl) tagEl.textContent = `RECEIPT #${receiptNo}`;
    if (nameEl) nameEl.textContent = payment.full_name || document.getElementById('welcomeName')?.textContent?.replace('Welcome Back, ', '') || 'Tenant';
    if (roomEl) roomEl.textContent = payment.room_number ? `Room ${payment.room_number}` : (document.getElementById('cardRoomNumber')?.textContent || 'Assigned Room');
    if (dateEl) dateEl.textContent = formattedDate;
    if (refEl) refEl.textContent = payment.reference_number || 'GCASH / DIRECT';
    if (itemAmountEl) itemAmountEl.textContent = formattedAmount;
    if (totalAmountEl) totalAmountEl.textContent = formattedAmount;

    // Show modal
    const modalEl = document.getElementById('receiptModal');
    if (modalEl) {
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();
    }
}

// 4. Print / Download Receipt
function printReceiptCard() {
    const printContent = document.getElementById('printableReceiptCard')?.innerHTML;
    if (!printContent) return;

    const printWindow = window.open('', '', 'height=600,width=800');
    printWindow.document.write('<html><head><title>Print Receipt</title>');
    printWindow.document.write('<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">');
    printWindow.document.write('<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">');
    printWindow.document.write('<style>body { padding: 30px; font-family: sans-serif; }</style>');
    printWindow.document.write('</head><body>');
    printWindow.document.write(printContent);
    printWindow.document.write('</body></html>');
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
        printWindow.print();
        printWindow.close();
    }, 500);
}

// Helper to escape HTML string
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

// Expose globals for HTML onclick listeners
window.loadHistory = loadHistory;
window.openReceiptModal = openReceiptModal;
window.printReceiptCard = printReceiptCard;
