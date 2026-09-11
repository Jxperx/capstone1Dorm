// --- 1. Load Stats ---
async function loadStats() {
    try {
        const res = await fetch('/api/admin/stats', { credentials: 'include' });
        const data = await res.json();
        
        document.getElementById('totalRevenue').textContent = '₱' + (data.revenue || 0).toLocaleString();
        document.getElementById('occupancy').textContent = data.occupancy;
        document.getElementById('pendingCount').textContent = data.pending;
        document.getElementById('openIssues').textContent = data.issues;

        // Dynamic update for Sidebar Occupancy Card
        if (data.occupancy && typeof data.occupancy === 'string' && data.occupancy.includes('/')) {
            const parts = data.occupancy.split('/');
            const occupied = parseInt(parts[0], 10) || 0;
            const total = parseInt(parts[1], 10) || 0;
            const pct = total > 0 ? Math.round((occupied / total) * 100) : 0;
            
            const rateEl = document.getElementById('sidebarOccupancyRate');
            const ratioEl = document.getElementById('sidebarOccupancyRatio');
            const barEl = document.getElementById('sidebarOccupancyBar');
            if (rateEl) rateEl.textContent = pct + '%';
            if (ratioEl) ratioEl.textContent = occupied + ' of ' + total + ' Occupied';
            if (barEl) barEl.style.width = pct + '%';
        }

        // Dynamic update for Sidebar Maintenance Badge
        if (data.issues !== undefined) {
            const maintBadge = document.getElementById('sidebarMaintenanceBadge');
            if (maintBadge) {
                if (data.issues > 0) {
                    maintBadge.textContent = data.issues + ' Active';
                    maintBadge.style.display = 'inline-block';
                } else {
                    maintBadge.style.display = 'none';
                }
            }
        }
    } catch (err) {
        console.error('Error loading stats:', err);
    }
}
