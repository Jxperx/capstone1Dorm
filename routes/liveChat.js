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
        const sHyphen = `tenant-${tenantId}`;
        const sUnderscore = `tenant_${tenantId}`;
        const pool = await poolPromise;
        const result = await pool.request()
            .input('s1', sql.NVarChar, sHyphen)
            .input('s2', sql.NVarChar, sUnderscore)
            .input('tid', sql.Int, tenantId)
            .query(`
                SELECT sender, message, created_at
                FROM live_chat_messages
                WHERE session_id = @s1 OR session_id = @s2 OR tenant_id = @tid
                ORDER BY created_at ASC
            `);
        res.json({ messages: result.recordset, sessionId: sHyphen });
    } catch (e) {
        console.error('[LiveChat] tenant history error:', e.message);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
