/**
 * public/js/admin/modules/rentPricing.js
 * ─────────────────────────────────────────────────────────────────────────────
 * AI Rent Optimization & Deep Market Search Module:
 *   - Auto-applied & suggested room rates based on market benchmarks
 *   - On-demand "Search Market Now" manual search trigger
 *   - Market Evidence competitor listings table with Admin Verification toggles
 *   - Detailed AI reasoning breakdown
 */

const RentPricingModule = {
    searching: false,

    init: async function () {
        console.log('[RentPricingModule] Initializing...');
        this.container = document.getElementById('rentPricingContainer');
        this.attachActionButtons();
        await Promise.all([
            this.loadScheduleInfo(),
            this.loadSuggestions(),
            this.loadMarketEvidence()
        ]);
    },

    // ── Attach Header Action Controls ─────────────────────────────────────────
    attachActionButtons: function () {
        const headerActions = document.getElementById('rentPricingHeaderActions');
        if (!headerActions) return;

        headerActions.innerHTML = `
            <div class="d-flex align-items-center gap-2 flex-wrap">
                <button id="btnSearchMarketNow" class="btn btn-warning btn-sm fw-bold px-3 shadow-sm" style="border-radius:20px;">
                    <i class="fas fa-search-dollar me-1"></i>Search Market Now
                </button>
                <button class="btn btn-outline-secondary btn-sm rounded-pill px-3" onclick="RentPricingModule.loadHistory()">
                    <i class="fas fa-history me-1"></i>Pricing History
                </button>
            </div>`;

        const btnSearch = document.getElementById('btnSearchMarketNow');
        if (btnSearch) {
            btnSearch.onclick = () => this.triggerMarketSearch();
        }
    },

    // ── Trigger Manual On-Demand Market Search ────────────────────────────────
    triggerMarketSearch: async function () {
        if (this.searching) return;
        this.searching = true;

        const btn = document.getElementById('btnSearchMarketNow');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Searching Market...`;
        }

        this.showToast('🔍 Scanning Calamba & Nuvali market for live rental specs...', 'info');

        try {
            const res  = await fetch('/api/admin/rent-pricing/trigger-search', { method: 'POST' });
            const data = await res.json();

            if (data.success) {
                this.showToast(`✅ Search complete! Found ${data.data.condoListingsCount} condos & ${data.data.dormListingsCount} dorms.`, 'success');
                await Promise.all([
                    this.loadScheduleInfo(),
                    this.loadSuggestions(),
                    this.loadMarketEvidence()
                ]);
            } else {
                this.showToast('❌ Search failed: ' + (data.error || 'Unknown error'), 'danger');
            }
        } catch (err) {
            console.error('[RentPricingModule] Trigger search error:', err);
            this.showToast('❌ Failed to run market search.', 'danger');
        } finally {
            this.searching = false;
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<i class="fas fa-search-dollar me-1"></i>Search Market Now`;
            }
        }
    },

    // ── Load schedule metadata (last / next run) ──────────────────────────────
    loadScheduleInfo: async function () {
        try {
            const res  = await fetch('/api/admin/rent-pricing/schedule-info');
            const data = await res.json();

            const lastEl = document.getElementById('lastAutoUpdate');
            const nextEl = document.getElementById('nextAutoUpdate');
            const badge  = document.getElementById('marketPulseBadge');

            if (lastEl) {
                const lastDate = new Date(data.lastRun);
                lastEl.textContent = lastDate.toLocaleString('en-PH', { month: 'long', year: 'numeric' });
            }
            if (nextEl) {
                const nextDate = new Date(data.nextRun);
                nextEl.textContent = nextDate.toLocaleString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' }) + ' · 2:00 AM';
            }
            if (badge) {
                const mktRes  = await fetch('/api/admin/rent-pricing/market-data');
                const mktData = await mktRes.json();
                if (mktData.listings && mktData.listings.length > 0) {
                    const updated = new Date(mktData.lastUpdated);
                    badge.textContent = `Scanned · ${updated.toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}`;
                    badge.className   = 'badge bg-light text-success border ms-2 small fw-normal';
                } else {
                    badge.textContent = 'Awaiting Next Scan';
                    badge.className   = 'badge bg-light text-muted border ms-2 small fw-normal';
                }
            }
        } catch (err) {
            console.warn('[RentPricingModule] Schedule info error:', err);
        }
    },

    // ── Load AI suggestions (auto-applied & suggested results) ────────────────
    loadSuggestions: async function () {
        if (!this.container) return;

        this.container.innerHTML = `
            <div class="col-12 text-center py-5">
                <div class="spinner-border text-warning" role="status"><span class="visually-hidden">Loading...</span></div>
                <p class="mt-3 text-muted small">AI is analyzing live market data for Calamba &amp; Nuvali...</p>
            </div>`;

        try {
            const res         = await fetch('/api/admin/rent-pricing/suggestions');
            const suggestions = await res.json();
            if (suggestions.error) throw new Error(suggestions.error);
            this.renderSuggestions(suggestions);
        } catch (err) {
            console.error('[RentPricingModule] Load error:', err);
            this.container.innerHTML = `
                <div class="col-12 text-center text-danger py-4">
                    <i class="fas fa-exclamation-circle me-2"></i>Failed to load AI recommendations.
                </div>`;
        }
    },

    // ── Render suggestion cards ───────────────────────────────────────────────
    renderSuggestions: function (suggestions) {
        if (!suggestions.length) {
            this.container.innerHTML = `
                <div class="col-12 text-center py-5 text-muted">
                    <i class="fas fa-check-circle text-success fs-1 mb-3"></i><br>
                    All room prices are currently optimized by AI.
                </div>`;
            return;
        }

        const lastUpdated = suggestions[0]?.lastUpdated
            ? new Date(suggestions[0].lastUpdated).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
            : null;

        this.container.innerHTML = suggestions.map(s => {
            const isUrgent      = s.action !== 'STAY' && s.confidence > 70;
            const priorityLabel = isUrgent ? 'HIGH PRIORITY' : 'LOW PRIORITY';
            const priorityClass = isUrgent ? 'bg-danger-subtle text-danger' : 'bg-light text-muted';
            const borderColor   = s.action === 'INCREASE' ? '#28a745'
                                : s.action === 'DECREASE' ? '#dc3545' : '#6c757d';
            const borderStyle   = `border-left: 5px solid ${borderColor} !important;`;
            const rateChanged   = s.suggestedRate !== s.currentRate;
            const rateArrow     = s.action === 'INCREASE' ? '▲' : s.action === 'DECREASE' ? '▼' : '—';
            const rateColor     = s.action === 'INCREASE' ? 'text-success' : s.action === 'DECREASE' ? 'text-danger' : 'text-muted';
            const marketBadge   = lastUpdated
                ? `<span class="text-muted" style="font-size:0.7rem;"><i class="fas fa-database me-1"></i>Market Data: ${lastUpdated}</span>`
                : `<span class="text-muted" style="font-size:0.7rem;"><i class="fas fa-clock me-1"></i>Market Active</span>`;

            // Specs Label Compiler
            let specLabel = '';
            if (s.unitType === 'condo') {
                const sqmText = s.sqm ? `${s.sqm} sqm` : '';
                const balconyText = s.hasBalcony ? 'Balcony' : 'No Balcony';
                const furnishedText = s.isFullyFurnished ? 'Furnished' : '';
                specLabel = [sqmText, balconyText, furnishedText].filter(Boolean).join(' · ');
            } else {
                const furnishedText = s.isFullyFurnished ? 'Furnished' : '';
                const acText = s.hasAc ? 'AC' : '';
                const wifiText = s.hasWifi ? 'Free WiFi' : '';
                specLabel = [furnishedText, acText, wifiText].filter(Boolean).join(' · ');
            }

            return `
            <div class="col-lg-6 col-xl-4">
                <div class="card h-100 border-0 shadow-sm" style="${borderStyle} border-radius:12px; overflow:hidden;">
                    <div class="card-body p-4 d-flex flex-column">
                        <div class="d-flex justify-content-between align-items-center mb-3">
                            <span class="badge ${priorityClass} fw-bold px-2 py-1" style="font-size:0.65rem;">${priorityLabel}</span>
                            ${marketBadge}
                        </div>

                        <h5 class="fw-bold mb-1">
                            <i class="fas fa-home text-warning me-2"></i>Unit: ${s.roomNumber}
                        </h5>
                        <div class="small text-muted mb-3 fw-semibold" style="font-size:0.75rem; letter-spacing:0.02em;">
                            <i class="fas fa-sliders-h me-1 text-secondary"></i>${specLabel}
                        </div>
                        <p class="small text-muted mb-3">
                            Current Rate: <strong>₱${Number(s.currentRate).toLocaleString()}</strong>
                            <span class="mx-2">|</span>
                            Market Avg: <strong>₱${Number(s.marketAvg).toLocaleString()}</strong>
                        </p>

                        <!-- AI Reasoning Breakdown Box -->
                        <div class="bg-light rounded-3 p-3 mb-3" style="border:1px solid rgba(0,0,0,0.05);">
                            <div class="fw-bold text-uppercase mb-2" style="font-size:0.65rem;color:#666;letter-spacing:0.05em;">AI Pricing Breakdown</div>
                            <p class="small mb-2 text-dark" style="line-height:1.4;">${s.reason}</p>
                            
                            <div class="d-flex justify-content-between align-items-center pt-2 mt-2 border-top" style="font-size:0.72rem; color:#666;">
                                <span><i class="fas fa-users me-1 text-primary"></i>Occupancy: <strong>${s.occupancyPct || 0}%</strong> (${s.occupancy})</span>
                                <span><i class="fas fa-paper-plane me-1 text-info"></i>Inquiries: <strong>${s.inquiriesCount || 0}</strong></span>
                                <span><i class="fas fa-percentage me-1 text-warning"></i>Market Gap: <strong>${s.gapPct || 0}%</strong></span>
                            </div>
                        </div>

                        <div class="d-flex justify-content-between align-items-center mt-auto">
                            <div>
                                <div class="small fw-bold text-uppercase" style="font-size:0.65rem;letter-spacing:0.05em;color:#999;">
                                    ${rateChanged ? '🤖 Recommended Rate' : 'Suggested Rate'}
                                </div>
                                <div class="fs-4 fw-bold ${rateColor}">
                                    ${rateArrow} ₱${Number(s.suggestedRate).toLocaleString()}
                                </div>
                                ${rateChanged ? `<div class="text-muted" style="font-size:0.7rem;">was ₱${Number(s.currentRate).toLocaleString()}</div>` : ''}
                            </div>
                            <button
                                class="btn rounded-pill px-3 fw-bold"
                                style="font-size:0.8rem; background:${s.action === 'STAY' ? '#e9ecef' : '#1a1a2e'}; color:${s.action === 'STAY' ? '#888' : '#f0c040'};"
                                onclick="RentPricingModule.showOverride(${s.roomId}, ${s.currentRate}, '${s.roomNumber}')">
                                ${s.action === 'STAY' ? 'Optimized' : '<i class="fas fa-edit me-1"></i>Override'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>`;
        }).join('');
    },

    // ── Load & Render Competitor Market Evidence ──────────────────────────────
    loadMarketEvidence: async function () {
        let evidenceContainer = document.getElementById('marketEvidenceSection');
        if (!evidenceContainer) {
            evidenceContainer = document.createElement('div');
            evidenceContainer.id = 'marketEvidenceSection';
            evidenceContainer.className = 'col-12 mt-4';
            this.container.parentElement.appendChild(evidenceContainer);
        }

        evidenceContainer.innerHTML = `
            <div class="card border-0 shadow-sm" style="border-radius:12px;">
                <div class="card-body p-4">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <div>
                            <h5 class="fw-bold mb-1"><i class="fas fa-building text-primary me-2"></i>Market Evidence &amp; Competitor Listings</h5>
                            <p class="small text-muted mb-0">Live competitor listings scraped in Calamba &amp; Nuvali used for AI pricing calculations.</p>
                        </div>
                        <button class="btn btn-outline-primary btn-sm rounded-pill px-3" onclick="RentPricingModule.loadMarketEvidence()">
                            <i class="fas fa-sync-alt me-1"></i>Refresh Evidence
                        </button>
                    </div>
                    <div class="table-responsive">
                        <table class="table table-hover align-middle mb-0" style="font-size:0.85rem;">
                            <thead class="table-light">
                                <tr>
                                    <th>Property / Development</th>
                                    <th>Location</th>
                                    <th>Unit Type</th>
                                    <th>Specs &amp; Amenities</th>
                                    <th>Monthly Rate</th>
                                    <th>Admin Verification</th>
                                    <th>Action</th>
                                </tr>
                            </thead>
                            <tbody id="marketEvidenceTbody">
                                <tr><td colspan="7" class="text-center py-4 text-muted"><div class="spinner-border spinner-border-sm me-2"></div>Loading competitor listings...</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>`;

        try {
            const res  = await fetch('/api/admin/rent-pricing/market-data');
            const data = await res.json();
            this.renderMarketEvidenceTable(data.listings || []);
        } catch (err) {
            console.error('[RentPricingModule] Evidence load error:', err);
            const tbody = document.getElementById('marketEvidenceTbody');
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-3">Failed to load competitor listings.</td></tr>`;
            }
        }
    },

    renderMarketEvidenceTable: function (listings) {
        const tbody = document.getElementById('marketEvidenceTbody');
        if (!tbody) return;

        if (!listings.length) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">No competitor market listings recorded. Click "Search Market Now" to scan.</td></tr>`;
            return;
        }

        tbody.innerHTML = listings.map(item => {
            const verifiedState = item.is_verified === 1
                ? `<span class="badge bg-success-subtle text-success border border-success"><i class="fas fa-check-circle me-1"></i>Verified</span>`
                : item.is_verified === -1
                ? `<span class="badge bg-danger-subtle text-danger border border-danger"><i class="fas fa-times-circle me-1"></i>Invalid / Excluded</span>`
                : `<span class="badge bg-warning-subtle text-warning border border-warning"><i class="fas fa-question-circle me-1"></i>Unverified</span>`;

            const sqmTag = (item.sqm_min || item.sqm_max)
                ? `<span class="badge bg-light text-dark border me-1">${item.sqm_min || item.sqm_max} sqm</span>` : '';
            const furnishedTag = item.is_fully_furnished ? `<span class="badge bg-info-subtle text-info border me-1">Furnished</span>` : '';
            const cctvTag = item.has_cctv ? `<span class="badge bg-secondary-subtle text-secondary border me-1">CCTV</span>` : '';
            const fiberTag = item.has_fiber ? `<span class="badge bg-primary-subtle text-primary border me-1">Fiber</span>` : '';

            const urlLower = (item.source_url || '').toLowerCase();
            const nameLower = (item.property_name || '').toLowerCase();

            const isAirbnb = urlLower.includes('airbnb.com') || nameLower.includes('airbnb');
            const isBooking = urlLower.includes('booking.com');
            const isKlook = urlLower.includes('klook.com');

            let badgeHtml = '';
            let linkClass = 'text-primary';
            let siteName = 'Web';

            if (isAirbnb) {
                badgeHtml = `<span class="badge me-1 shadow-sm" style="background:#FF5A5F; color:#fff; font-size:0.65rem;"><i class="fab fa-airbnb me-1"></i>Airbnb</span>`;
                linkClass = 'text-danger';
                siteName = 'Airbnb';
            } else if (isBooking) {
                badgeHtml = `<span class="badge me-1 shadow-sm" style="background:#003580; color:#fff; font-size:0.65rem;"><i class="fas fa-hotel me-1"></i>Booking.com</span>`;
                linkClass = 'text-primary';
                siteName = 'Booking.com';
            } else if (isKlook) {
                badgeHtml = `<span class="badge me-1 shadow-sm" style="background:#FF5B00; color:#fff; font-size:0.65rem;"><i class="fas fa-ticket-alt me-1"></i>Klook</span>`;
                linkClass = 'text-warning';
                siteName = 'Klook';
            }

            let rawUrl = item.source_url && item.source_url.startsWith('http')
                ? item.source_url
                : `https://www.google.com/search?q=${encodeURIComponent(item.property_name + ' ' + (item.location || 'Calamba Laguna') + ' for rent')}`;

            // Clean up old fake room IDs if present
            if (rawUrl.includes('airbnb.com/rooms/101010') || rawUrl.includes('airbnb.com/rooms/12345678')) {
                const isNuvali = (item.location || '').toLowerCase().includes('nuvali');
                rawUrl = isNuvali
                    ? 'https://www.airbnb.com/s/Nuvali--Santa-Rosa--Laguna--Philippines/homes'
                    : 'https://www.airbnb.com/s/Calamba--Laguna--Philippines/homes';
            }

            const sourceDisplay = `<a href="${rawUrl}" target="_blank" rel="noopener noreferrer" class="text-decoration-none fw-bold ${linkClass} text-truncate d-inline-block" style="max-width:200px;" title="View '${this.escapeHtml(item.property_name)}' on ${siteName}">
                ${badgeHtml}${this.escapeHtml(item.property_name)} <i class="fas fa-external-link-alt ms-1" style="font-size:0.7rem;"></i>
            </a>`;

            return `
            <tr>
                <td>
                    ${sourceDisplay}
                    ${item.raw_snippet ? `<div class="text-muted text-truncate" style="font-size:0.75rem; max-width:240px;" title="${this.escapeHtml(item.raw_snippet)}">${this.escapeHtml(item.raw_snippet)}</div>` : ''}
                </td>
                <td><i class="fas fa-map-marker-alt text-danger me-1"></i>${item.location || 'Calamba/Nuvali'}</td>
                <td><span class="badge bg-dark text-capitalize">${item.unit_type || 'N/A'}</span></td>
                <td>${sqmTag}${furnishedTag}${cctvTag}${fiberTag}</td>
                <td class="fw-bold text-success">₱${Number(item.monthly_rate).toLocaleString()}</td>
                <td>${verifiedState}</td>
                <td>
                    <div class="btn-group btn-group-sm">
                        <button class="btn btn-outline-success" title="Mark as Verified" onclick="RentPricingModule.toggleVerify(${item.id}, 1)">
                            <i class="fas fa-check"></i>
                        </button>
                        <button class="btn btn-outline-danger" title="Mark as Invalid" onclick="RentPricingModule.toggleVerify(${item.id}, -1)">
                            <i class="fas fa-times"></i>
                        </button>
                        <button class="btn btn-outline-secondary" title="Reset Verification" onclick="RentPricingModule.toggleVerify(${item.id}, 0)">
                            <i class="fas fa-undo"></i>
                        </button>
                    </div>
                </td>
            </tr>`;
        }).join('');
    },

    // ── Toggle Listing Verification ───────────────────────────────────────────
    toggleVerify: async function (listingId, status) {
        try {
            const res = await fetch(`/api/admin/rent-pricing/competitors/${listingId}/verify`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status })
            });
            const data = await res.json();

            if (data.success) {
                const label = status === 1 ? 'Verified' : status === -1 ? 'Marked Invalid' : 'Reset to Unverified';
                this.showToast(`Listing ${label}`, 'success');
                await Promise.all([
                    this.loadMarketEvidence(),
                    this.loadSuggestions()
                ]);
            } else {
                this.showToast('❌ Verification update failed.', 'danger');
            }
        } catch (err) {
            console.error('[RentPricingModule] Verify toggle error:', err);
            this.showToast('❌ Failed to update verification status.', 'danger');
        }
    },

    // ── Override modal (admin manual price set) ───────────────────────────────
    showOverride: function (roomId, currentRate, roomNumber) {
        const newRate = prompt(`Override AI price for ${roomNumber}?\n\nCurrent rate: ₱${Number(currentRate).toLocaleString()}\n\nEnter new monthly rate (₱):`);
        if (!newRate || isNaN(newRate) || Number(newRate) <= 0) return;
        this.applyOverride(roomId, Number(newRate), `Manual admin override for ${roomNumber}`);
    },

    applyOverride: async function (roomId, newRate, reason) {
        try {
            const res    = await fetch('/api/admin/rent-pricing/apply', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ roomId, newRate, reason })
            });
            const result = await res.json();
            if (result.success) {
                this.showToast(`✅ Override applied: ₱${newRate.toLocaleString()}`, 'success');
                await this.loadSuggestions();
                if (typeof loadRooms === 'function') loadRooms();
            } else {
                this.showToast('❌ Error: ' + result.error, 'danger');
            }
        } catch (err) {
            console.error('[RentPricingModule] Override error:', err);
            this.showToast('❌ Failed to apply override.', 'danger');
        }
    },

    // ── Pricing history modal ─────────────────────────────────────────────────
    loadHistory: async function () {
        let modalEl = document.getElementById('rentHistoryModal');
        if (!modalEl) {
            this.showToast('History modal container not found.', 'danger');
            return;
        }
        const modal = new bootstrap.Modal(modalEl);
        const tbody = document.getElementById('rentHistoryTableBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center py-3"><div class="spinner-border spinner-border-sm text-warning me-2"></div>Loading history...</td></tr>';
        }
        modal.show();

        try {
            const res     = await fetch('/api/admin/rent-pricing/history');
            const history = await res.json();

            if (!history.length) {
                if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-center py-3 text-muted">No pricing changes recorded yet.</td></tr>';
                return;
            }

            if (tbody) {
                tbody.innerHTML = history.map(h => {
                    const isAI       = (h.applied_by || '').includes('AI');
                    const appliedTag = isAI
                        ? `<span class="badge" style="background:#1a1a2e;color:#f0c040;font-size:0.65rem;">🤖 AI</span>`
                        : `<span class="badge bg-secondary" style="font-size:0.65rem;">Admin</span>`;
                    const diff       = h.new_rate - h.old_rate;
                    const diffStr    = diff > 0
                        ? `<span class="text-success">▲ ₱${Math.abs(diff).toLocaleString()}</span>`
                        : diff < 0
                        ? `<span class="text-danger">▼ ₱${Math.abs(diff).toLocaleString()}</span>`
                        : `<span class="text-muted">—</span>`;

                    return `
                    <tr>
                        <td class="small">${new Date(h.created_at).toLocaleDateString('en-PH')}</td>
                        <td><strong>${h.room_number}</strong></td>
                        <td>₱${Number(h.old_rate).toLocaleString()}</td>
                        <td class="fw-bold text-primary">₱${Number(h.new_rate).toLocaleString()}</td>
                        <td>${diffStr}</td>
                        <td>${appliedTag}</td>
                    </tr>`;
                }).join('');
            }
        } catch (err) {
            if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger py-3">Failed to load history.</td></tr>';
        }
    },

    // ── Helpers ───────────────────────────────────────────────────────────────
    escapeHtml: function (str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    },

    showToast: function (message, type = 'success') {
        const existing = document.getElementById('rentToast');
        if (existing) existing.remove();

        const bgColors = {
            success: '#1b4332',
            danger:  '#7f1d1d',
            info:    '#1e3a8a',
            warning: '#854d0e'
        };

        const toast = document.createElement('div');
        toast.id    = 'rentToast';
        toast.style.cssText = `
            position:fixed; bottom:24px; right:24px; z-index:9999;
            background:${bgColors[type] || '#1b4332'};
            color:#fff; padding:14px 22px; border-radius:12px;
            box-shadow:0 8px 32px rgba(0,0,0,0.25); font-size:0.9rem;
            animation: slideUp 0.3s ease;`;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3500);
    }
};

// Auto-initialize when section becomes active
document.addEventListener('DOMContentLoaded', () => {
    const section = document.getElementById('section-rent-optimization');
    if (section && section.classList.contains('active')) {
        RentPricingModule.init();
    }
});
