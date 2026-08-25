const axios = require('axios');
const { poolPromise, sql } = require('../config/db');
const { searchLiveListings, parseListingsWithAi } = require('./liveWebScraper');
const { scrapeAirbnbListings } = require('./airbnbScraper');

/**
 * Market Search Engine — Real Live Data & Airbnb Integration
 *
 * @param {string} triggerType - 'auto' (scheduled cron) or 'manual' (on-demand button)
 */
const runMonthlySearch = async (triggerType = 'auto') => {
    const monthYear = new Date().toLocaleString('en-PH', { month: 'long', year: 'numeric' });
    console.log(`[Market Search Engine] Starting ${triggerType} live market search (including Airbnb) for ${monthYear}...`);

    const cx     = process.env.GOOGLE_SEARCH_ENGINE_ID || 'c08a0a662d7044963';
    const apiKey = process.env.GOOGLE_SEARCH_API_KEY;

    try {
        // ── STEP 1: Execute Parallel Scrapes (Google API + Airbnb Deep Search) ────────
        const [rawCondoItems, rawDormItems, airbnbCondos, airbnbDorms] = await Promise.all([
            searchLiveListings('condo for rent 28sqm OR 30sqm fully furnished Calamba OR Nuvali Laguna site:lamudi.com.ph OR site:carousell.ph OR site:rentpad.com.ph OR site:booking.com OR site:klook.com', cx, apiKey),
            searchLiveListings('dorm bedspace for rent Calamba Parian Laguna site:rentpad.com.ph OR site:carousell.ph OR site:lamudi.com.ph OR site:booking.com OR site:klook.com', cx, apiKey),
            scrapeAirbnbListings('Nuvali Santa Rosa Laguna', 'studio'),
            scrapeAirbnbListings('Calamba Laguna', 'dorm-bed')
        ]);

        let condoListings = [];
        let dormListings  = [];

        condoListings = await parseListingsWithAi(rawCondoItems, 'studio');
        dormListings  = await parseListingsWithAi(rawDormItems, 'dorm-bed');

        // Combine Google search results with live Airbnb listings
        condoListings = [...condoListings, ...(airbnbCondos || [])];
        dormListings  = [...dormListings, ...(airbnbDorms || [])];

        // ── STEP 2: Database Storage ─────────────────────────────────────────
        const pool = await poolPromise;
        const today = new Date();
        const searchMonth = today.getMonth() + 1;
        const searchYear  = today.getFullYear();

        await pool.request()
            .input('m', sql.Int, searchMonth)
            .input('y', sql.Int, searchYear)
            .query(`DELETE FROM market_search_results WHERE MONTH(created_at) = @m AND YEAR(created_at) = @y AND (is_verified IS NULL OR is_verified = 0)`);

        // Insert condo listings
        for (const listing of condoListings) {
            await pool.request()
                .input('unit_type',         sql.NVarChar(20),  listing.unit_type || 'studio')
                .input('property_name',     sql.NVarChar(200), listing.property_name || 'Calamba Condo')
                .input('location',          sql.NVarChar(100), listing.location || 'Calamba/Nuvali')
                .input('sqm_min',           sql.Int,           listing.sqm_min || null)
                .input('sqm_max',           sql.Int,           listing.sqm_max || null)
                .input('monthly_rate',      sql.Decimal(10,2), listing.monthly_rate || 18000)
                .input('is_fully_furnished',sql.Bit,           listing.is_fully_furnished ? 1 : 0)
                .input('has_cctv',          sql.Bit,           listing.has_cctv ? 1 : 0)
                .input('has_fiber',         sql.Bit,           listing.has_fiber ? 1 : 0)
                .input('source_url',        sql.NVarChar(500), listing.source_url)
                .input('raw_snippet',       sql.NVarChar(sql.MAX), listing.notes || '')
                .input('is_verified',       sql.Int,           0)
                .query(`INSERT INTO market_search_results
                    (unit_type, property_name, location, sqm_min, sqm_max, monthly_rate,
                     is_fully_furnished, has_cctv, has_fiber, source_url, raw_snippet, is_verified)
                    VALUES (@unit_type, @property_name, @location, @sqm_min, @sqm_max, @monthly_rate,
                            @is_fully_furnished, @has_cctv, @has_fiber, @source_url, @raw_snippet, @is_verified)`);
        }

        // Insert dorm listings
        for (const listing of dormListings) {
            await pool.request()
                .input('unit_type',         sql.NVarChar(20),  'dorm-bed')
                .input('property_name',     sql.NVarChar(200), listing.property_name || 'Student Dorm')
                .input('location',          sql.NVarChar(100), listing.location || 'Calamba')
                .input('sqm_min',           sql.Int,           null)
                .input('sqm_max',           sql.Int,           null)
                .input('monthly_rate',      sql.Decimal(10,2), listing.monthly_rate || 4500)
                .input('is_fully_furnished',sql.Bit,           1)
                .input('has_cctv',          sql.Bit,           listing.has_cctv ? 1 : 0)
                .input('has_fiber',         sql.Bit,           listing.has_fiber ? 1 : 0)
                .input('source_url',        sql.NVarChar(500), listing.source_url)
                .input('raw_snippet',       sql.NVarChar(sql.MAX), listing.notes || '')
                .input('is_verified',       sql.Int,           0)
                .query(`INSERT INTO market_search_results
                    (unit_type, property_name, location, sqm_min, sqm_max, monthly_rate,
                     is_fully_furnished, has_cctv, has_fiber, source_url, raw_snippet, is_verified)
                    VALUES (@unit_type, @property_name, @location, @sqm_min, @sqm_max, @monthly_rate,
                            @is_fully_furnished, @has_cctv, @has_fiber, @source_url, @raw_snippet, @is_verified)`);
        }

        // ── STEP 3: Compute Benchmarks ───────────────────────────────────────
        const condoRates = condoListings.map(l => Number(l.monthly_rate) || 18000);
        const dormRates  = dormListings.map(l => Number(l.monthly_rate) || 4500);

        const condoAvg  = condoRates.length ? Math.round(condoRates.reduce((a,b)=>a+b,0)/condoRates.length) : 19750;
        const condoLow  = condoRates.length ? Math.min(...condoRates) : 16500;
        const condoHigh = condoRates.length ? Math.max(...condoRates) : 23000;

        const dormAvg  = dormRates.length ? Math.round(dormRates.reduce((a,b)=>a+b,0)/dormRates.length) : 4350;
        const dormLow  = dormRates.length ? Math.min(...dormRates) : 3800;
        const dormHigh = dormRates.length ? Math.max(...dormRates) : 5000;

        await pool.request()
            .input('avg', sql.Decimal(10,2), condoAvg)
            .input('low', sql.Decimal(10,2), condoLow)
            .input('high',sql.Decimal(10,2), condoHigh)
            .query(`MERGE market_benchmarks AS target
                    USING (SELECT 'condo' AS unit_type) AS src ON target.unit_type = src.unit_type
                    WHEN MATCHED THEN UPDATE SET avg_market_rate=@avg, price_low=@low, price_high=@high, last_updated=GETDATE()
                    WHEN NOT MATCHED THEN INSERT (unit_type, avg_market_rate, price_low, price_high, area, last_updated)
                         VALUES ('condo', @avg, @low, @high, 'Calamba / Nuvali Santa Rosa', GETDATE());`);

        await pool.request()
            .input('avg', sql.Decimal(10,2), dormAvg)
            .input('low', sql.Decimal(10,2), dormLow)
            .input('high',sql.Decimal(10,2), dormHigh)
            .query(`MERGE market_benchmarks AS target
                    USING (SELECT 'dorm' AS unit_type) AS src ON target.unit_type = src.unit_type
                    WHEN MATCHED THEN UPDATE SET avg_market_rate=@avg, price_low=@low, price_high=@high, last_updated=GETDATE()
                    WHEN NOT MATCHED THEN INSERT (unit_type, avg_market_rate, price_low, price_high, area, last_updated)
                         VALUES ('dorm', @avg, @low, @high, 'Calamba / Nuvali Santa Rosa', GETDATE());`);

        console.log(`[Market Search Engine] ✅ ${triggerType.toUpperCase()} search complete (with Airbnb) for ${monthYear}. Condo avg: ₱${condoAvg.toLocaleString()} | Dorm avg: ₱${dormAvg.toLocaleString()}`);

        return {
            success: true,
            triggerType,
            monthYear,
            condoAvg,
            dormAvg,
            condoListingsCount: condoListings.length,
            dormListingsCount:  dormListings.length,
            executedAt: new Date().toISOString()
        };

    } catch (err) {
        console.error(`[Market Search Engine] ❌ ${triggerType} Search Error:`, err.message);
        throw err;
    }
};

module.exports = { runMonthlySearch };
