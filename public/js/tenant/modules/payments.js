// 1. File Upload Preview
document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('paymentProof');
    const fileNameDisplay = document.getElementById('fileName');
    
    if (fileInput) {
        fileInput.addEventListener('change', function() {
            if(this.files && this.files[0]) {
                fileNameDisplay.textContent = this.files[0].name;
            }
        });
    }

    // 2. Submit Payment
    const submitBtn = document.getElementById('submitPaymentBtn');
    if (submitBtn) {
        submitBtn.addEventListener('click', async () => {
            const amount = document.getElementById('paymentAmount').value;
            const file = fileInput.files[0];
            const referenceNumber = document.getElementById('paymentReference').value;
            
            if (!amount || !file) {
                alert('Please provide amount and proof.');
                return;
            }

            const formData = new FormData();
            formData.append('amount', amount);
            formData.append('proof', file);
            if (referenceNumber) formData.append('referenceNumber', referenceNumber);

            try {
                const res = await fetch('/api/payments/upload', {
                    method: 'POST',
                    body: formData
                });
                const data = await res.json();
                if (res.ok) {
                    alert('Payment submitted!');
                    // Close modal
                    const modal = bootstrap.Modal.getInstance(document.getElementById('paymentModal'));
                    modal.hide();
                    // Refresh history if open or page
                    location.reload(); 
                } else {
                    alert(data.error || 'Upload failed');
                }
            } catch (err) {
                console.error(err);
                alert('Error submitting payment');
            }
        });
    }
});
