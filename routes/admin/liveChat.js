const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../../config/db');

function requireAdmin(req, res, next) {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

// GET /api/admin/live-chat/sessions
// Returns all distinct chat sessions with unread count and last message
router.get('/sessions', requireAdmin, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT
                m.session_id,
                m.tenant_id,
                u.full_name   AS tenant_name,
                r.room_number,
                MAX(m.created_at) AS last_message_time,
                (
                    SELECT TOP 1 message
                    FROM live_chat_messages
                    WHERE session_id = m.session_id
                    ORDER BY created_at DESC
                ) AS last_message,
                SUM(CASE WHEN m.is_read = 0 AND m.sender = 'tenant' THEN 1 ELSE 0 END) AS unread_count
            FROM live_chat_messages m
            LEFT JOIN users u    ON m.tenant_id = u.id
            -- FIX: users has no room_id; room lives on the tenants table joined via user_id
            LEFT JOIN tenants t  ON t.user_id   = u.id
            LEFT JOIN rooms r    ON t.room_id   = r.id
            GROUP BY m.session_id, m.tenant_id, u.full_name, r.room_number
            ORDER BY MAX(m.created_at) DESC
        `);
        res.json({ sessions: result.recordset });
    } catch (e) {
        console.error('[LiveChat] sessions error:', e.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/admin/live-chat/messages/:sessionId
router.get('/messages/:sessionId', requireAdmin, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('session_id', sql.NVarChar, req.params.sessionId)
            .query(`
                SELECT id, sender, message, is_read, created_at
                FROM live_chat_messages
                WHERE session_id = @session_id
                ORDER BY created_at ASC
            `);
        res.json({ messages: result.recordset });
    } catch (e) {
        console.error('[LiveChat] messages error:', e.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// PATCH /api/admin/live-chat/read/:sessionId
router.patch('/read/:sessionId', requireAdmin, async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('session_id', sql.NVarChar, req.params.sessionId)
            .query(`UPDATE live_chat_messages SET is_read = 1 WHERE session_id = @session_id AND sender = 'tenant'`);
        res.json({ success: true });
    } catch (e) {
        console.error('[LiveChat] read error:', e.message);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
