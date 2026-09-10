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
    rawSuggestions: [],
    marketListings: [],
    marketSummary: [],
    activeFilter: 'all',
    activeTab: 'recommendations',

    init: async function () {
        console.log('[RentPricingModule] Initializing...');
        this.container = document.getElementById('rentPricingContainer');
        this.initTabs();
        await Promise.all([
            this.loadScheduleInfo(),
            this.loadSuggestions(),
            this.loadMarketEvidence()
        ]);
    },

    // ── Tab Management ────────────────────────────────────────────────────────
    initTabs: function () {
        const btnRec = document.getElementById('tab-rent-recommendations');
        const btnEv  = document.getElementById('tab-rent-evidence');

        if (btnRec && btnEv) {
            btnRec.onclick = () => this.switchTab('recommendations');
            btnEv.onclick  = () => this.switchTab('evidence');
        }
    },

    switchTab: function (tabName) {
        this.activeTab = tabName;
        const paneRec     = document.getElementById('rentTabPaneRecommendations');
        const paneEv      = document.getElementById('rentTabPaneEvidence');
        const btnRec      = document.getElementById('tab-rent-recommendations');
        const btnEv       = document.getElementById('tab-rent-evidence');
        const filterPills = document.getElementById('rentFilterPillsContainer');

        if (tabName === 'recommendations') {
            if (paneRec) paneRec.classList.remove('d-none');
            if (paneEv) paneEv.classList.add('d-none');
            if (btnRec) {
                btnRec.classList.add('active', 'fw-bold');
                btnRec.classList.remove('fw-semibold');
            }
            if (btnEv) {
                btnEv.classList.remove('active', 'fw-bold');
                btnEv.classList.add('fw-semibold');
            }
            if (filterPills) filterPills.classList.remove('d-none');
        } else {
            if (paneRec) paneRec.classList.add('d-none');
            if (paneEv) paneEv.classList.remove('d-none');
            if (btnEv) {
                btnEv.classList.add('active', 'fw-bold');
                btnEv.classList.remove('fw-semibold');
            }
            if (btnRec) {
                btnRec.classList.remove('active', 'fw-bold');
                btnRec.classList.add('fw-semibold');
            }
            if (filterPills) filterPills.classList.add('d-none');
        }
    },

    // ── Quick Filter Handling ─────────────────────────────────────────────────
    setFilter: function (filterType) {
        this.activeFilter = filterType;
        const btnAll     = document.getElementById('filterBtnAll');
        const btnChanges = document.getElementById('filterBtnChanges');
        const btnOptimal = document.getElementById('filterBtnOptimal');

        [btnAll, btnChanges, btnOptimal].forEach(btn => {
            if (btn) {
                btn.className = 'btn btn-sm btn-outline-secondary rounded-pill px-2.5 py-0.5';
                btn.style.fontSize = '0.75rem';
            }
        });

        if (filterType === 'all' && btnAll) {
            btnAll.className = 'btn btn-sm btn-dark rounded-pill px-2.5 py-0.5';
        } else if (filterType === 'changes' && btnChanges) {
            btnChanges.className = 'btn btn-sm btn-dark rounded-pill px-2.5 py-0.5';
        } else if (filterType === 'optimal' && btnOptimal) {
            btnOptimal.className = 'btn btn-sm btn-dark rounded-pill px-2.5 py-0.5';
        }

        this.renderFilteredCards();
    },

    // ── Open Multi-Portal Deep Search Modal ──────────────────────────────────
    openDeepSearchModal: function () {
        const modalHtml = `
        <div class="modal fade" id="deepSearchModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-lg modal-dialog-centered">
                <div class="modal-content border-0 shadow-lg" style="border-radius:16px; overflow:hidden;">
                    <div class="modal-header bg-dark text-white py-3">
                        <h5 class="modal-title fw-bold"><i class="fas fa-globe text-primary me-2"></i>Multi-Portal Deep Search &amp; Competitor Evidence</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body p-4">
                        <p class="text-muted small mb-4">
                            Direct, hyper-targeted queries across major Philippine property portals specifically filtered for units matching our property inventory in <strong>Calamba &amp; Nuvali</strong>.
                        </p>
                        
                        <!-- Category 1: Condo Comps -->
                        <div class="mb-4">
                            <div class="d-flex align-items-center mb-2">
                                <span class="badge bg-primary me-2">Category 1</span>
                                <h6 class="fw-bold mb-0 text-dark">Studio &amp; 1BR Condo Comps (28–35 sqm, Furnished)</h6>
                            </div>
                            <p class="text-muted" style="font-size:0.75rem;">Directly comparable to our Units CONDO-01 to CONDO-06 (28.5–35.0 sqm, Fully Furnished, AC, Fiber WiFi).</p>
                            <div class="row g-2">
                                <div class="col-md-6">
                                    <a href="https://www.airbnb.com/s/Calamba--Laguna--Philippines/homes?room_types[]=Entire+home%2Fapt" target="_blank" class="card text-decoration-none border shadow-sm p-3 h-100 rounded-3 text-dark hover-shadow">
                                        <div class="d-flex align-items-center justify-content-between">
                                            <div>
                                                <div class="fw-bold small text-danger"><i class="fab fa-airbnb me-1"></i>Airbnb Calamba Studios</div>
                                                <div class="text-muted" style="font-size:0.7rem;">Furnished Studio Condos in Calamba</div>
                                            </div>
                                            <i class="fas fa-external-link-alt text-muted" style="font-size:0.75rem;"></i>
                                        </div>
                                    </a>
                                </div>
                                <div class="col-md-6">
                                    <a href="https://www.airbnb.com/s/Nuvali--Santa-Rosa--Laguna--Philippines/homes?room_types[]=Entire+home%2Fapt" target="_blank" class="card text-decoration-none border shadow-sm p-3 h-100 rounded-3 text-dark hover-shadow">
                                        <div class="d-flex align-items-center justify-content-between">
                                            <div>
                                                <div class="fw-bold small text-danger"><i class="fab fa-airbnb me-1"></i>Airbnb Nuvali Studios</div>
                                                <div class="text-muted" style="font-size:0.7rem;">Furnished Studio Units in Nuvali / Santa Rosa</div>
                                            </div>
                                            <i class="fas fa-external-link-alt text-muted" style="font-size:0.75rem;"></i>
                                        </div>
                                    </a>
                                </div>
                                <div class="col-md-6">
                                    <a href="https://www.dotproperty.com.ph/condos-for-rent/laguna/santa-rosa?bedrooms=studio" target="_blank" class="card text-decoration-none border shadow-sm p-3 h-100 rounded-3 text-dark hover-shadow">
                                        <div class="d-flex align-items-center justify-content-between">
                                            <div>
                                                <div class="fw-bold small text-success"><i class="fas fa-building me-1"></i>DotProperty Santa Rosa / Nuvali</div>
                                                <div class="text-muted" style="font-size:0.7rem;">Studio Condos (28-35 sqm) in Santa Rosa / Nuvali</div>
                                            </div>
                                            <i class="fas fa-external-link-alt text-muted" style="font-size:0.75rem;"></i>
                                        </div>
                                    </a>
                                </div>
                                <div class="col-md-6">
                                    <a href="https://www.dotproperty.com.ph/condos-for-rent/laguna/calamba?bedrooms=studio" target="_blank" class="card text-decoration-none border shadow-sm p-3 h-100 rounded-3 text-dark hover-shadow">
                                        <div class="d-flex align-items-center justify-content-between">
                                            <div>
                                                <div class="fw-bold small text-success"><i class="fas fa-home me-1"></i>DotProperty Calamba Studios</div>
                                                <div class="text-muted" style="font-size:0.7rem;">Studio Rentals in Calamba Area (28-35 sqm)</div>
                                            </div>
                                            <i class="fas fa-external-link-alt text-muted" style="font-size:0.75rem;"></i>
                                        </div>
                                    </a>
                                </div>
                            </div>
                        </div>

                        <!-- Category 2: Student Dorm Comps -->
                        <div>
                            <div class="d-flex align-items-center mb-2">
                                <span class="badge bg-warning text-dark me-2">Category 2</span>
                                <h6 class="fw-bold mb-0 text-dark">Student Dorm &amp; Bedspace Comps (AC &amp; Fiber WiFi)</h6>
                            </div>
                            <p class="text-muted" style="font-size:0.75rem;">Directly comparable to our Units DormA1 &amp; DormA2 (4-Person Student Dorm, Fully Furnished, AC, Fiber WiFi in Calamba).</p>
                            <div class="row g-2">
                                <div class="col-md-6">
                                    <a href="https://www.dotproperty.com.ph/apartments-for-rent/laguna/calamba" target="_blank" class="card text-decoration-none border shadow-sm p-3 h-100 rounded-3 text-dark hover-shadow">
                                        <div class="d-flex align-items-center justify-content-between">
                                            <div>
                                                <div class="fw-bold small text-success"><i class="fas fa-bed me-1"></i>DotProperty Calamba Rentals</div>
                                                <div class="text-muted" style="font-size:0.7rem;">Student Rooms &amp; Apartments in Calamba</div>
                                            </div>
                                            <i class="fas fa-external-link-alt text-muted" style="font-size:0.75rem;"></i>
                                        </div>
                                    </a>
                                </div>
                                <div class="col-md-6">
                                    <a href="https://www.facebook.com/marketplace/calamba/propertyrentals/?query=student%20dorm%20bedspace" target="_blank" class="card text-decoration-none border shadow-sm p-3 h-100 rounded-3 text-dark hover-shadow">
                                        <div class="d-flex align-items-center justify-content-between">
                                            <div>
                                                <div class="fw-bold small text-info"><i class="fab fa-facebook me-1"></i>FB Marketplace Dorms</div>
                                                <div class="text-muted" style="font-size:0.7rem;">Calamba Student Residences &amp; Bedspaces</div>
                                            </div>
                                            <i class="fas fa-external-link-alt text-muted" style="font-size:0.75rem;"></i>
                                        </div>
                                    </a>
                                </div>
                                <div class="col-md-6">
                                    <a href="https://www.airbnb.com/s/Calamba--Laguna--Philippines/homes?room_types[]=Private+room" target="_blank" class="card text-decoration-none border shadow-sm p-3 h-100 rounded-3 text-dark hover-shadow">
                                        <div class="d-flex align-items-center justify-content-between">
                                            <div>
                                                <div class="fw-bold small text-danger"><i class="fab fa-airbnb me-1"></i>Airbnb Calamba Rooms &amp; Stays</div>
                                                <div class="text-muted" style="font-size:0.7rem;">Private &amp; Shared Student Rooms in Calamba</div>
                                            </div>
                                            <i class="fas fa-external-link-alt text-muted" style="font-size:0.75rem;"></i>
                                        </div>
                                    </a>
                                </div>
                                <div class="col-md-6">
                                    <a href="https://www.facebook.com/marketplace/calamba/propertyrentals/?query=calamba%20student%20bedspace" target="_blank" class="card text-decoration-none border shadow-sm p-3 h-100 rounded-3 text-dark hover-shadow">
                                        <div class="d-flex align-items-center justify-content-between">
                                            <div>
                                                <div class="fw-bold small text-info"><i class="fab fa-facebook me-1"></i>FB Marketplace Calamba Bedspaces</div>
                                                <div class="text-muted" style="font-size:0.7rem;">Parian &amp; Bucal University Belt Bedspaces</div>
                                            </div>
                                            <i class="fas fa-external-link-alt text-muted" style="font-size:0.75rem;"></i>
                                        </div>
                                    </a>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        </div>`;

        let modalContainer = document.getElementById('deepSearchModalContainer');
        if (!modalContainer) {
            modalContainer = document.createElement('div');
            modalContainer.id = 'deepSearchModalContainer';
            document.body.appendChild(modalContainer);
        }
        modalContainer.innerHTML = modalHtml;
        const modal = new bootstrap.Modal(document.getElementById('deepSearchModal'));
        modal.show();
    },

    // ── Smart URL Cleaner & Fallback Resolver ────────────────────────────────
    getValidPropertyUrl: function (rawUrl, propertyName, location, unitType) {
        if (!rawUrl || typeof rawUrl !== 'string') rawUrl = '';
        const urlLower = rawUrl.toLowerCase();
        const propLower = (propertyName || '').toLowerCase();
        const locLower = (location || '').toLowerCase();
        const isDorm = (unitType === 'dorm' || unitType === 'dorm-bed') ||
                       propLower.includes('dorm') || propLower.includes('bedspace');
        const isNuvali = locLower.includes('nuvali') || locLower.includes('santa rosa') || propLower.includes('nuvali');

        // Redirect any Carousell links away from nationwide results to strict Calamba/Santa Rosa portals
        if (urlLower.includes('carousell.ph')) {
            if (isDorm) {
                return 'https://www.dotproperty.com.ph/apartments-for-rent/laguna/calamba';
            }
            if (isNuvali) {
                return 'https://www.dotproperty.com.ph/condos-for-rent/laguna/santa-rosa?bedrooms=studio';
            }
            return 'https://www.dotproperty.com.ph/condos-for-rent/laguna/calamba?bedrooms=studio';
        }

        // Fix RentPad URLs to strict Calamba/Santa Rosa portals
        if (urlLower.includes('rentpad.com.ph')) {
            if (isDorm) {
                return 'https://www.dotproperty.com.ph/apartments-for-rent/laguna/calamba';
            }
            if (isNuvali) {
                return 'https://www.dotproperty.com.ph/condos-for-rent/laguna/santa-rosa?bedrooms=studio';
            }
            return 'https://www.dotproperty.com.ph/condos-for-rent/laguna/calamba?bedrooms=studio';
        }

        // Fix hotel/resort URLs so they redirect to real rental comps
        if (urlLower.includes('booking.com') || urlLower.includes('klook.com')) {
            if (isDorm) {
                return 'https://www.airbnb.com/s/Calamba--Laguna--Philippines/homes?room_types[]=Private+room';
            }
            if (isNuvali) {
                return 'https://www.airbnb.com/s/Nuvali--Santa-Rosa--Laguna--Philippines/homes?room_types[]=Entire+home%2Fapt';
            }
            return 'https://www.airbnb.com/s/Calamba--Laguna--Philippines/homes?room_types[]=Entire+home%2Fapt';
        }

        // Redirect any Lamudi URLs to Airbnb
        if (urlLower.includes('lamudi.com.ph')) {
            if (isDorm) {
                return 'https://www.airbnb.com/s/Calamba--Laguna--Philippines/homes?room_types[]=Private+room';
            }
            if (isNuvali) {
                return 'https://www.airbnb.com/s/Nuvali--Santa-Rosa--Laguna--Philippines/homes?room_types[]=Entire+home%2Fapt';
            }
            return 'https://www.airbnb.com/s/Calamba--Laguna--Philippines/homes?room_types[]=Entire+home%2Fapt';
        }

        // Fix Airbnb links to strict Calamba or Nuvali room type filters
        if (urlLower.includes('airbnb.com')) {
            if (isDorm) {
                return 'https://www.airbnb.com/s/Calamba--Laguna--Philippines/homes?room_types[]=Private+room';
            }
            return isNuvali
                ? 'https://www.airbnb.com/s/Nuvali--Santa-Rosa--Laguna--Philippines/homes?room_types[]=Entire+home%2Fapt'
                : 'https://www.airbnb.com/s/Calamba--Laguna--Philippines/homes?room_types[]=Entire+home%2Fapt';
        }

        // DotProperty strict province & city filtering (Laguna / Calamba or Santa Rosa)
        if (urlLower.includes('dotproperty.com.ph')) {
            if (isDorm) {
                return 'https://www.dotproperty.com.ph/apartments-for-rent/laguna/calamba';
            }
            if (isNuvali) {
                return 'https://www.dotproperty.com.ph/condos-for-rent/laguna/santa-rosa?bedrooms=studio';
            }
            return 'https://www.dotproperty.com.ph/condos-for-rent/laguna/calamba?bedrooms=studio';
        }

        // Facebook Marketplace strict city slugs
        if (urlLower.includes('facebook.com')) {
            if (isDorm) {
                return 'https://www.facebook.com/marketplace/calamba/propertyrentals/?query=student%20dorm%20bedspace';
            }
            if (isNuvali) {
                return 'https://www.facebook.com/marketplace/santarosa/propertyrentals/?query=studio%20condo%20furnished';
            }
            return 'https://www.facebook.com/marketplace/calamba/propertyrentals/?query=studio%20condo%20furnished';
        }

        if (rawUrl.startsWith('http')) return rawUrl;

        const specKeyword = isDorm ? 'calamba student dorm bedspace aircon' : 'calamba studio condo 28sqm furnished';
        const searchQuery = encodeURIComponent(`${propertyName || ''} ${specKeyword} rent`);
        return `https://www.google.com/search?q=${searchQuery}`;
    },

    // ── Trigger Manual On-Demand Market Search ────────────────────────────────
    triggerMarketSearch: async function () {
        if (this.searching) return;
        this.searching = true;

        const btn = document.getElementById('btnSearchMarketNow');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Scanning Market...`;
        }

        this.showToast('Scanning Calamba & Nuvali market for rental listings...', 'info');

        try {
            const res  = await fetch('/api/admin/rent-pricing/trigger-search', { method: 'POST' });
            const data = await res.json();

            if (data.success) {
                this.showToast(`Market scan complete. Found ${data.data.condoListingsCount} condos & ${data.data.dormListingsCount} dorms.`, 'success');
                await Promise.all([
                    this.loadScheduleInfo(),
                    this.loadSuggestions(),
                    this.loadMarketEvidence()
                ]);
            } else {
                this.showToast('Market scan failed: ' + (data.error || 'Unknown error'), 'danger');
            }
        } catch (err) {
            console.error('[RentPricingModule] Trigger search error:', err);
            this.showToast('Failed to run market scan.', 'danger');
        } finally {
            this.searching = false;
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<i class="fas fa-search-dollar me-1"></i>Run Market Scan`;
            }
        }
    },

    // ── Load Schedule Info & Live Market Pulse ────────────────────────────────
    loadScheduleInfo: async function () {
        try {
            const res  = await fetch('/api/admin/rent-pricing/schedule-info');
            const data = await res.json();

            const nextEl = document.getElementById('rentMetricNextRun');
            const badge  = document.getElementById('marketPulseBadge');

            if (nextEl && data.nextRun) {
                const nextDate = new Date(data.nextRun);
                nextEl.textContent = nextDate.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
            }

            if (badge) {
                const mktRes  = await fetch('/api/admin/rent-pricing/market-data');
                const mktData = await mktRes.json();
                if (mktData.listings && mktData.listings.length > 0) {
                    const updated = new Date(mktData.lastUpdated || mktData.listings[0].created_at);
                    badge.textContent = `Scanned: ${updated.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}`;
                    badge.className   = 'badge bg-light text-success border small fw-normal';
                } else {
                    badge.textContent = 'Awaiting Next Scan';
                    badge.className   = 'badge bg-light text-muted border small fw-normal';
                }
            }
        } catch (err) {
            console.warn('[RentPricingModule] Schedule info error:', err);
        }
    },

    // ── Load AI Pricing Suggestions ───────────────────────────────────────────
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

            this.rawSuggestions = Array.isArray(suggestions) ? suggestions : [];
            this.updateMetricRibbon();
            this.renderFilteredCards();
        } catch (err) {
            console.error('[RentPricingModule] Load error:', err);
            this.container.innerHTML = `
                <div class="col-12 text-center text-danger py-4">
                    <i class="fas fa-exclamation-circle me-2"></i>Failed to load AI recommendations.
                </div>`;
        }
    },

    // ── Update 4-Card Business Metric Ribbon ──────────────────────────────────
    updateMetricRibbon: function () {
        const totalUnitsEl    = document.getElementById('rentMetricTotalUnits');
        const avgRateEl       = document.getElementById('rentMetricAvgRate');
        const marketMedianEl  = document.getElementById('rentMetricMarketMedian');
        const marketGapEl     = document.getElementById('rentMetricMarketGap');
        const unitsBadgeEl    = document.getElementById('rentBadgeUnitsCount');

        const total = this.rawSuggestions.length;
        if (unitsBadgeEl) unitsBadgeEl.textContent = total;
        if (totalUnitsEl) totalUnitsEl.textContent = `${total} / ${total}`;

        if (!total) {
            if (avgRateEl) avgRateEl.textContent = 'PHP 0';
            if (marketMedianEl) marketMedianEl.textContent = 'PHP 0';
            return;
        }

        const sumCurrent = this.rawSuggestions.reduce((acc, s) => acc + Number(s.currentRate || 0), 0);
        const avgCurrent = Math.round(sumCurrent / total);
        if (avgRateEl) avgRateEl.textContent = `PHP ${avgCurrent.toLocaleString()}`;

        const sumMarket = this.rawSuggestions.reduce((acc, s) => acc + Number(s.marketAvg || 0), 0);
        const avgMarket = Math.round(sumMarket / total);
        if (marketMedianEl) marketMedianEl.textContent = `PHP ${avgMarket.toLocaleString()}`;

        if (marketGapEl && avgCurrent && avgMarket) {
            const gapPct = (((avgCurrent - avgMarket) / avgMarket) * 100).toFixed(1);
            if (gapPct < 0) {
                marketGapEl.textContent = `${gapPct}% vs Market Median`;
                marketGapEl.className = 'small text-warning fw-semibold';
            } else {
                marketGapEl.textContent = `+${gapPct}% vs Market Median`;
                marketGapEl.className = 'small text-success fw-semibold';
            }
        }
    },

    // ── Filter and Render Cards ───────────────────────────────────────────────
    renderFilteredCards: function () {
        if (!this.container) return;

        let filtered = this.rawSuggestions;
        if (this.activeFilter === 'changes') {
            filtered = this.rawSuggestions.filter(s => s.action !== 'STAY' && s.suggestedRate !== s.currentRate);
        } else if (this.activeFilter === 'optimal') {
            filtered = this.rawSuggestions.filter(s => s.action === 'STAY' || s.suggestedRate === s.currentRate);
        }

        if (!filtered.length) {
            this.container.innerHTML = `
                <div class="col-12 text-center py-5 text-muted">
                    <i class="fas fa-check-circle text-success fs-2 mb-3"></i>
                    <p class="fw-semibold mb-1">No units match the selected filter.</p>
                    <p class="small text-muted mb-0">All room rates in this view are currently optimized.</p>
                </div>`;
            return;
        }

        this.container.innerHTML = filtered.map(s => {
            const diff = Number(s.suggestedRate) - Number(s.currentRate);
            const isIncrease = diff > 0;
            const isDecrease = diff < 0;
            const isStay = diff === 0 || s.action === 'STAY';

            let deltaPill = '';
            let borderAccent = '#64748b';
            let targetColor = 'text-secondary';
            let arrow = '';

            if (isIncrease) {
                borderAccent = '#10b981';
                targetColor = 'text-success';
                arrow = '▲';
                const pct = ((diff / s.currentRate) * 100).toFixed(1);
                deltaPill = `<span class="badge bg-success-subtle text-success border border-success fw-bold px-2 py-1" style="font-size:0.7rem;">+PHP ${Number(diff).toLocaleString()} (+${pct}%)</span>`;
            } else if (isDecrease) {
                borderAccent = '#f59e0b';
                targetColor = 'text-warning';
                arrow = '▼';
                const pct = ((Math.abs(diff) / s.currentRate) * 100).toFixed(1);
                deltaPill = `<span class="badge bg-warning-subtle text-dark border border-warning fw-bold px-2 py-1" style="font-size:0.7rem;">-PHP ${Number(Math.abs(diff)).toLocaleString()} (-${pct}%)</span>`;
            } else {
                borderAccent = '#64748b';
                targetColor = 'text-muted';
                deltaPill = `<span class="badge bg-light text-muted border fw-bold px-2 py-1" style="font-size:0.7rem;">Optimal Rate</span>`;
            }

            // Specs label
            let specLabel = '';
            if (s.unitType === 'condo') {
                const sqmText = s.sqm ? `${s.sqm} sqm` : '';
                const balconyText = s.hasBalcony ? 'Balcony' : 'No Balcony';
                const furnishedText = s.isFullyFurnished ? 'Furnished' : '';
                specLabel = [sqmText, balconyText, furnishedText].filter(Boolean).join(' · ');
            } else {
                const furnishedText = s.isFullyFurnished ? 'Furnished' : '';
                const acText = s.hasAc ? 'AC' : '';
                const wifiText = s.hasWifi ? 'WiFi' : '';
                specLabel = [furnishedText, acText, wifiText].filter(Boolean).join(' · ');
            }

            return `
            <div class="col-md-6 col-xl-4">
                <div class="card h-100 border-0 shadow-sm rounded-4 p-4 d-flex flex-column justify-content-between" style="background:#fff; border-left: 4px solid ${borderAccent} !important;">
                    <div>
                        <!-- Header Row -->
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <span class="text-muted fw-semibold" style="font-size:0.75rem; text-transform:capitalize;">${s.unitType || 'Unit'}</span>
                            ${deltaPill}
                        </div>

                        <!-- Unit Title & Specs -->
                        <h4 class="fw-bold mb-1 text-dark">Unit ${s.roomNumber}</h4>
                        <div class="small text-muted mb-3" style="font-size:0.75rem;">
                            <i class="fas fa-sliders-h me-1 text-secondary"></i>${specLabel || 'Standard Unit'}
                        </div>

                        <!-- Price Comparison Box -->
                        <div class="bg-light rounded-3 p-3 border mb-3">
                            <div class="d-flex justify-content-between align-items-center small mb-1">
                                <span class="text-muted">Current Rate</span>
                                <span class="fw-bold text-dark">PHP ${Number(s.currentRate).toLocaleString()}</span>
                            </div>
                            <div class="d-flex justify-content-between align-items-center pt-2 border-top">
                                <span class="fw-bold ${targetColor}">AI Target Rate</span>
                                <span class="fs-5 fw-bold ${targetColor}">${arrow} PHP ${Number(s.suggestedRate).toLocaleString()}</span>
                            </div>
                        </div>

                        <!-- Compact 3-Signal Micro Grid -->
                        <div class="row g-1 text-center mb-3">
                            <div class="col-4">
                                <div class="bg-light rounded-2 py-1 px-1 border">
                                    <div class="text-muted text-uppercase" style="font-size:0.65rem;">Occupancy</div>
                                    <div class="fw-bold text-dark" style="font-size:0.8rem;">${s.occupancyPct || 0}%</div>
                                </div>
                            </div>
                            <div class="col-4">
                                <div class="bg-light rounded-2 py-1 px-1 border">
                                    <div class="text-muted text-uppercase" style="font-size:0.65rem;">Inquiries</div>
                                    <div class="fw-bold text-primary" style="font-size:0.8rem;">${s.inquiriesCount || 0} mo</div>
                                </div>
                            </div>
                            <div class="col-4">
                                <div class="bg-light rounded-2 py-1 px-1 border">
                                    <div class="text-muted text-uppercase" style="font-size:0.65rem;">Market Comp</div>
                                    <div class="fw-bold text-dark" style="font-size:0.8rem;">PHP ${Number(s.marketAvg).toLocaleString()}</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Action Buttons -->
                    <div class="d-flex align-items-center gap-2 pt-2 border-top">
                        <button class="btn btn-outline-secondary btn-sm rounded-pill flex-fill" style="font-size:0.75rem;" onclick="RentPricingModule.openAnalysisModal(${s.roomId})">
                            <i class="fas fa-info-circle me-1"></i>View Analysis
                        </button>
                        ${!isStay ? `
                        <button class="btn btn-dark btn-sm rounded-pill flex-fill fw-bold text-warning" style="font-size:0.75rem;" onclick="RentPricingModule.applyDirectRate(${s.roomId}, ${s.suggestedRate}, '${s.roomNumber}')">
                            <i class="fas fa-check me-1"></i>Apply Rate
                        </button>
                        ` : ''}
                        <button class="btn btn-outline-dark btn-sm rounded-pill px-2.5" style="font-size:0.75rem;" title="Manual Price Override" onclick="RentPricingModule.showOverrideModal(${s.roomId}, ${s.currentRate}, '${s.roomNumber}', ${s.suggestedRate})">
                            <i class="fas fa-edit"></i>
                        </button>
                    </div>
                </div>
            </div>`;
        }).join('');
    },

    // ── Open Analysis Inspection Modal ────────────────────────────────────────
    openAnalysisModal: function (roomId) {
        const item = this.rawSuggestions.find(s => Number(s.roomId) === Number(roomId));
        if (!item) return;

        const modalEl = document.getElementById('rentAnalysisModal');
        if (!modalEl) return;

        const titleEl  = document.getElementById('rentAnalysisModalTitle');
        const bodyEl   = document.getElementById('rentAnalysisModalBody');
        const footerEl = document.getElementById('rentAnalysisModalFooter');

        const diff = Number(item.suggestedRate) - Number(item.currentRate);
        const annualDiff = diff * 12;
        const isIncrease = diff > 0;
        const isDecrease = diff < 0;

        let deltaText = 'Optimal Rate';
        let deltaColor = 'text-muted';
        if (isIncrease) {
            deltaText = `+PHP ${Number(diff).toLocaleString()} / mo (+PHP ${Number(annualDiff).toLocaleString()} / yr)`;
            deltaColor = 'text-success';
        } else if (isDecrease) {
            deltaText = `-PHP ${Number(Math.abs(diff)).toLocaleString()} / mo (-PHP ${Number(Math.abs(annualDiff)).toLocaleString()} / yr)`;
            deltaColor = 'text-warning';
        }

        if (titleEl) {
            titleEl.innerHTML = `<i class="fas fa-robot text-warning me-2"></i>Unit ${item.roomNumber} Pricing Analysis`;
        }

        if (bodyEl) {
            bodyEl.innerHTML = `
                <div class="bg-light p-3 rounded-3 mb-3 border">
                    <div class="fw-bold text-uppercase text-muted mb-1" style="font-size:0.7rem; letter-spacing:0.04em;">Algorithmic Recommendation Rationale</div>
                    <p class="small text-dark mb-0 leading-relaxed" style="line-height:1.6;">${item.reason || 'Optimal rent calibration based on Calamba and Nuvali rental market median.'}</p>
                </div>

                <div class="row g-2 mb-3">
                    <div class="col-sm-6">
                        <div class="p-3 bg-light rounded-3 border text-center">
                            <div class="text-muted small text-uppercase" style="font-size:0.7rem;">Monthly Rate Shift</div>
                            <div class="fs-5 fw-bold ${deltaColor} mt-1">${deltaText}</div>
                        </div>
                    </div>
                    <div class="col-sm-6">
                        <div class="p-3 bg-light rounded-3 border text-center">
                            <div class="text-muted small text-uppercase" style="font-size:0.7rem;">Model Confidence</div>
                            <div class="fs-5 fw-bold text-primary mt-1">${item.confidence || 85}% Calibrated</div>
                        </div>
                    </div>
                </div>

                <div class="card border rounded-3 p-3 mb-2">
                    <div class="d-flex justify-content-between small py-1 border-bottom">
                        <span class="text-muted">Unit Number &amp; Type:</span>
                        <strong class="text-dark">Unit ${item.roomNumber} (${item.unitType})</strong>
                    </div>
                    <div class="d-flex justify-content-between small py-1 border-bottom">
                        <span class="text-muted">Current Monthly Rate:</span>
                        <strong class="text-dark">PHP ${Number(item.currentRate).toLocaleString()}</strong>
                    </div>
                    <div class="d-flex justify-content-between small py-1 border-bottom">
                        <span class="text-muted">AI Recommended Rate:</span>
                        <strong class="text-primary">PHP ${Number(item.suggestedRate).toLocaleString()}</strong>
                    </div>
                    <div class="d-flex justify-content-between small py-1 border-bottom">
                        <span class="text-muted">Local Market Median Comp:</span>
                        <strong class="text-dark">PHP ${Number(item.marketAvg).toLocaleString()}</strong>
                    </div>
                    <div class="d-flex justify-content-between small py-1 border-bottom">
                        <span class="text-muted">Historical Occupancy:</span>
                        <strong class="text-dark">${item.occupancyPct || 0}% (${item.occupancy || 'Standard'})</strong>
                    </div>
                    <div class="d-flex justify-content-between small py-1">
                        <span class="text-muted">30-Day Inquiry Volume:</span>
                        <strong class="text-dark">${item.inquiriesCount || 0} Inquiries</strong>
                    </div>
                </div>`;
        }

        if (footerEl) {
            footerEl.innerHTML = `
                <button type="button" class="btn btn-outline-secondary rounded-pill px-3" data-bs-dismiss="modal">Close</button>
                <button type="button" class="btn btn-outline-dark rounded-pill px-3" onclick="RentPricingModule.showOverrideModal(${item.roomId}, ${item.currentRate}, '${item.roomNumber}', ${item.suggestedRate})">
                    <i class="fas fa-edit me-1"></i>Override Price
                </button>
                ${diff !== 0 ? `
                <button type="button" class="btn btn-warning fw-bold rounded-pill px-4 shadow-sm" onclick="RentPricingModule.applyDirectRate(${item.roomId}, ${item.suggestedRate}, '${item.roomNumber}')">
                    <i class="fas fa-check me-1"></i>Apply Target Rate (PHP ${Number(item.suggestedRate).toLocaleString()})
                </button>
                ` : ''}`;
        }

        bootstrap.Modal.getOrCreateInstance(modalEl).show();
    },

    // ── Direct 1-Click Rate Application ───────────────────────────────────────
    applyDirectRate: async function (roomId, suggestedRate, roomNumber) {
        const analysisEl = document.getElementById('rentAnalysisModal');
        if (analysisEl) {
            const instance = bootstrap.Modal.getInstance(analysisEl);
            if (instance) instance.hide();
        }

        await this.applyOverride(
            roomId,
            Number(suggestedRate),
            `Applied AI recommended rate for Unit ${roomNumber}`
        );
    },

    // ── Show Structured Override Modal ────────────────────────────────────────
    showOverrideModal: function (roomId, currentRate, roomNumber, suggestedRate) {
        const analysisEl = document.getElementById('rentAnalysisModal');
        if (analysisEl) {
            const instance = bootstrap.Modal.getInstance(analysisEl);
            if (instance) instance.hide();
        }

        const modalEl = document.getElementById('rentOverrideModal');
        if (!modalEl) return;

        document.getElementById('overrideRoomId').value = roomId;
        document.getElementById('overrideRoomNumber').value = roomNumber;
        document.getElementById('overrideUnitLabel').textContent = `Unit ${roomNumber}`;
        document.getElementById('overrideCurrentRateLabel').textContent = `PHP ${Number(currentRate).toLocaleString()}`;
        document.getElementById('overrideSuggestedRateLabel').textContent = `PHP ${Number(suggestedRate).toLocaleString()}`;

        const inputRate = document.getElementById('overrideNewRateInput');
        if (inputRate) inputRate.value = suggestedRate || currentRate;

        const inputReason = document.getElementById('overrideReasonInput');
        if (inputReason) inputReason.value = `Rate adjustment based on market comps for Unit ${roomNumber}`;

        bootstrap.Modal.getOrCreateInstance(modalEl).show();
    },

    // ── Submit Structured Override Form ───────────────────────────────────────
    submitOverrideForm: async function () {
        const roomId     = document.getElementById('overrideRoomId').value;
        const roomNumber = document.getElementById('overrideRoomNumber').value;
        const newRate    = document.getElementById('overrideNewRateInput').value;
        const reason     = document.getElementById('overrideReasonInput').value;

        if (!newRate || isNaN(newRate) || Number(newRate) <= 0) {
            this.showToast('Please enter a valid monthly rate greater than 0.', 'warning');
            return;
        }

        const modalEl = document.getElementById('rentOverrideModal');
        if (modalEl) {
            const instance = bootstrap.Modal.getInstance(modalEl);
            if (instance) instance.hide();
        }

        await this.applyOverride(
            Number(roomId),
            Number(newRate),
            reason || `Manual override for Unit ${roomNumber}`
        );
    },

    // ── Execute Apply Rate in Backend ─────────────────────────────────────────
    applyOverride: async function (roomId, newRate, reason) {
        try {
            const res    = await fetch('/api/admin/rent-pricing/apply', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ roomId, newRate, reason })
            });
            const result = await res.json();
            if (result.success) {
                this.showToast(`Rate applied successfully: PHP ${Number(newRate).toLocaleString()}`, 'success');
                await this.loadSuggestions();
                if (typeof loadRooms === 'function') loadRooms();
            } else {
                this.showToast('Error applying rate: ' + (result.error || 'Unknown error'), 'danger');
            }
        } catch (err) {
            console.error('[RentPricingModule] Override error:', err);
            this.showToast('Failed to apply rate adjustment.', 'danger');
        }
    },

    // ── Load & Render Competitor Market Evidence ──────────────────────────────
    loadMarketEvidence: async function () {
        const tbody = document.getElementById('marketEvidenceTbody');
        const badgeComps = document.getElementById('rentBadgeCompsCount');

        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted"><div class="spinner-border spinner-border-sm me-2"></div>Loading competitor listings...</td></tr>`;
        }

        try {
            const res  = await fetch('/api/admin/rent-pricing/market-data');
            const data = await res.json();
            this.marketListings = data.listings || [];
            this.marketSummary  = data.summary  || [];

            if (badgeComps) badgeComps.textContent = this.marketListings.length;
            this.renderMarketEvidenceTable(this.marketListings);
        } catch (err) {
            console.error('[RentPricingModule] Evidence load error:', err);
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-3">Failed to load competitor listings.</td></tr>`;
            }
        }
    },

    renderMarketEvidenceTable: function (listings) {
        const tbody = document.getElementById('marketEvidenceTbody');
        if (!tbody) return;

        if (!listings || !listings.length) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">No competitor market listings recorded. Click "Scan Market Now" to fetch active comps.</td></tr>`;
            return;
        }

        tbody.innerHTML = listings.map(item => {
            const isDorm = (item.unit_type || '').toLowerCase().includes('dorm') ||
                           (item.property_name || '').toLowerCase().includes('dorm') ||
                           (item.property_name || '').toLowerCase().includes('bedspace');
            const unitCategory = isDorm ? 'dorm' : 'condo';

            const sqmTag = (item.sqm_min || item.sqm_max)
                ? `<span class="badge bg-light text-dark border me-1">${item.sqm_min || item.sqm_max} sqm</span>` : '';
            const furnishedTag = item.is_fully_furnished ? `<span class="badge bg-info-subtle text-info border me-1">Furnished</span>` : '';
            const acTag = `<span class="badge bg-secondary-subtle text-secondary border me-1">AC</span>`;
            const fiberTag = item.has_fiber ? `<span class="badge bg-primary-subtle text-primary border me-1">Fiber WiFi</span>` : '';

            const rawUrl = this.getValidPropertyUrl(item.source_url, item.property_name, item.location, unitCategory);
            const urlCheck = (rawUrl || '').toLowerCase();

            let portalName = 'DotProperty';
            let portalIcon = 'fas fa-home text-success';
            let btnClass   = 'btn-outline-success';

            if (urlCheck.includes('facebook.com')) {
                portalName = 'FB Marketplace';
                portalIcon = 'fab fa-facebook text-info';
                btnClass   = 'btn-outline-info';
            } else if (urlCheck.includes('airbnb.com')) {
                portalName = 'Airbnb';
                portalIcon = 'fab fa-airbnb text-danger';
                btnClass   = 'btn-outline-danger';
            } else if (urlCheck.includes('dotproperty.com.ph')) {
                portalName = 'DotProperty';
                portalIcon = 'fas fa-home text-success';
                btnClass   = 'btn-outline-success';
            }

            return `
            <tr>
                <td>
                    <div class="fw-bold text-dark">${this.escapeHtml(item.property_name)}</div>
                    ${item.raw_snippet ? `<div class="text-muted text-truncate" style="font-size:0.75rem; max-width:280px;" title="${this.escapeHtml(item.raw_snippet)}">${this.escapeHtml(item.raw_snippet)}</div>` : ''}
                </td>
                <td><i class="fas fa-map-marker-alt text-danger me-1"></i>${this.escapeHtml(item.location || 'Calamba, Laguna')}</td>
                <td><span class="badge ${isDorm ? 'bg-warning-subtle text-dark border border-warning' : 'bg-primary-subtle text-primary border border-primary'}">${isDorm ? 'Student Dorm Bed' : 'Condo Studio'}</span></td>
                <td>${sqmTag}${furnishedTag}${acTag}${fiberTag}</td>
                <td class="fw-bold text-success" style="font-size:0.95rem;">PHP ${Number(item.monthly_rate).toLocaleString()}</td>
                <td>
                    <a href="${rawUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-sm ${btnClass} rounded-pill px-3 py-1 fw-semibold" style="font-size:0.75rem;" title="View listing on ${portalName}">
                        <i class="${portalIcon} me-1"></i>View on ${portalName} <i class="fas fa-external-link-alt ms-1" style="font-size:0.65rem;"></i>
                    </a>
                </td>
            </tr>`;
        }).join('');
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
                        ? `<span class="badge" style="background:#1a1a2e;color:#f0c040;font-size:0.65rem;">AI</span>`
                        : `<span class="badge bg-secondary" style="font-size:0.65rem;">Admin</span>`;
                    const diff       = h.new_rate - h.old_rate;
                    const diffStr    = diff > 0
                        ? `<span class="text-success">▲ PHP ${Math.abs(diff).toLocaleString()}</span>`
                        : diff < 0
                        ? `<span class="text-danger">▼ PHP ${Math.abs(diff).toLocaleString()}</span>`
                        : `<span class="text-muted">—</span>`;

                    return `
                    <tr>
                        <td class="small">${new Date(h.created_at).toLocaleDateString('en-PH')}</td>
                        <td><strong>${h.room_number}</strong></td>
                        <td>PHP ${Number(h.old_rate).toLocaleString()}</td>
                        <td class="fw-bold text-primary">PHP ${Number(h.new_rate).toLocaleString()}</td>
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
