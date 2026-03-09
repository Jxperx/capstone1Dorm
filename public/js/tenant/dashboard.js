document.addEventListener('DOMContentLoaded', () => {
    const gcashForm = document.getElementById('gcash-payment-form');
    if (gcashForm) {
        gcashForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const amount = document.getElementById('payment-amount').value;
            const description = document.getElementById('payment-description').value;

            // Fetch current user details for billing info
            const userRes = await fetch('/api/current-user');
            const userData = await userRes.json();

            const paymentDetails = {
                amount: parseFloat(amount),
                description: description,
                name: userData.full_name,
                email: userData.email,
                phone: userData.phone
            };

            try {
                const res = await fetch('/api/paymongo/gcash', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(paymentDetails)
                });

                const result = await res.json();

                if (res.ok) {
                    window.location.href = result.checkout_url;
                } else {
                    alert(result.error || 'Failed to initiate GCash payment.');
                }
            } catch (err) {
                console.error('GCash payment error:', err);
                alert('An error occurred. Please try again.');
            }
        });
    }
});
