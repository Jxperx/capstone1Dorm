// Predictive Vacancy Analytics Module

async function loadVacancyPrediction() {
    try {
        const response = await fetch('/api/admin/stats/vacancy-prediction');
        if (!response.ok) throw new Error('Failed to fetch vacancy prediction');
        
        const result = await response.json();
        const data = result.data;
        const ai = result.prediction;

        // Update quantitative raw data
        document.getElementById('exp30Count').textContent = data.expiring30;
        document.getElementById('exp60Count').textContent = data.expiring60;
        document.getElementById('recentInquiryCount').textContent = data.inquiryCount;

        // Update expiring tenants list with detailed cards in a larger grid
        const namesList = document.getElementById('expiringNamesList');
        const totalCountEl = document.getElementById('expTotalCount');
        
        if (totalCountEl) totalCountEl.textContent = data.expiringTenants ? data.expiringTenants.length : 0;

        if (data.expiringTenants && data.expiringTenants.length > 0) {
            namesList.innerHTML = data.expiringTenants.map(t => {
                const endObj = new Date(t.lease_end_date);
                const endDateStr = endObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                
                const today = new Date();
                const diffTime = endObj.getTime() - today.getTime();
                const diffDays = Math.ceil(diffTime / (1000 * 3600 * 24));
                
                let countdownBadge = '';
                if (diffDays < 0) {
                    countdownBadge = `<span class="badge bg-danger text-white rounded-pill px-2 py-1 extra-small"><i class="fas fa-exclamation-circle me-1"></i>Expired ${Math.abs(diffDays)}d ago</span>`;
                } else if (diffDays === 0) {
                    countdownBadge = `<span class="badge bg-danger text-white rounded-pill px-2 py-1 extra-small"><i class="fas fa-clock me-1"></i>Expires Today!</span>`;
                } else if (diffDays <= 7) {
                    countdownBadge = `<span class="badge bg-danger text-white rounded-pill px-2 py-1 extra-small"><i class="fas fa-exclamation-triangle me-1"></i>Due in ${diffDays}d</span>`;
                } else {
                    countdownBadge = `<span class="badge bg-warning text-dark rounded-pill px-2 py-1 extra-small"><i class="fas fa-clock me-1"></i>${diffDays}d left</span>`;
                }

                window[`tenant_moveout_${t.id}`] = t;

                return `
                    <div class="col-md-4 col-lg-3">
                        <div class="card h-100 border-0 shadow-sm rounded-4" style="background: #fff; border-top: 4px solid #dc3545 !important;">
                            <div class="card-body p-3 d-flex flex-column justify-content-between">
                                <div>
                                    <div class="d-flex justify-content-between align-items-center mb-2">
                                        <div class="d-flex align-items-center">
                                            <div class="rounded-circle bg-danger-subtle p-2 me-2" style="width: 32px; height: 32px; display: grid; place-items: center;">
                                                <i class="fas fa-user text-danger extra-small"></i>
                                            </div>
                                            <div class="fw-bold text-dark text-truncate" style="font-size: 0.9rem; max-width: 110px;">${t.full_name}</div>
                                        </div>
                                        ${countdownBadge}
                                    </div>
                                    <div class="mb-3 bg-light p-2 rounded-3">
                                        <div class="small text-muted mb-1"><i class="fas fa-door-open me-2 text-primary"></i>Unit: <span class="text-dark fw-bold">${t.room_number || 'N/A'}</span></div>
                                        <div class="small text-muted"><i class="fas fa-calendar-alt me-2 text-danger"></i>Ends: <span class="text-danger fw-bold">${endDateStr}</span></div>
                                    </div>
                                </div>

                                <div>
                                    <div class="d-grid gap-1 mb-2">
                                        <button type="button" class="btn btn-sm btn-warning text-dark fw-bold rounded-pill" onclick="openRenewLeaseModal(${t.id})">
                                            <i class="fas fa-file-signature me-1"></i> Renew Lease
                                        </button>
                                        <div class="btn-group w-100">
                                            <button type="button" class="btn btn-sm btn-outline-primary rounded-start-pill w-100" onclick="sendLeaseReminder(${t.id}, this)">
                                                <i class="fas fa-paper-plane me-1"></i> Remind
                                            </button>
                                            <button type="button" class="btn btn-sm btn-outline-secondary dropdown-toggle dropdown-toggle-split rounded-end-pill" data-bs-toggle="dropdown" aria-expanded="false">
                                                <span class="visually-hidden">Toggle Actions</span>
                                            </button>
                                            <ul class="dropdown-menu dropdown-menu-end shadow border-0 rounded-3 small">
                                                <li><a class="dropdown-item text-warning fw-semibold" href="#" onclick="endMoveoutLease(${t.id}, '${t.full_name}')"><i class="fas fa-user-slash me-2"></i>End Lease (Vacate Unit)</a></li>
                                                <li><hr class="dropdown-divider"></li>
                                                <li><a class="dropdown-item text-danger fw-semibold" href="#" onclick="deleteMoveoutAccount(${t.id}, '${t.full_name}')"><i class="fas fa-user-minus me-2"></i>Delete Account</a></li>
                                            </ul>
                                        </div>
                                    </div>
                                    <div class="d-flex justify-content-between align-items-center border-top pt-2 px-1">
                                        <a href="mailto:${t.email}" class="text-muted extra-small text-decoration-none"><i class="fas fa-envelope me-1"></i>Email</a>
                                        <a href="tel:${t.phone_number}" class="text-muted extra-small text-decoration-none"><i class="fas fa-phone me-1"></i>${t.phone_number || 'Call'}</a>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            namesList.innerHTML = '<div class="col-12 text-center py-5 text-muted"><i class="fas fa-calendar-check fs-1 mb-3"></i><br>No upcoming move-outs in the next 30 days.</div>';
        }

        // Update AI Qualitative Insights
        const badge = document.getElementById('vacancyRiskBadge');
        badge.textContent = `Risk: ${ai.riskLevel}`;
        
        // Color code the badge based on risk
        badge.classList.remove('bg-secondary', 'bg-success', 'bg-warning', 'bg-danger');
        if (ai.riskLevel === 'Low') badge.classList.add('bg-success');
        else if (ai.riskLevel === 'Medium') badge.classList.add('bg-warning', 'text-dark');
        else badge.classList.add('bg-danger');

        document.getElementById('vacancySummary').textContent = ai.summary;

        // Update recommendations list
        const recContainer = document.getElementById('vacancyRecommendations');
        recContainer.innerHTML = ''; // Clear loading state
        
        ai.recommendations.forEach(rec => {
            const li = document.createElement('li');
            li.className = 'list-group-item border-0 text-muted px-0 py-2 d-flex align-items-start';
            li.innerHTML = `<i class="fas fa-check-circle text-success mt-1 me-2"></i> <span>${rec}</span>`;
            recContainer.appendChild(li);
        });

    } catch (error) {
        console.error('Error loading vacancy prediction:', error);
        document.getElementById('vacancySummary').textContent = 'Unable to generate predictive analytics at this time. Please try again later.';
        document.getElementById('vacancyRecommendations').innerHTML = '<li class="list-group-item border-0 text-danger"><i class="fas fa-exclamation-triangle me-2"></i>Error loading recommendations</li>';
        document.getElementById('vacancyRiskBadge').textContent = 'Error';
        document.getElementById('vacancyRiskBadge').classList.replace('bg-secondary', 'bg-danger');
    }
}

function openRenewLeaseModal(tenantId) {
    const t = window[`tenant_moveout_${tenantId}`];
    if (!t) return;

    document.getElementById('renewTenantId').value = t.id;
    document.getElementById('renewTenantName').textContent = t.full_name;
    document.getElementById('renewTenantRoom').textContent = t.room_number || 'N/A';
    document.getElementById('renewCurrentEnd').textContent = t.lease_end_date ? new Date(t.lease_end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A';
    
    // Set default extension to +6 months
    setQuickExtension(6);

    const modalEl = document.getElementById('renewLeaseModal');
    if (modalEl) {
        const modal = new bootstrap.Modal(modalEl);
        modal.show();
    }
}

function setQuickExtension(months) {
    const currentEndStr = document.getElementById('renewCurrentEnd')?.textContent;
    let baseDate = new Date();
    if (currentEndStr && currentEndStr !== 'N/A') {
        const parsed = new Date(currentEndStr);
        if (!isNaN(parsed.getTime()) && parsed > baseDate) baseDate = parsed;
    }
    baseDate.setMonth(baseDate.getMonth() + months);
    document.getElementById('renewNewEndDate').value = baseDate.toISOString().split('T')[0];
}

async function submitLeaseRenewal() {
    const tenantId = document.getElementById('renewTenantId').value;
    const newEndDate = document.getElementById('renewNewEndDate').value;

    if (!tenantId || !newEndDate) {
        alert('Please select a valid new lease expiration date.');
        return;
    }

    try {
        const res = await fetch(`/api/admin/tenants/${tenantId}/renew-lease`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ new_end_date: newEndDate })
        });
        
        const data = await res.json();
        if (res.ok) {
            alert('✅ Lease extended successfully!');
            const modalEl = document.getElementById('renewLeaseModal');
            if (modalEl) {
                const modal = bootstrap.Modal.getInstance(modalEl);
                if (modal) modal.hide();
            }
            loadVacancyPrediction();
        } else {
            alert(data.error || 'Failed to extend lease.');
        }
    } catch (err) {
        console.error('[Lease Renewal Error]:', err);
        alert('Error renewing lease. Please try again.');
    }
}

async function sendLeaseReminder(tenantId, btnEl) {
    if (!tenantId) return;
    
    const originalText = btnEl ? btnEl.innerHTML : '';
    if (btnEl) {
        btnEl.disabled = true;
        btnEl.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Sending...';
    }

    try {
        const res = await fetch(`/api/admin/tenants/${tenantId}/send-lease-reminder`, {
            method: 'POST'
        });
        const data = await res.json();
        if (res.ok) {
            if (btnEl) {
                btnEl.className = 'btn btn-sm btn-success rounded-pill';
                btnEl.innerHTML = '<i class="fas fa-check me-1"></i> Reminder Sent';
            }
        } else {
            alert(data.error || 'Failed to send reminder.');
            if (btnEl) {
                btnEl.disabled = false;
                btnEl.innerHTML = originalText;
            }
        }
    } catch (err) {
        console.error('[Send Reminder Error]:', err);
        alert('Error sending reminder.');
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.innerHTML = originalText;
        }
    }
}

async function endMoveoutLease(tenantId, tenantName) {
    if (!confirm(`End lease for ${tenantName}? This will set their status to "past" and free up their unit for new tenants.`)) return;

    try {
        const res = await fetch(`/api/admin/tenants/${tenantId}/end-lease`, {
            method: 'POST'
        });
        const data = await res.json();
        if (res.ok) {
            alert(`✅ Lease ended for ${tenantName}. Unit is now available.`);
            loadVacancyPrediction();
            if (typeof loadTenants === 'function') loadTenants();
        } else {
            alert(data.error || 'Failed to end lease.');
        }
    } catch (err) {
        console.error('[End Lease Error]:', err);
        alert('Error ending tenant lease.');
    }
}

async function deleteMoveoutAccount(tenantId, tenantName) {
    if (!confirm(`⚠️ PERMANENT DELETE WARNING:\nAre you sure you want to delete ${tenantName}'s account? This action cannot be undone.`)) return;

    try {
        const res = await fetch(`/api/admin/tenants/${tenantId}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        if (res.ok) {
            alert(`✅ Account deleted for ${tenantName}.`);
            loadVacancyPrediction();
            if (typeof loadTenants === 'function') loadTenants();
        } else {
            alert(data.error || 'Failed to delete account.');
        }
    } catch (err) {
        console.error('[Delete Account Error]:', err);
        alert('Error deleting tenant account.');
    }
}

window.openRenewLeaseModal = openRenewLeaseModal;
window.setQuickExtension = setQuickExtension;
window.submitLeaseRenewal = submitLeaseRenewal;
window.sendLeaseReminder = sendLeaseReminder;
window.endMoveoutLease = endMoveoutLease;
window.deleteMoveoutAccount = deleteMoveoutAccount;

// Automatically load when the DOM is ready and we're on the dashboard overview section
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('vacancySummary')) {
        loadVacancyPrediction();
    }
});


