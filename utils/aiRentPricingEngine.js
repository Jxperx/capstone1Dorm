const { poolPromise, sql } = require('../config/db');

/**
 * Helper to calculate specs-based average rate from competitor listings
 */
function calculateSpecsMarketAverage(room, allListings, mktMap) {
    const isDorm = room.room_number.toLowerCase().includes('dorm') ||
                   room.room_number.toLowerCase().includes('bed') ||
                   (room.room_type && room.room_type.toLowerCase() === 'dorm');
    
    const mkt = isDorm ? (mktMap['dorm'] || null) : (mktMap['condo'] || null);
    const defaultFallbackRate = mkt?.avg_market_rate || room.monthly_rate;

    if (isDorm) {
        // Dorm bed comparisons: look at 'dorm-bed' or 'dorm' listings
        const dormListings = allListings.filter(l => 
            l.unit_type === 'dorm-bed' || l.unit_type === 'dorm'
        );
        if (dormListings.length === 0) return { avg: defaultFallbackRate, count: 0, criteria: 'general dorm bed' };

        // For dorms, we assume fully furnished, AC, WiFi, so we match active dorm listings in the area
        const total = dormListings.reduce((sum, l) => sum + Number(l.monthly_rate), 0);
        return { 
            avg: total / dormListings.length, 
            count: dormListings.length, 
            criteria: 'fully furnished dorm beds' 
        };
    } else {
        // Condo comparisons based on size (sqm) and balcony
        let condoListings = allListings.filter(l => 
            ['studio', '1br', 'condo'].includes(l.unit_type)
        );

        if (condoListings.length === 0) return { avg: defaultFallbackRate, count: 0, criteria: 'general condo' };

        let criteriaNotes = [];

        // 1. Filter by size (sqm) if room.sqm is defined
        if (room.sqm != null) {
            const sizeTolerance = 3.5; // ±3.5 sqm
            const matchingSize = condoListings.filter(l => {
                const listingSqm = l.sqm_min || l.sqm_max;
                if (!listingSqm) return false;
                return Math.abs(listingSqm - room.sqm) <= sizeTolerance;
            });
            // If we found enough size matches, narrow down to those
            if (matchingSize.length >= 2) {
                condoListings = matchingSize;
                criteriaNotes.push(`${room.sqm}sqm (±3.5sqm)`);
            }
        }

        // 2. Filter by balcony if room.has_balcony is 1
        if (room.has_balcony) {
            const balconyListings = condoListings.filter(l => {
                const hasBalconyWord = (l.raw_snippet && l.raw_snippet.toLowerCase().includes('balcony')) ||
                                       (l.property_name && l.property_name.toLowerCase().includes('balcony'));
                return hasBalconyWord;
            });
            // If we have balcony matches, prioritize them
            if (balconyListings.length >= 2) {
                condoListings = balconyListings;
                criteriaNotes.push('with balcony');
            }
        } else {
            // For no-balcony units, prioritize listings without balcony word in description
            const noBalconyListings = condoListings.filter(l => {
                const hasBalconyWord = (l.raw_snippet && l.raw_snippet.toLowerCase().includes('balcony')) ||
                                       (l.property_name && l.property_name.toLowerCase().includes('balcony'));
                return !hasBalconyWord;
            });
            if (noBalconyListings.length >= 2) {
                condoListings = noBalconyListings;
                criteriaNotes.push('no balcony');
            }
        }

        const total = condoListings.reduce((sum, l) => sum + Number(l.monthly_rate), 0);
        return { 
            avg: total / condoListings.length, 
            count: condoListings.length, 
            criteria: criteriaNotes.length > 0 ? criteriaNotes.join(' & ') : 'studio/1br condos' 
        };
    }
}

/**
 * AI Rent Pricing Engine — Auto-Apply Edition
 * Reads live market data from market_search_results (populated by marketSearchEngine.js)
 * and automatically applies optimal pricing to rooms.
 */
const autoApplyPricing = async () => {
    try {
        const pool = await poolPromise;

        // 1. Get current rooms
        const roomsRes = await pool.request().query('SELECT * FROM rooms');
        const rooms = roomsRes.recordset;

        // 2. Get occupancy
        const occRes = await pool.request().query(`
            SELECT room_id, COUNT(*) as tenant_count
            FROM tenants WHERE status = 'active'
            GROUP BY room_id
        `);
        const occMap = {};
        occRes.recordset.forEach(r => { occMap[r.room_id] = r.tenant_count; });

        // 3. Get inquiry demand (last 30 days)
        const inqRes = await pool.request().query(`
            SELECT preferred_unit, COUNT(*) as inq_count
            FROM inquiries WHERE created_at >= DATEADD(day, -30, GETDATE())
            GROUP BY preferred_unit
        `);
        const inqMap = {};
        inqRes.recordset.forEach(r => { inqMap[r.preferred_unit] = r.inq_count; });

        // 4. Get market benchmarks
        const mktRes = await pool.request().query('SELECT * FROM market_benchmarks');
        const mktMap = {};
        mktRes.recordset.forEach(r => { mktMap[r.unit_type] = r; });

        // 5. Get all verified competitor listings
        const listingsRes = await pool.request().query(`
            SELECT * FROM market_search_results
            WHERE (is_verified IS NULL OR is_verified != -1)
        `);
        const listings = listingsRes.recordset;

        const results = [];
        const monthYear = new Date().toLocaleString('en-PH', { month: 'long', year: 'numeric' });

        for (const room of rooms) {
            const occupancy     = occMap[room.id] || 0;
            const occupancyRate = room.capacity > 0 ? (occupancy / room.capacity) * 100 : 0;
            const inqCount      = inqMap[room.room_number] || 0;

            const isDorm = room.room_number.toLowerCase().includes('dorm') ||
                           room.room_number.toLowerCase().includes('bed') ||
                           (room.room_type && room.room_type.toLowerCase() === 'dorm');
            const unitType = isDorm ? 'dorm' : 'condo';

            // Calculate market average based on specifications
            const { avg: marketAvg, criteria } = calculateSpecsMarketAverage(room, listings, mktMap);
            const mkt = isDorm ? (mktMap['dorm'] || null) : (mktMap['condo'] || null);
            const areaName = mkt?.area || 'Calamba / Nuvali Santa Rosa';

            let suggestedRate = room.monthly_rate;
            let reason        = '';
            let action        = 'STAY';
            let confidence    = 85;

            // ── AI Logic ──────────────────────────────────────────────────────
            if (occupancyRate >= 90) {
                suggestedRate = room.monthly_rate * 1.05;
                if (inqCount > 5) suggestedRate *= 1.02;
                reason = `High occupancy (${Math.round(occupancyRate)}%) detected. Market avg for ${criteria} in ${areaName} is ₱${Math.round(marketAvg).toLocaleString()}. Increasing rate to maximize revenue.`;
                action = 'INCREASE';
                confidence = 92;
            } else if (occupancyRate < 50) {
                suggestedRate = Math.min(room.monthly_rate * 0.95, marketAvg * 0.92);
                reason = `Occupancy below 50% for ${room.room_number}. Market average for ${criteria} in ${areaName} is ₱${Math.round(marketAvg).toLocaleString()}. Adjusting rate to stay competitive.`;
                action = 'DECREASE';
                confidence = 88;
            } else if (room.monthly_rate < marketAvg * 0.85) {
                suggestedRate = marketAvg * 0.90;
                reason = `Rate is 15%+ below the market average for ${criteria} in ${areaName} (₱${Math.round(marketAvg).toLocaleString()}). Bridging gap gradually.`;
                action = 'INCREASE';
                confidence = 90;
            } else if (room.monthly_rate > marketAvg * 1.15) {
                suggestedRate = marketAvg * 1.05;
                reason = `Rate is above market average for ${criteria} in ${areaName} (₱${Math.round(marketAvg).toLocaleString()}). Slight reduction recommended to avoid vacancy risk.`;
                action = 'DECREASE';
                confidence = 87;
            } else {
                suggestedRate = room.monthly_rate;
                reason = `Price is well-aligned with the ₱${Math.round(marketAvg).toLocaleString()} market average for ${criteria} in ${areaName}.`;
                action = 'STAY';
                confidence = 95;
            }

            suggestedRate = Math.round(suggestedRate / 100) * 100;
            const oldRate = room.monthly_rate;

            if (action !== 'STAY' && suggestedRate !== oldRate) {
                await pool.request()
                    .input('id',   sql.Int,            room.id)
                    .input('rate', sql.Decimal(10, 2), suggestedRate)
                    .query('UPDATE rooms SET monthly_rate = @rate WHERE id = @id');

                await pool.request()
                    .input('room_id',    sql.Int,          room.id)
                    .input('old_rate',   sql.Decimal(10,2), oldRate)
                    .input('new_rate',   sql.Decimal(10,2), suggestedRate)
                    .input('reason',     sql.NVarChar(500), `Auto-adjusted by AI Rent Optimizer (${monthYear}): ${reason}`)
                    .input('applied_by', sql.NVarChar(50),  'AI Optimizer')
                    .query(`INSERT INTO room_pricing_history (room_id, old_rate, new_rate, reason, applied_by)
                            VALUES (@room_id, @old_rate, @new_rate, @reason, @applied_by)`);
            }

            results.push({
                roomId:       room.id,
                roomNumber:   room.room_number,
                oldRate,
                newRate:      suggestedRate,
                occupancy:    `${occupancy}/${room.capacity}`,
                occupancyPct: Math.round(occupancyRate),
                inquiriesCount: inqCount,
                marketAvg:    Math.round(marketAvg),
                reason,
                confidence,
                action,
                autoApplied:  action !== 'STAY'
            });
        }

        console.log(`[AI Rent Optimizer] ✅ Auto-applied prices for ${monthYear}. Rooms processed: ${results.length}`);
        return { success: true, monthYear, results };

    } catch (err) {
        console.error('[AI Rent Optimizer] ❌ Auto-apply error:', err.message);
        throw err;
    }
};

/**
 * On-Demand suggestions (no auto-apply) — used by manual override UI
 */
const suggestRentPricing = async () => {
    try {
        const pool = await poolPromise;

        const roomsRes = await pool.request().query('SELECT * FROM rooms');
        const rooms    = roomsRes.recordset;

        const occRes = await pool.request().query(`
            SELECT room_id, COUNT(*) as tenant_count
            FROM tenants WHERE status = 'active' GROUP BY room_id
        `);
        const occMap = {};
        occRes.recordset.forEach(r => { occMap[r.room_id] = r.tenant_count; });

        const inqRes = await pool.request().query(`
            SELECT preferred_unit, COUNT(*) as inq_count
            FROM inquiries WHERE created_at >= DATEADD(day, -30, GETDATE())
            GROUP BY preferred_unit
        `);
        const inqMap = {};
        inqRes.recordset.forEach(r => { inqMap[r.preferred_unit] = r.inq_count; });

        const mktRes = await pool.request().query('SELECT * FROM market_benchmarks');
        const marketData = mktRes.recordset;

        const listingsRes = await pool.request().query(`
            SELECT * FROM market_search_results
            WHERE (is_verified IS NULL OR is_verified != -1)
        `);
        const listings = listingsRes.recordset;

        const mktMap = {};
        marketData.forEach(r => { mktMap[r.unit_type] = r; });

        const lastUpdRes = await pool.request().query(`
            SELECT TOP 1 created_at FROM market_search_results ORDER BY created_at DESC
        `);
        const lastUpdated = lastUpdRes.recordset[0]?.created_at || null;

        const suggestions = [];
        for (const room of rooms) {
            const occupancy     = occMap[room.id] || 0;
            const occupancyRate = room.capacity > 0 ? (occupancy / room.capacity) * 100 : 0;
            const inqCount      = inqMap[room.room_number] || 0;
            const isDorm        = room.room_number.toLowerCase().includes('dorm') ||
                                  room.room_number.toLowerCase().includes('bed') ||
                                  (room.room_type && room.room_type.toLowerCase() === 'dorm');
            const unitType      = isDorm ? 'dorm' : 'condo';

            const marketMatch   = marketData.find(m => m.unit_type === unitType);
            const { avg: marketAvg, criteria } = calculateSpecsMarketAverage(room, listings, mktMap);
            const areaName      = marketMatch?.area || 'Calamba / Nuvali Santa Rosa';

            let suggestedRate = room.monthly_rate;
            let reason        = '';
            let confidence    = 85;

            if (occupancyRate >= 90) {
                suggestedRate *= 1.05;
                if (inqCount > 5) suggestedRate *= 1.02;
                reason = `High occupancy (${Math.round(occupancyRate)}%) in ${areaName}. Matching comparable specs (${criteria}) market average is ₱${Math.round(marketAvg).toLocaleString()}.`;
                confidence = 92;
            } else if (occupancyRate < 50) {
                suggestedRate = Math.min(room.monthly_rate * 0.95, marketAvg * 0.92);
                reason = `Occupancy below 50% for ${room.room_number}. Comparable specs (${criteria}) market average in ${areaName} is ₱${Math.round(marketAvg).toLocaleString()}. Suggesting competitive adjustment.`;
            } else if (room.monthly_rate < marketAvg * 0.85) {
                suggestedRate = marketAvg * 0.90;
                reason = `Your price is 15%+ below the market average for ${criteria} in ${areaName} (₱${Math.round(marketAvg).toLocaleString()}).`;
            } else {
                reason = `Price is well-aligned with the ₱${Math.round(marketAvg).toLocaleString()} market average for ${criteria} in ${areaName}.`;
                confidence = 95;
            }

            suggestedRate = Math.round(suggestedRate / 100) * 100;
            const gapPct = room.monthly_rate ? Math.round(((room.monthly_rate - marketAvg) / marketAvg) * 100) : 0;

            suggestions.push({
                roomId:       room.id,
                roomNumber:   room.room_number,
                unitType,
                currentRate:  room.monthly_rate,
                suggestedRate,
                occupancy:    `${occupancy}/${room.capacity}`,
                occupancyPct: Math.round(occupancyRate),
                inquiriesCount: inqCount,
                marketAvg:    Math.round(marketAvg),
                gapPct,
                reason,
                confidence,
                action: suggestedRate > room.monthly_rate ? 'INCREASE'
                      : suggestedRate < room.monthly_rate ? 'DECREASE'
                      : 'STAY',
                lastUpdated,
                // Specifications added
                sqm:          room.sqm,
                hasBalcony:   room.has_balcony === 1 || room.has_balcony === true,
                isFullyFurnished: room.is_fully_furnished === 1 || room.is_fully_furnished === true,
                hasAc:        room.has_ac === 1 || room.has_ac === true,
                hasWifi:      room.has_wifi === 1 || room.has_wifi === true
            });
        }

        return suggestions;

    } catch (err) {
        console.error('[AI Rent Pricing] Suggest error:', err);
        throw err;
    }
};

module.exports = { autoApplyPricing, suggestRentPricing };
