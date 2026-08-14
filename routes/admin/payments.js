const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../../config/db');

// Admin Middleware
router.use((req, res, next) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(401).json({ error: 'Not authorized' });
    }
    next();
});

// Admin - Get All Payments (with Tenant Info)
router.get('/', async (req, res) => {
    try {
        const pool = await poolPromise;
        const query = `
            SELECT p.*, u.full_name, r.room_number 
            FROM payments p
            JOIN tenants t ON p.tenant_id = t.id
            JOIN users u ON t.user_id = u.id
            LEFT JOIN rooms r ON t.room_id = r.id
            ORDER BY p.created_at DESC
        `;
        const result = await pool.request().query(query);
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Admin - Approve Payment
router.post('/:id/approve', async (req, res) => {
    const paymentId = req.params.id;
    try {
        const pool = await poolPromise;

        // Update payment status
        await pool.request()
            .input('id', sql.Int, paymentId)
            .query("UPDATE payments SET status = 'approved' WHERE id = @id");

        // FIX: Sync fraud_scores.decision so the fraud dashboard reflects this manual action
        await pool.request()
            .input('pid', sql.Int, paymentId)
            .query(`
                IF EXISTS (SELECT 1 FROM fraud_scores WHERE payment_id = @pid)
                    UPDATE fraud_scores SET decision = 'MANUAL_APPROVED' WHERE payment_id = @pid
                ELSE
                    INSERT INTO fraud_scores (payment_id, risk_score, risk_level, decision)
                    VALUES (@pid, 0, 'SAFE', 'MANUAL_APPROVED')
            `);

        res.json({ message: `Payment ${paymentId} approved.` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Admin - Reject Payment
router.post('/:id/reject', async (req, res) => {
    const paymentId = req.params.id;
    try {
        const pool = await poolPromise;

        // Update payment status
        await pool.request()
            .input('id', sql.Int, paymentId)
            .query("UPDATE payments SET status = 'rejected' WHERE id = @id");

        // FIX: Sync fraud_scores.decision so the fraud dashboard reflects this manual action
        await pool.request()
            .input('pid', sql.Int, paymentId)
            .query(`
                IF EXISTS (SELECT 1 FROM fraud_scores WHERE payment_id = @pid)
                    UPDATE fraud_scores SET decision = 'MANUAL_BLOCKED' WHERE payment_id = @pid
                ELSE
                    INSERT INTO fraud_scores (payment_id, risk_score, risk_level, decision)
                    VALUES (@pid, 0, 'SAFE', 'MANUAL_BLOCKED')
            `);

        res.json({ message: `Payment ${paymentId} rejected.` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

module.exports = router;
