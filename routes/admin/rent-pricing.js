const express = require('express');
const router  = express.Router();
const { poolPromise, sql } = require('../../config/db');
const { suggestRentPricing, autoApplyPricing } = require('../../utils/aiRentPricingEngine');
const { runMonthlySearch } = require('../../utils/marketSearchEngine');

// Admin-only middleware
router.use((req, res, next) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(401).json({ error: 'Not authorized' });
    }
    next();
});

// ─── POST: Trigger Manual On-Demand Market Search ──────────────────────────────
router.post('/trigger-search', async (req, res) => {
    try {
        const result = await runMonthlySearch('manual');
        res.json({
            success: true,
            message: 'Market search completed successfully.',
            data: result
        });
    } catch (err) {
        console.error('Trigger Search Error:', err);
        res.status(500).json({ error: 'Market search failed. Please try again.' });
    }
});

// ─── GET: AI Pricing Suggestions (current state) ─────────────────────────────
router.get('/suggestions', async (req, res) => {
    try {
        const suggestions = await suggestRentPricing();
        res.json(suggestions);
    } catch (err) {
        res.status(500).json({ error: 'Failed to generate suggestions' });
    }
});

// ─── GET: Market Data (competitor listings + verification states) ─────────────
router.get('/market-data', async (req, res) => {
    try {
        const pool = await poolPromise;

        const listingsRes = await pool.request().query(`
            SELECT TOP 50 *
            FROM market_search_results
            ORDER BY created_at DESC, monthly_rate ASC
        `);

        const summaryRes = await pool.request().query(`
            SELECT unit_type,
                   AVG(monthly_rate) as avg_rate,
                   MIN(monthly_rate) as low_rate,
                   MAX(monthly_rate) as high_rate,
                   COUNT(*) as listing_count,
                   SUM(CASE WHEN is_verified = 1 THEN 1 ELSE 0 END) as verified_count,
                   SUM(CASE WHEN is_verified = -1 THEN 1 ELSE 0 END) as invalid_count
            FROM market_search_results
            WHERE (is_verified IS NULL OR is_verified != -1)
            GROUP BY unit_type
        `);

        const lastUpdRes = await pool.request().query(`
            SELECT TOP 1 created_at FROM market_search_results ORDER BY created_at DESC
        `);

        res.json({
            listings:    listingsRes.recordset,
            summary:     summaryRes.recordset,
            lastUpdated: lastUpdRes.recordset[0]?.created_at || null
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch market data' });
    }
});

// ─── PATCH: Update Competitor Listing Verification Status ────────────────────
router.patch('/competitors/:id/verify', async (req, res) => {
    const listingId = parseInt(req.params.id, 10);
    const { status } = req.body; // 1 = verified, -1 = invalid, 0 = unverified

    if (isNaN(listingId) || ![-1, 0, 1].includes(Number(status))) {
        return res.status(400).json({ error: 'Invalid parameters. Status must be -1, 0, or 1.' });
    }

    try {
        const pool = await poolPromise;
        await pool.request()
            .input('id',     sql.Int, listingId)
            .input('status', sql.Int, Number(status))
            .query('UPDATE market_search_results SET is_verified = @status WHERE id = @id');

        res.json({ success: true, listingId, status: Number(status) });
    } catch (err) {
        console.error('Verify Competitor Error:', err);
        res.status(500).json({ error: 'Failed to update competitor verification status' });
    }
});

// ─── GET: Auto-Applied Pricing History ───────────────────────────────────────
router.get('/auto-log', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT TOP 50 h.*, r.room_number
            FROM room_pricing_history h
            JOIN rooms r ON h.room_id = r.id
            WHERE h.applied_by = 'AI Optimizer'
            ORDER BY h.created_at DESC
        `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch auto-log' });
    }
});

// ─── GET: Next scheduled run date ────────────────────────────────────────────
router.get('/schedule-info', (req, res) => {
    const now     = new Date();
    const nextRun = new Date(now.getFullYear(), now.getMonth() + 1, 1, 2, 0, 0);
    const lastRun = new Date(now.getFullYear(), now.getMonth(), 1, 2, 0, 0);
    res.json({
        nextRun:   nextRun.toISOString(),
        lastRun:   lastRun.toISOString(),
        frequency: 'Monthly (1st of every month at 2:00 AM)',
        timezone:  'Asia/Manila'
    });
});

// ─── POST: Apply Pricing Adjustment (manual admin override) ──────────────────
router.post('/apply', async (req, res) => {
    const { roomId, newRate, reason } = req.body;
    if (!roomId || !newRate) return res.status(400).json({ error: 'Missing required fields' });

    try {
        const pool = await poolPromise;

        const roomRes = await pool.request()
            .input('id', sql.Int, roomId)
            .query('SELECT monthly_rate FROM rooms WHERE id = @id');

        if (roomRes.recordset.length === 0) return res.status(404).json({ error: 'Room not found' });
        const oldRate = roomRes.recordset[0].monthly_rate;

        await pool.request()
            .input('id',   sql.Int,            roomId)
            .input('rate', sql.Decimal(10, 2), newRate)
            .query('UPDATE rooms SET monthly_rate = @rate WHERE id = @id');

        await pool.request()
            .input('room_id',    sql.Int,          roomId)
            .input('old_rate',   sql.Decimal(10,2), oldRate)
            .input('new_rate',   sql.Decimal(10,2), newRate)
            .input('reason',     sql.NVarChar(500), reason || 'Manual admin override')
            .input('applied_by', sql.NVarChar(50),  'admin')
            .query(`INSERT INTO room_pricing_history (room_id, old_rate, new_rate, reason, applied_by)
                    VALUES (@room_id, @old_rate, @new_rate, @reason, @applied_by)`);

        res.json({ success: true, message: `Price updated to ₱${Number(newRate).toLocaleString()}` });

    } catch (err) {
        console.error('Apply Pricing Error:', err);
        res.status(500).json({ error: 'Failed to apply pricing' });
    }
});

// ─── GET: Full Pricing History ────────────────────────────────────────────────
router.get('/history', async (req, res) => {
    try {
        const pool = await poolPromise;
        const history = await pool.request().query(`
            SELECT h.*, r.room_number
            FROM room_pricing_history h
            JOIN rooms r ON h.room_id = r.id
            ORDER BY h.created_at DESC
        `);
        res.json(history.recordset);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch history' });
    }
});

module.exports = router;
