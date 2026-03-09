// --- 1. Load Stats ---
async function loadStats() {
    try {
        const res = await fetch('/api/admin/stats');
        const data = await res.json();
        
        document.getElementById('totalRevenue').textContent = '₱' + (data.revenue || 0).toLocaleString();
        document.getElementById('occupancy').textContent = data.occupancy;
        document.getElementById('pendingCount').textContent = data.pending;
        document.getElementById('openIssues').textContent = data.issues;
    } catch (err) {
        console.error('Error loading stats:', err);
    }
}
