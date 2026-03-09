// 3. Submit Maintenance
document.addEventListener('DOMContentLoaded', () => {
    const submitBtn = document.getElementById('submitMaintenanceBtn');
    if (!submitBtn) return;

    submitBtn.addEventListener('click', async () => {
        const title = document.getElementById('maintenanceTitle').value;
        const description = document.getElementById('maintenanceDescription').value;
        const fileInput = document.getElementById('maintenanceProof');
        const file = fileInput.files[0];

        if (!description) {
            alert('Please describe the issue.');
            return;
        }

        const formData = new FormData();
        formData.append('title', title);
        formData.append('description', description);
        if (file) {
            formData.append('image', file);
        }

        try {
            const res = await fetch('/api/maintenance/report', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            
            if (res.ok) {
                alert('Maintenance request submitted!');
                // Close modal
                const modal = bootstrap.Modal.getInstance(document.getElementById('maintenanceModal'));
                modal.hide();
                location.reload();
            } else {
                alert(data.error || 'Failed to submit report');
            }
        } catch (err) {
            console.error(err);
            alert('Error submitting maintenance report');
        }
    });
});
