function switchTab(tabId) {
    // Hide all contents with fade out
    ['water', 'elec', 'submit'].forEach(id => {
        const content = document.getElementById(`content-${id}`);
        const tab = document.getElementById(`tab-${id}`);
        
        content.classList.add('d-none');
        content.classList.remove('fade-in'); // Reset animation
        
        // Reset tab styles
        tab.classList.remove('active', 'bg-white', 'shadow-sm', 'text-primary', 'text-warning', 'text-success');
        tab.classList.add('text-muted');
        
        // Reset icon containers
        const iconContainer = tab.querySelector('.rounded-circle');
        if(iconContainer) {
            iconContainer.classList.remove('bg-primary', 'bg-warning', 'text-white');
            iconContainer.classList.add('bg-white');
        }
    });

    // Show selected content
    const activeContent = document.getElementById(`content-${tabId}`);
    activeContent.classList.remove('d-none');
    setTimeout(() => activeContent.classList.add('fade-in'), 10); // Trigger animation

    // Activate tab
    const activeTab = document.getElementById(`tab-${tabId}`);
    activeTab.classList.add('active', 'bg-white', 'shadow-sm');
    activeTab.classList.remove('text-muted');

    // Colorize active tab icon
    const activeIconContainer = activeTab.querySelector('.rounded-circle');
    if(activeIconContainer) {
        activeIconContainer.classList.remove('bg-white');
        if (tabId === 'water') activeIconContainer.classList.add('bg-primary', 'text-white');
        if (tabId === 'elec') activeIconContainer.classList.add('bg-warning', 'text-white');
        if (tabId === 'submit') activeIconContainer.classList.add('bg-success', 'text-white');
    }
}

// Call on load
document.addEventListener('DOMContentLoaded', () => {
    if(typeof loadLatestReadings === 'function') loadLatestReadings();
    if(typeof loadDashboardData === 'function') loadDashboardData();
    // loadAvailableRooms is usually called when modal opens, but we can init if needed
    // In original code, it was just defined.
});
