// --- 3. Load Payments ---
async function loadPayments() {
    try {
        const res = await fetch('/api/admin/payments');
        const payments = await res.json();
        const list = document.getElementById('paymentsList');
        list.innerHTML = '';

        const pendingPayments = payments.filter(p => p.status === 'pending');

        if (pendingPayments.length === 0) {
            list.innerHTML = '<li class="list-group-item text-center text-muted">No pending payments.</li>';
            return;
        }

        pendingPayments.forEach(p => {
            const tenantName = p.full_name || 'Unknown';
            const roomNum = p.room_number || 'N/A';
            const proofUrl = p.proof_image_url || '#';
            const amount = p.amount;
            const reference = p.reference_number || 'N/A';
            const postedAt = p.created_at ? new Date(p.created_at).toLocaleString() : 'N/A';

            list.innerHTML += `
                <li class="list-group-item d-flex justify-content-between align-items-center">
                    <div>
                        <strong>${tenantName}</strong> <span class="text-muted">(Room ${roomNum})</span><br>
                        <small class="text-muted">₱${amount}</small><br>
                        <small class="text-muted">Ref: ${reference} • Posted: ${postedAt}</small><br>
                        <a href="#" onclick="viewProof('${proofUrl}')" class="text-primary text-decoration-none small"><i class="fas fa-image"></i> View Proof</a>
                    </div>
                    <div>
                        <button class="btn btn-sm btn-success me-1" onclick="approvePayment(${p.id})"><i class="fas fa-check"></i></button>
                        <button class="btn btn-sm btn-danger" onclick="rejectPayment(${p.id})"><i class="fas fa-times"></i></button>
                    </div>
                </li>
            `;
        });
    } catch (err) {
        console.error(err);
    }
}

function approvePayment(id) {
    if(!confirm('Approve this payment?')) return;
    fetch(`/api/payments/${id}/approve`, { method: 'POST' })
        .then(res => res.json())
        .then(data => { alert(data.message); loadPayments(); loadStats(); });
}

async function triggerRentReminders() {
    if (!confirm('Are you sure you want to send rent reminders to all active dorm tenants? This will send an email to each of them.')) return;

    const btn = document.querySelector('button[onclick="triggerRentReminders()"]');
    const originalText = btn.innerHTML;
    
    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Sending...';

        const res = await fetch('/api/admin/trigger-reminders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const result = await res.json();

        if (res.ok) {
            alert(result.message);
        } else {
            alert(result.error || 'Failed to send reminders');
        }
    } catch (err) {
        console.error(err);
        alert('An error occurred while sending reminders');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}
