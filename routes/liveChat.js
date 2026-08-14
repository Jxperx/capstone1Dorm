const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../config/db');

function requireAuth(req, res, next) {
    if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
    next();
}

// GET /api/live-chat/history
// Returns message history for the authenticated tenant
router.get('/history', requireAuth, async (req, res) => {
    try {
        const tenantId = req.session.user.id;
        const sessionId = `tenant-${tenantId}`;
        const pool = await poolPromise;
        const result = await pool.request()
            .input('session_id', sql.NVarChar, sessionId)
            .query(`
                SELECT sender, message, created_at
                FROM live_chat_messages
                WHERE session_id = @session_id
                ORDER BY created_at ASC
            `);
        res.json({ messages: result.recordset, sessionId });
    } catch (e) {
        console.error('[LiveChat] tenant history error:', e.message);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
