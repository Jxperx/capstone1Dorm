async function loadDashboardData() {
    try {
        const res = await fetch('/api/profile/me');
        if (!res.ok) throw new Error('Failed to load profile');
        const data = await res.json();

        // 1. Update Personal Info
        const firstName = data.full_name ? data.full_name.split(' ')[0] : 'Tenant';
        document.getElementById('welcomeName').textContent = `Hey, ${firstName}! 👋`;
        document.getElementById('sidebarName').textContent = data.full_name || 'Tenant';
        
        // Update Dynamic Daily Rent Due Date & Countdown Badge
        updateDynamicRentDueDate(data);

        // 2. Update Room Info
        if (data.room_number) {
            const roomType = (data.room_type || 'dorm').toUpperCase();
            const roomDetails = `${data.capacity || 0} Bed ${roomType === 'CONDO' ? 'Unit' : 'Dormitory'} • AC • WiFi`;
            
            document.getElementById('sidebarRoom').textContent = `${roomType === 'CONDO' ? 'Unit' : 'Room'} ${data.room_number}`;
            document.getElementById('cardRoomNumber').textContent = `${roomType === 'CONDO' ? 'Unit' : 'Room'} ${data.room_number}`;
            document.getElementById('cardRoomType').textContent = roomType;
            document.getElementById('cardRoomType').className = `badge ${roomType === 'CONDO' ? 'bg-info' : 'bg-primary'}`;
            document.getElementById('cardRoomDetails').textContent = roomDetails;

            const rent = data.monthly_rate ? parseFloat(data.monthly_rate) : 0;
            const rentFormatted = rent % 1 === 0 ? rent.toString() : rent.toFixed(2);

            const currentBillAmountElement = document.getElementById('currentBillAmount');
            if (currentBillAmountElement) {
                currentBillAmountElement.textContent = `₱${rentFormatted}`;
            }

            const paymentAmountInput = document.getElementById('paymentAmount');
            if (paymentAmountInput) {
                paymentAmountInput.value = rent.toFixed(2);
            }

            const gcashPaymentAmount = document.getElementById('payment-amount');
            if (gcashPaymentAmount) {
                gcashPaymentAmount.value = rent.toFixed(2);
            }

            const gcashPaymentDesc = document.getElementById('payment-description');
            if (gcashPaymentDesc) {
                gcashPaymentDesc.value = `Monthly Rent for ${roomType === 'CONDO' ? 'Unit' : 'Room'} ${data.room_number}`;
            }

        } else {
            document.getElementById('sidebarRoom').textContent = 'No Room Assigned';
            document.getElementById('cardRoomNumber').textContent = 'No Room Assigned';
            
            const currentBillAmountElement = document.getElementById('currentBillAmount');
            if (currentBillAmountElement) {
                currentBillAmountElement.textContent = `₱0.00`;
            }
        }

        // 3. Update Profile Image
        if (data.profile_image_url) {
            const sidebarImg = document.querySelector('.sidebar .profile-img');
            const mobileImg = document.querySelector('.dropdown img'); // Mobile header
            if (sidebarImg) sidebarImg.src = data.profile_image_url;
            if (mobileImg) mobileImg.src = data.profile_image_url;
        }

        // 4. Load Recent Activity
        loadRecentActivity();

    } catch (err) {
        console.error('Error loading dashboard data:', err);
    }
}

async function loadRecentActivity() {
    try {
        const res = await fetch('/api/profile/recent-activity');
        if (!res.ok) throw new Error('Failed to load recent activity');
        const activities = await res.json();
        
        const tbody = document.getElementById('recentActivityBody');
        if (!tbody) return;

        tbody.innerHTML = '';
        
        if (activities.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4">No recent activity found.</td></tr>';
            return;
        }

        activities.forEach(item => {
            const date = new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
            
            let iconClass, iconColor, title, subtext, amountStr;
            
            if (item.type === 'payment') {
                iconClass = 'fas fa-home';
                iconColor = 'text-primary';
                title = item.title;
                subtext = 'Payment Submitted';
                amountStr = item.amount ? `₱${parseFloat(item.amount).toFixed(2)}` : '₱0.00';
            } else {
                iconClass = 'fas fa-tools';
                iconColor = 'text-warning';
                title = item.title || 'Maintenance Request';
                subtext = 'Maintenance Report';
                amountStr = '—';
            }

            let statusClass;
            const status = (item.status || 'pending').toLowerCase();
            if (status === 'approved' || status === 'paid' || status === 'resolved') {
                statusClass = 'status-paid';
            } else if (status === 'pending') {
                statusClass = 'status-pending';
            } else {
                statusClass = 'status-failed';
            }

            tbody.innerHTML += `
                <tr>
                    <td>${date}</td>
                    <td>
                        <div class="d-flex align-items-center">
                            <div class="bg-light rounded p-2 me-2"><i class="${iconClass} ${iconColor}"></i></div>
                            <div>
                                <div class="fw-bold">${title}</div>
                                <div class="small text-muted">${subtext}</div>
                            </div>
                        </div>
                    </td>
                    <td><span class="status-badge ${statusClass}">${status.toUpperCase()}</span></td>
                    <td class="fw-bold">${amountStr}</td>
                </tr>
            `;
        });
    } catch (err) {
        console.error('Error loading recent activity:', err);
    }
}

// ---------------------------------------------------------------
//  Dynamic Daily Rent Due Date & Reminders Calculation
// ---------------------------------------------------------------
function updateDynamicRentDueDate(data) {
    const rentDueMonth = document.getElementById('rentDueMonth');
    const rentDueBadge = document.getElementById('rentDueBadge');

    if (!rentDueBadge) return;

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonthIndex = now.getMonth();
    const currentMonthName = now.toLocaleDateString('en-US', { month: 'long' });

    // Determine due day of month (default to 5th or tenant lease day)
    let dueDay = 5;
    if (data.lease_start_date) {
        const leaseDate = new Date(data.lease_start_date);
        if (!isNaN(leaseDate.getTime())) {
            dueDay = leaseDate.getDate();
        }
    }

    // Check if tenant has an approved payment in current month
    let paidForCurrentMonth = false;
    if (data.last_payment_date) {
        const lastPayment = new Date(data.last_payment_date);
        if (!isNaN(lastPayment.getTime())) {
            if (lastPayment.getMonth() === currentMonthIndex && lastPayment.getFullYear() === currentYear) {
                paidForCurrentMonth = true;
            }
        }
    }

    if (paidForCurrentMonth) {
        if (rentDueMonth) rentDueMonth.textContent = currentMonthName;
        rentDueBadge.className = 'badge bg-success text-white rounded-pill ms-1 px-3 py-1';
        rentDueBadge.innerHTML = '<i class="fas fa-check-circle me-1"></i> PAID & UP TO DATE';
        return;
    }

    // Calculate exact difference in days for current month's due date
    const todayMidnight = new Date(currentYear, currentMonthIndex, now.getDate());
    const dueMidnight = new Date(currentYear, currentMonthIndex, dueDay);
    
    const diffTime = dueMidnight.getTime() - todayMidnight.getTime();
    const diffDays = Math.round(diffTime / (1000 * 3600 * 24));

    if (rentDueMonth) rentDueMonth.textContent = currentMonthName;

    if (diffDays > 0) {
        rentDueBadge.className = 'badge bg-warning text-dark rounded-pill ms-1 px-3 py-1';
        rentDueBadge.textContent = `due in ${diffDays} day${diffDays === 1 ? '' : 's'}`;
    } else if (diffDays === 0) {
        rentDueBadge.className = 'badge bg-danger text-white rounded-pill ms-1 px-3 py-1';
        rentDueBadge.textContent = 'DUE TODAY';
    } else {
        const overdueDays = Math.abs(diffDays);
        rentDueBadge.className = 'badge bg-danger text-white rounded-pill ms-1 px-3 py-1';
        rentDueBadge.textContent = `OVERDUE by ${overdueDays} day${overdueDays === 1 ? '' : 's'}`;
    }
}

