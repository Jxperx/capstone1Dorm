'use strict';
/**
 * routes/admin/inquiries.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Admin-only CRUD + analytics for the inquiry system.
 * All routes require req.session.user with role 'admin'.
 */

const express = require('express');
const router  = express.Router();
const { poolPromise, sql } = require('../../config/db');
const { runOsintCheck }   = require('../../utils/osintSearch');

// ─── Auth guard ─────────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
    if (!req.session?.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required.' });
    }
    next();
}

router.use(requireAdmin);

// ─── GET /api/admin/inquiries ────────────────────────────────────────────────
// Query params: status, search, dateFrom, dateTo, page, limit, sort
router.get('/', async (req, res) => {
    const {
        status   = 'ALL',
        search   = '',
        dateFrom = '',
        dateTo   = '',
        page     = 1,
        limit    = 20,
        sort     = 'newest'
    } = req.query;

    const offset   = (parseInt(page) - 1) * parseInt(limit);
    const orderDir = sort === 'oldest' ? 'ASC' : 'DESC';

    try {
        const pool = await poolPromise;

        const buildWhere = (reqObj) => {
            const clauses = ['1=1'];
            if (status !== 'ALL') { clauses.push('i.status = @status'); reqObj.input('status', sql.NVarChar(20), status); }
            if (search)           { clauses.push('(i.first_name LIKE @s OR i.last_name LIKE @s OR i.email LIKE @s OR i.message LIKE @s OR i.phone LIKE @s)'); reqObj.input('s', sql.NVarChar(255), `%${search}%`); }
            if (dateFrom)         { clauses.push('i.created_at >= @df'); reqObj.input('df', sql.DateTime2, new Date(dateFrom)); }
            if (dateTo)           { clauses.push('i.created_at <= @dt'); reqObj.input('dt', sql.DateTime2, new Date(dateTo + 'T23:59:59.999Z')); }
            return clauses.join(' AND ');
        };

        // Count
        const cntReq = pool.request();
        const whereClause = buildWhere(cntReq);
        const cntRes  = await cntReq.query(`SELECT COUNT(*) AS total FROM inquiries i WHERE ${whereClause}`);

        // Data
        const dataReq = pool.request();
        buildWhere(dataReq);
        dataReq.input('offset', sql.Int, offset);
        dataReq.input('lim',    sql.Int, parseInt(limit));

        const dataRes = await dataReq.query(`
            SELECT
                i.id, i.first_name, i.last_name, i.email, i.phone,
                i.preferred_unit, i.message, i.status,
                i.ai_result, i.ai_confidence, i.ai_reasoning,
                i.device_id, i.ip_address, i.user_agent,
                i.message_hash, i.user_hash,
                i.admin_note, i.room_quiz, i.quiz_score, i.created_at,
                i.guardian_phone, i.id_verify_status,
                CASE WHEN i.school_id_path IS NOT NULL THEN 1 ELSE 0 END AS has_school_id,
                CASE WHEN i.govt_id_path   IS NOT NULL THEN 1 ELSE 0 END AS has_govt_id,
                CASE WHEN i.osint_result IS NOT NULL THEN 1 ELSE 0 END AS has_osint,
                i.osint_result::json->>'trustScore'     AS trust_score,
                i.osint_result::json->>'trustLevel'     AS trust_level,
                i.osint_result::json->>'recommendation' AS recommendation
            FROM inquiries i
            WHERE ${whereClause}
            ORDER BY i.created_at ${orderDir}
            LIMIT @lim OFFSET @offset
        `);

        res.json({
            data:  dataRes.recordset || [],
            total: parseInt(cntRes.recordset[0]?.total || 0),
            page:  parseInt(page),
            limit: parseInt(limit)
        });
    } catch (err) {
        console.error('[Admin Inquiries] List error:', err);
        res.status(500).json({ error: 'Failed to load inquiries.' });
    }
});

// ─── GET /api/admin/inquiries/analytics ──────────────────────────────────────
router.get('/analytics', async (req, res) => {
    try {
        const pool = await poolPromise;

        // Status breakdown
        const statusRes = await pool.request().query(`
            SELECT status, COUNT(*) AS cnt
            FROM inquiries
            GROUP BY status
        `);

        // Daily counts (last 30 days)
        const dailyRes = await pool.request().query(`
            SELECT
                CAST(created_at AS DATE) AS day,
                COUNT(*) AS total,
                SUM(CASE WHEN ai_result = 'REAL' THEN 1 ELSE 0 END) AS real_count,
                SUM(CASE WHEN ai_result = 'SPAM' THEN 1 ELSE 0 END) AS spam_count
            FROM inquiries
            WHERE created_at >= NOW() - INTERVAL '30 days'
            GROUP BY CAST(created_at AS DATE)
            ORDER BY day ASC
        `);

        // Top IPs
        const topIpRes = await pool.request().query(`
            SELECT ip_address, COUNT(*) AS cnt,
                MAX(created_at) AS last_seen,
                SUM(CASE WHEN status = 'flagged' OR status = 'suspicious' THEN 1 ELSE 0 END) AS bad_count
            FROM inquiries
            WHERE ip_address IS NOT NULL AND ip_address != ''
            GROUP BY ip_address
            ORDER BY cnt DESC
            LIMIT 10
        `);

        // Device activity
        const deviceRes = await pool.request().query(`
            SELECT device_id, COUNT(*) AS cnt,
                MAX(created_at) AS last_seen
            FROM inquiries
            WHERE device_id IS NOT NULL AND device_id != ''
            GROUP BY device_id
            ORDER BY cnt DESC
            LIMIT 10
        `);

        // Summary totals
        const totalRes = await pool.request().query(`
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'approved'   THEN 1 ELSE 0 END) AS approved,
                SUM(CASE WHEN status = 'flagged'    THEN 1 ELSE 0 END) AS flagged,
                SUM(CASE WHEN status = 'duplicate'  THEN 1 ELSE 0 END) AS duplicate,
                SUM(CASE WHEN status = 'suspicious' THEN 1 ELSE 0 END) AS suspicious,
                SUM(CASE WHEN ai_result = 'SPAM'    THEN 1 ELSE 0 END) AS ai_spam,
                SUM(CASE WHEN ai_result = 'REAL'    THEN 1 ELSE 0 END) AS ai_real
            FROM inquiries
        `);

        // Blocked IPs count
        const blockedRes = await pool.request().query(`SELECT COUNT(*) AS cnt FROM inquiry_blocked_ips`);

        res.json({
            summary:   totalRes.recordset[0] || {},
            byStatus:  statusRes.recordset || [],
            daily:     dailyRes.recordset || [],
            topIps:    topIpRes.recordset || [],
            devices:   deviceRes.recordset || [],
            blockedIps: parseInt(blockedRes.recordset[0]?.cnt || 0)
        });
    } catch (err) {
        console.error('[Admin Inquiries] Analytics error:', err);
        res.status(500).json({ error: 'Failed to load analytics.' });
    }
});

// ─── GET /api/admin/inquiries/:id (single record) ───────────────────────
router.get('/:id(\\d+)', async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('id', sql.Int, id)
            .query(`
                SELECT id, first_name, last_name, email, phone, preferred_unit,
                       message, status, ai_result, ai_confidence, ai_reasoning,
                       device_id, ip_address, user_agent, message_hash, user_hash,
                       admin_note, room_quiz, quiz_score, osint_result, created_at,
                       guardian_phone, school_id_path, govt_id_path, id_analysis, id_verify_status
                FROM inquiries WHERE id = @id
            `);
        if (!result.recordset.length) return res.status(404).json({ error: 'Inquiry not found.' });
        res.json(result.recordset[0]);
    } catch (err) {
        console.error('[Admin Inquiries] Single fetch error:', err);
        res.status(500).json({ error: 'Failed to load inquiry.' });
    }
});

// ─── GET /api/admin/inquiries/osint-missing ─────────────────────────────────
// Returns count and IDs of inquiries that have no OSINT result yet.
router.get('/osint-missing', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT id, first_name, last_name, email, phone, status
            FROM inquiries
            WHERE osint_result IS NULL
            ORDER BY created_at DESC
        `);
        res.json({
            count: result.recordset.length,
            ids:   result.recordset.map(r => r.id),
            items: result.recordset
        });
    } catch (err) {
        console.error('[Admin Inquiries] OSINT missing error:', err);
        res.status(500).json({ error: 'Failed to query missing OSINT.' });
    }
});

// ─── POST /api/admin/inquiries/osint-bulk ────────────────────────────────────
// Runs OSINT for all inquiries missing a result. Uses Server-Sent Events (SSE)
// to stream progress back to the client in real-time.
router.post('/osint-bulk', async (req, res) => {
    try {
        const pool = await poolPromise;

        // Fetch all unscanned inquiries (cap at 50 to avoid abuse)
        const fetchRes = await pool.request().query(`
            SELECT id, first_name, last_name, email, phone, message, status
            FROM inquiries
            WHERE osint_result IS NULL
            ORDER BY created_at DESC
            LIMIT 50
        `);

        const items = fetchRes.recordset;

        if (!items.length) {
            return res.json({ success: true, message: 'All inquiries already scanned.', processed: 0 });
        }

        // Set up SSE headers for live progress streaming
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const sendEvent = (data) => {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        sendEvent({ type: 'start', total: items.length });

        let processed = 0, failed = 0;

        for (const inquiry of items) {
            try {
                sendEvent({
                    type:    'progress',
                    current: processed + 1,
                    total:   items.length,
                    name:    `${inquiry.first_name} ${inquiry.last_name}`,
                    id:      inquiry.id
                });

                const osintResult = await runOsintCheck(inquiry);
                const osintJson   = JSON.stringify(osintResult);

                let newStatus = inquiry.status;
                if (osintResult.trustScore < 30 && inquiry.status === 'approved') {
                    newStatus = 'suspicious';
                }

                await pool.request()
                    .input('id',     sql.Int,                inquiry.id)
                    .input('osint',  sql.NVarChar(sql.MAX),  osintJson)
                    .input('status', sql.NVarChar(20),       newStatus)
                    .query(`UPDATE inquiries SET osint_result = @osint, status = @status WHERE id = @id`);

                processed++;
                sendEvent({
                    type:       'done',
                    id:         inquiry.id,
                    name:       `${inquiry.first_name} ${inquiry.last_name}`,
                    trustScore: osintResult.trustScore,
                    trustLevel: osintResult.trustLevel,
                    recommendation: osintResult.recommendation,
                    statusChanged: newStatus !== inquiry.status
                });

                // Small delay to avoid hammering APIs
                await new Promise(r => setTimeout(r, 800));

            } catch (err) {
                failed++;
                console.error(`[OSINT Bulk] Failed for inquiry #${inquiry.id}:`, err.message);
                sendEvent({ type: 'error', id: inquiry.id, message: err.message });
            }
        }

        sendEvent({ type: 'complete', processed, failed, total: items.length });
        res.end();

    } catch (err) {
        console.error('[Admin Inquiries] Bulk OSINT error:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Bulk OSINT check failed. Please try again.' });
        }
    }
});

// ─── POST /api/admin/inquiries/:id/osint ─────────────────────────────────────
// Runs (or re-runs) the OSINT background check for a specific inquiry.
// Saves results to the DB and returns the result JSON.
router.post('/:id(\\d+)/osint', async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const pool = await poolPromise;

        // Fetch the inquiry
        const fetchRes = await pool.request()
            .input('id', sql.Int, id)
            .query(`SELECT id, first_name, last_name, email, phone, message, status
                    FROM inquiries WHERE id = @id`);

        if (!fetchRes.recordset.length) {
            return res.status(404).json({ error: 'Inquiry not found.' });
        }

        const inquiry = fetchRes.recordset[0];

        // Run the full OSINT check
        const osintResult = await runOsintCheck(inquiry);
        const osintJson   = JSON.stringify(osintResult);

        // Determine if we need to auto-flag (trust score < 30)
        let newStatus = inquiry.status;
        if (osintResult.trustScore < 30 && inquiry.status === 'approved') {
            newStatus = 'suspicious';
            console.warn(`[OSINT] Auto-flagging inquiry #${id} as suspicious (trust score: ${osintResult.trustScore})`);
        }

        // Persist result + any status change
        await pool.request()
            .input('id',     sql.Int,             id)
            .input('osint',  sql.NVarChar(sql.MAX), osintJson)
            .input('status', sql.NVarChar(20),     newStatus)
            .query(`UPDATE inquiries SET osint_result = @osint, status = @status WHERE id = @id`);

        return res.json({
            success:     true,
            osintResult,
            statusChanged: newStatus !== inquiry.status,
            newStatus
        });
    } catch (err) {
        console.error('[Admin Inquiries] OSINT error:', err);
        return res.status(500).json({ error: 'OSINT check failed. Please try again.' });
    }
});

// ─── PATCH /api/admin/inquiries/:id/status ────────────────────────────────────
router.patch('/:id/status', async (req, res) => {
    const { id }     = req.params;
    const { status, admin_note } = req.body;
    const allowed = ['approved', 'flagged', 'duplicate', 'suspicious'];

    if (!allowed.includes(status)) {
        return res.status(422).json({ error: 'Invalid status value.' });
    }

    try {
        const pool = await poolPromise;
        await pool.request()
            .input('id',   sql.Int,          parseInt(id))
            .input('stat', sql.NVarChar(20), status)
            .input('note', sql.NVarChar(500), admin_note || null)
            .query(`UPDATE inquiries SET status = @stat, admin_note = @note WHERE id = @id`);

        res.json({ success: true, message: `Inquiry #${id} updated to "${status}".` });
    } catch (err) {
        console.error('[Admin Inquiries] Status update error:', err);
        res.status(500).json({ error: 'Failed to update status.' });
    }
});

// ─── DELETE /api/admin/inquiries/:id ────────────────────────────────────────
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('id', sql.Int, parseInt(id))
            .query('DELETE FROM inquiries WHERE id = @id');
        res.json({ success: true, message: `Inquiry #${id} deleted.` });
    } catch (err) {
        console.error('[Admin Inquiries] Delete error:', err);
        res.status(500).json({ error: 'Failed to delete inquiry.' });
    }
});

// ─── POST /api/admin/inquiries/block-ip ──────────────────────────────────────
router.post('/block-ip', async (req, res) => {
    const { ip_address, reason } = req.body;
    if (!ip_address) return res.status(422).json({ error: 'IP address required.' });

    try {
        const pool = await poolPromise;
        await pool.request()
            .input('ip',     sql.NVarChar(45),  ip_address)
            .input('reason', sql.NVarChar(255), reason || 'Blocked by admin')
            .query(`
                INSERT INTO inquiry_blocked_ips (ip_address, reason, blocked_by)
                VALUES (@ip, @reason, 'admin')
                ON CONFLICT (ip_address) DO UPDATE SET reason = @reason
            `);
        res.json({ success: true, message: `IP ${ip_address} has been blocked.` });
    } catch (err) {
        console.error('[Admin Inquiries] Block IP error:', err);
        res.status(500).json({ error: 'Failed to block IP.' });
    }
});

// ─── DELETE /api/admin/inquiries/unblock-ip ─────────────────────────────────
router.delete('/unblock-ip/:ip', async (req, res) => {
    const ip = decodeURIComponent(req.params.ip);
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('ip', sql.NVarChar(45), ip)
            .query('DELETE FROM inquiry_blocked_ips WHERE ip_address = @ip');
        res.json({ success: true, message: `IP ${ip} unblocked.` });
    } catch (err) {
        console.error('[Admin Inquiries] Unblock error:', err);
        res.status(500).json({ error: 'Failed to unblock IP.' });
    }
});

module.exports = router;
