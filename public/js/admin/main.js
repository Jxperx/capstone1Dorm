// --- Navigation Functions ---
function showSection(sectionId, linkElement) {
    // If tenants is requested, redirect to unified rooms section
    if (sectionId === 'tenants') {
        sectionId = 'rooms';
    }

    // Hide all sections
    document.querySelectorAll('.content-section').forEach(section => {
        section.classList.remove('active');
    });
    
    // Show target section
    const targetSection = document.getElementById('section-' + sectionId);
    if (!targetSection) return; // Guard: section doesn't exist (e.g. modal-only links)
    targetSection.classList.add('active');
    
    // Update sidebar active state
    document.querySelectorAll('.list-group-item-action').forEach(item => {
        const onclickAttr = item.getAttribute('onclick') || '';
        if (onclickAttr.includes(`'${sectionId}'`)) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    // Scroll main content container to top on section switch
    const contentWrapper = document.getElementById('page-content-wrapper');
    if (contentWrapper) {
        contentWrapper.scrollTop = 0;
    }

    // Update URL hash for deep linking
    if (window.location.hash !== '#' + sectionId) {
        history.replaceState(null, null, '#' + sectionId);
    }

    // Update Page Title
    const titles = {
        'dashboard': 'Dashboard Overview',
        'rooms': 'Room & Unit Management',
        'tenants': 'Room & Unit Management',
        'payments': 'Payment Management',
        'maintenance': 'Maintenance Requests',
        'media': 'Condo and Dorm Media',
        'feedback': 'Tenant Feedback & AI Insights',
        'fraud': 'Intelligent Fraud Detection',
        'inquiries': 'Inquiry Management',
        'rent-optimization': 'AI Rent Optimization',
        'reports': 'Reports & Analytics',
        'live-chat': 'Live Admin Chat'
    };
    const titleEl = document.getElementById('pageTitle');
    if (titleEl) titleEl.innerText = titles[sectionId] || 'Dashboard';

    if (sectionId === 'rooms' && typeof loadRooms === 'function') {
        loadRooms();
    }
    if (sectionId === 'media' && typeof loadPropertyMediaAdmin === 'function') {
        loadPropertyMediaAdmin();
    }
    if (sectionId === 'feedback' && typeof loadAdminFeedback === 'function') {
        loadAdminFeedback();
    }
    if (sectionId === 'fraud' && typeof initFraudSection === 'function') {
        initFraudSection();
    }
    if (sectionId === 'inquiries' && typeof initInquirySection === 'function') {
        initInquirySection();
    }
    if (sectionId === 'rent-optimization' && typeof RentPricingModule !== 'undefined' && typeof RentPricingModule.init === 'function') {
        RentPricingModule.init();
    }
    if (sectionId === 'reports' && typeof ReportModule !== 'undefined' && typeof ReportModule.init === 'function') {
        ReportModule.init();
    }
    if (sectionId === 'live-chat' && typeof LiveChatAdmin !== 'undefined' && typeof LiveChatAdmin.init === 'function') {
        LiveChatAdmin.init();
    }

    // Auto-close sidebar on mobile/tablet devices after selecting a section
    if (window.innerWidth < 768) {
        document.body.classList.remove('sb-sidenav-toggled');
    }
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

    // Sidebar Overlay Click (Tap outside sidebar to close on mobile)
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', () => {
            document.body.classList.remove('sb-sidenav-toggled');
        });
    }

    // Deep link hash navigation support
    const handleHashNav = () => {
        const hash = window.location.hash.replace('#', '');
        if (hash) {
            showSection(hash);
        }
    };

    window.addEventListener('hashchange', handleHashNav);
    if (window.location.hash) {
        handleHashNav();
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
    if(typeof loadAdminFeedback === 'function') loadAdminFeedback();
    if(typeof loadPropertyMediaAdmin === 'function') loadPropertyMediaAdmin();
});

