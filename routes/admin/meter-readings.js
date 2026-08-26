const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../../config/db');

// Admin-only middleware
router.use((req, res, next) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(401).json({ error: 'Not authorized' });
    }
    next();
});

// GET /api/admin/meter-readings - list all readings
router.get('/', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT mr.id, mr.tenant_id, mr.water_reading, mr.electric_reading,
                   mr.reading_date, mr.status, mr.created_at,
                   u.full_name, r.room_number
            FROM   meter_readings mr
            JOIN   tenants t  ON mr.tenant_id = t.id
            JOIN   users   u  ON t.user_id    = u.id
            LEFT JOIN rooms r ON t.room_id    = r.id
            ORDER BY mr.created_at DESC
        `);
        res.json(result.recordset);
    } catch (err) {
        console.error('[meter-readings GET]', err);
        res.status(500).json({ error: 'Failed to load readings' });
    }
});

// POST /api/admin/meter-readings - add admin-verified reading
router.post('/', async (req, res) => {
    const { tenant_id, water_reading, electric_reading, status } = req.body;
    if (!tenant_id || water_reading == null || electric_reading == null) {
        return res.status(400).json({ error: 'tenant_id, water_reading, and electric_reading are required.' });
    }
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('tenant_id',        sql.Int,            tenant_id)
            .input('water_reading',    sql.Decimal(10, 2), parseFloat(water_reading))
            .input('electric_reading', sql.Decimal(10, 2), parseFloat(electric_reading))
            .input('status',           sql.NVarChar(50),   status || 'verified')
            .input('reading_date',     sql.Date,           new Date())
            .query(`
                INSERT INTO meter_readings
                    (tenant_id, water_reading, electric_reading, status, reading_date, created_at)
                VALUES
                    (@tenant_id, @water_reading, @electric_reading, @status, @reading_date, GETDATE())
            `);
        res.json({ success: true, message: 'Meter reading saved successfully.' });
    } catch (err) {
        console.error('[meter-readings POST]', err);
        res.status(500).json({ error: 'Failed to save reading. Please try again.' });
    }
});

module.exports = router;
