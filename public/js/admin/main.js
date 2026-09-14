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
    
    // Auto-close sidebar on mobile devices upon selecting a section
    if (window.innerWidth < 768) {
        document.body.classList.remove('sb-sidenav-toggled');
    }

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
    if (sectionId === 'maintenance' && typeof loadMaintenance === 'function') {
        loadMaintenance();
    }
    if (sectionId === 'media') {
        showSection('reports');
        if (typeof ReportModule !== 'undefined' && typeof ReportModule.switchTab === 'function') {
            ReportModule.switchTab('media');
        }
        return;
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
function initAdminMain() {
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
    if(typeof loadTopNavProfile === 'function') loadTopNavProfile();

    // Real-time updates via Socket.IO
    initAdminRealtime();
}

// --- Real-time Socket Setup ---
function initAdminRealtime() {
    if (typeof io === 'undefined') {
        console.warn('[Admin Socket] Socket.io not loaded.');
        return;
    }

    if (!window.adminSocket) {
        window.adminSocket = io();
    }
    const socket = window.adminSocket;

    socket.emit('admin:join');

    const notify = (msg, type = 'info') => {
        if (typeof window.showEnterpriseToast === 'function') {
            window.showEnterpriseToast(msg, type);
        } else {
            console.log(`[Admin Realtime ${type}]: ${msg}`);
        }
    };

    // 1. Inquiry Created
    socket.on('inquiry:created', (data) => {
        const name = data && data.name ? data.name : 'A visitor';
        notify(`📩 New inquiry received from <strong>${name}</strong>!`, 'info');
        if (typeof loadInquiries === 'function') loadInquiries(1);
        if (typeof loadInquiryAnalytics === 'function') loadInquiryAnalytics();
        if (typeof loadStats === 'function') loadStats();
    });

    // 2. Site Visit Created / Status Changed
    socket.on('visit:created', (data) => {
        const name = data && data.name ? data.name : 'A visitor';
        const room = data && data.room_number ? ` for Room ${data.room_number}` : '';
        notify(`📅 New site visit booked by <strong>${name}</strong>${room}!`, 'info');
        if (typeof loadStats === 'function') loadStats();
    });
    socket.on('visit:status_changed', () => {
        if (typeof loadStats === 'function') loadStats();
    });

    // 3. Maintenance Ticket Created / Status Changed
    socket.on('maintenance:created', (data) => {
        const title = data && data.title ? `: "${data.title}"` : '';
        notify(`🔧 New maintenance request submitted${title}`, 'warning');
        if (typeof loadMaintenance === 'function') loadMaintenance();
        if (typeof loadStats === 'function') loadStats();
    });
    socket.on('maintenance:status_changed', () => {
        if (typeof loadMaintenance === 'function') loadMaintenance();
        if (typeof loadStats === 'function') loadStats();
    });

    // 4. Payment Submitted / Status Changed
    socket.on('payment:submitted', (data) => {
        const amount = data && data.amount ? ` (₱${Number(data.amount).toLocaleString()})` : '';
        notify(`💰 New payment submitted${amount}. Awaiting review.`, 'success');
        if (typeof loadPayments === 'function') loadPayments();
        if (typeof loadStats === 'function') loadStats();
    });
    socket.on('payment:status_changed', () => {
        if (typeof loadPayments === 'function') loadPayments();
        if (typeof loadStats === 'function') loadStats();
    });

    // 5. Room Changed
    socket.on('room:changed', () => {
        if (typeof loadRooms === 'function') loadRooms();
        if (typeof loadStats === 'function') loadStats();
    });

    // 6. Tenant Changed
    socket.on('tenant:changed', () => {
        if (typeof loadTenants === 'function') loadTenants();
        if (typeof loadTenantsForCalc === 'function') loadTenantsForCalc();
        if (typeof loadStats === 'function') loadStats();
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAdminMain);
} else {
    initAdminMain();
}

