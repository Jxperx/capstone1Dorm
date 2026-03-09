// --- Navigation Functions ---
function showSection(sectionId, linkElement) {
    // Hide all sections
    document.querySelectorAll('.content-section').forEach(section => {
        section.classList.remove('active');
    });
    
    // Show target section
    document.getElementById('section-' + sectionId).classList.add('active');
    
    // Update sidebar active state
    document.querySelectorAll('.list-group-item-action').forEach(item => {
        item.classList.remove('active');
    });
    if (linkElement) {
        linkElement.classList.add('active');
    }

    // Update Page Title
    const titles = {
        'dashboard': 'Dashboard Overview',
        'rooms': 'Room & Unit Management',
        'tenants': 'Tenant Management',
        'payments': 'Payment Management',
        'maintenance': 'Maintenance Requests',
        'media': 'Condo and Dorm Media'
    };
    document.getElementById('pageTitle').innerText = titles[sectionId] || 'Dashboard';
}

function viewProof(url) {
    if (!url || url === 'null' || url === 'undefined') {
        alert('No proof image available');
        return;
    }
    document.getElementById('proofImage').src = url;
    new bootstrap.Modal(document.getElementById('proofModal')).show();
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // Sidebar Toggle
    const sidebarToggle = document.getElementById('sidebarToggle');
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', event => {
            event.preventDefault();
            document.body.classList.toggle('sb-sidenav-toggled');
        });
    }

    // Load all data
    if(typeof loadStats === 'function') loadStats();
    if(typeof loadRooms === 'function') loadRooms();
    // loadCondos is handled by loadRooms
    if(typeof loadPayments === 'function') loadPayments();
    if(typeof loadMaintenance === 'function') loadMaintenance();
    if(typeof loadTenants === 'function') loadTenants();
    if(typeof loadMeterReadings === 'function') loadMeterReadings();
    if(typeof loadTenantsForCalc === 'function') loadTenantsForCalc();
});
