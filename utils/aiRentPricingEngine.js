const { poolPromise, sql } = require('../config/db');

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

        // 4. Get market benchmarks (updated by monthly search)
        const mktRes = await pool.request().query('SELECT * FROM market_benchmarks');
        const mktMap = {};
        mktRes.recordset.forEach(r => { mktMap[r.unit_type] = r; });

        // 5. Get this month's search results for detailed comparison (excluding invalid listings)
        const searchRes = await pool.request().query(`
            SELECT unit_type, AVG(monthly_rate) as avg_rate, 
                   MIN(monthly_rate) as low_rate, MAX(monthly_rate) as high_rate,
                   COUNT(*) as listing_count
            FROM market_search_results
            WHERE (is_verified IS NULL OR is_verified != -1)
            GROUP BY unit_type
        `);
        const searchMap = {};
        searchRes.recordset.forEach(r => { searchMap[r.unit_type] = r; });

        const results = [];
        const monthYear = new Date().toLocaleString('en-PH', { month: 'long', year: 'numeric' });

        for (const room of rooms) {
            const occupancy     = occMap[room.id] || 0;
            const occupancyRate = room.capacity > 0 ? (occupancy / room.capacity) * 100 : 0;
            const inqCount      = inqMap[room.room_number] || 0;

            // Determine type: condo or dorm
            const isDorm    = room.room_number.toLowerCase().includes('dorm') ||
                              room.room_number.toLowerCase().includes('bed');
            const unitType  = isDorm ? 'dorm' : 'condo';
            const dormBedType = 'dorm-bed';

            // Pick the right market benchmark
            const mkt        = isDorm ? (mktMap['dorm']  || null) : (mktMap['condo'] || null);
            const srch       = isDorm ? (searchMap[dormBedType] || searchMap['dorm'] || null)
                                      : (searchMap['studio'] || searchMap['1br'] || searchMap['condo'] || null);
            const marketAvg  = srch?.avg_rate || mkt?.avg_market_rate || room.monthly_rate;
            const areaName   = mkt?.area || 'Calamba / Nuvali Santa Rosa';

            let suggestedRate = room.monthly_rate;
            let reason        = '';
            let action        = 'STAY';
            let confidence    = 85;

            // ── AI Logic ──────────────────────────────────────────────────────
            if (occupancyRate >= 90) {
                suggestedRate = room.monthly_rate * 1.05;
                if (inqCount > 5) suggestedRate *= 1.02;
                reason = `High occupancy (${Math.round(occupancyRate)}%) detected. Market avg in ${areaName} is ₱${Math.round(marketAvg).toLocaleString()}. Increasing rate to maximize revenue.`;
                action = 'INCREASE';
                confidence = 92;
            } else if (occupancyRate < 50) {
                suggestedRate = Math.min(room.monthly_rate * 0.95, marketAvg * 0.92);
                reason = `Occupancy below 50% for ${room.room_number}. Market average in ${areaName} is ₱${Math.round(marketAvg).toLocaleString()}. Adjusting rate to stay competitive.`;
                action = 'DECREASE';
                confidence = 88;
            } else if (room.monthly_rate < marketAvg * 0.85) {
                suggestedRate = marketAvg * 0.90;
                reason = `Rate is 15%+ below the ${unitType} market average in ${areaName} (₱${Math.round(marketAvg).toLocaleString()}). Bridging gap gradually.`;
                action = 'INCREASE';
                confidence = 90;
            } else if (room.monthly_rate > marketAvg * 1.15) {
                suggestedRate = marketAvg * 1.05;
                reason = `Rate is above market average in ${areaName} (₱${Math.round(marketAvg).toLocaleString()}). Slight reduction recommended to avoid vacancy risk.`;
                action = 'DECREASE';
                confidence = 87;
            } else {
                suggestedRate = room.monthly_rate;
                reason = `Price is well-aligned with the ₱${Math.round(marketAvg).toLocaleString()} market average in ${areaName}.`;
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
 * Legacy/On-Demand: suggest only (no auto-apply) — used by manual override UI
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

        const searchRes = await pool.request().query(`
            SELECT unit_type, AVG(monthly_rate) as avg_rate, COUNT(*) as count
            FROM market_search_results
            WHERE (is_verified IS NULL OR is_verified != -1)
            GROUP BY unit_type
        `);
        const searchMap = {};
        searchRes.recordset.forEach(r => { searchMap[r.unit_type] = r; });

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
                                  room.room_number.toLowerCase().includes('bed');
            const unitType      = isDorm ? 'dorm' : 'condo';
            const dormBedType   = 'dorm-bed';

            const marketMatch   = marketData.find(m => m.unit_type === unitType);
            const srch          = isDorm ? (searchMap[dormBedType] || searchMap['dorm'])
                                         : (searchMap['studio'] || searchMap['1br'] || searchMap['condo']);
            const marketAvg     = srch?.avg_rate || marketMatch?.avg_market_rate || room.monthly_rate;
            const areaName      = marketMatch?.area || 'Calamba / Nuvali Santa Rosa';

            let suggestedRate = room.monthly_rate;
            let reason        = '';
            let confidence    = 85;

            if (occupancyRate >= 90) {
                suggestedRate *= 1.05;
                if (inqCount > 5) suggestedRate *= 1.02;
                reason = `High occupancy (${Math.round(occupancyRate)}%) in ${areaName}. Market avg is ₱${Math.round(marketAvg).toLocaleString()}.`;
                confidence = 92;
            } else if (occupancyRate < 50) {
                suggestedRate = Math.min(room.monthly_rate * 0.95, marketAvg * 0.92);
                reason = `Occupancy below 50% for ${room.room_number}. Market average in ${areaName} is ₱${Math.round(marketAvg).toLocaleString()}. Suggesting adjustment to stay competitive.`;
            } else if (room.monthly_rate < marketAvg * 0.85) {
                suggestedRate = marketAvg * 0.90;
                reason = `Your price is 15%+ below the ${unitType} market average in ${areaName} (₱${Math.round(marketAvg).toLocaleString()}).`;
            } else {
                reason = `Price is well-aligned with the ₱${Math.round(marketAvg).toLocaleString()} market average in ${areaName}.`;
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
                lastUpdated
            });
        }

        return suggestions;

    } catch (err) {
        console.error('[AI Rent Pricing] Suggest error:', err);
        throw err;
    }
};

module.exports = { autoApplyPricing, suggestRentPricing };
