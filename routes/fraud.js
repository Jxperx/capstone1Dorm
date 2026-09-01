/**
 * routes/fraud.js
 * Admin-facing routes for the Fraud Detection Dashboard:
 * - GET /api/admin/fraud          → paginated fraud payment list
 * - GET /api/admin/fraud/analytics → summary stats
 * - GET /api/admin/fraud/:id      → single payment detail
 * - POST /api/admin/fraud/:id/decision → manual approve/block
 * - POST /api/admin/fraud/:id/analyze  → re-run fraud analysis
 */

const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../config/db');
const { analyzePayment } = require('../utils/fraudEngine');

// ─── Middleware: Admin only ───────────────────────────────────
function requireAdmin(req, res, next) {
    if (!req.session?.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required.' });
    }
    next();
}

// ─── GET /api/admin/fraud/analytics ──────────────────────────
router.get('/analytics', requireAdmin, async (req, res) => {
    try {
        const pool = await poolPromise;

        const result = await pool.request().query(`
            SELECT
                COUNT(fs.id)                                          AS total_analyzed,
                COUNT(CASE WHEN fs.risk_level IN ('HIGH','CRITICAL') THEN 1 END) AS high_risk_count,
                COUNT(CASE WHEN fs.decision = 'BLOCKED' THEN 1 END)  AS blocked_count,
                COUNT(CASE WHEN fs.decision = 'PENDING_REVIEW' THEN 1 END) AS pending_review_count,
                COUNT(CASE WHEN fs.decision IN ('AUTO_APPROVED','MANUAL_APPROVED') THEN 1 END) AS approved_count,
                COUNT(CASE WHEN fs.risk_level = 'SAFE'     THEN 1 END) AS safe_count,
                COUNT(CASE WHEN fs.risk_level = 'LOW'      THEN 1 END) AS low_count,
                COUNT(CASE WHEN fs.risk_level = 'MEDIUM'   THEN 1 END) AS medium_count,
                COUNT(CASE WHEN fs.risk_level = 'HIGH'     THEN 1 END) AS high_count,
                COUNT(CASE WHEN fs.risk_level = 'CRITICAL' THEN 1 END) AS critical_count
            FROM fraud_scores fs
        `);

        const flagsResult = await pool.request().query(`
            SELECT TOP 10 flag_code, COUNT(*) as occurrences
            FROM fraud_flags
            GROUP BY flag_code
            ORDER BY occurrences DESC
        `);

        res.json({
            summary: result.recordset[0],
            topFraudReasons: flagsResult.recordset
        });
    } catch (err) {
        console.error('[Fraud Analytics Error]', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// ─── GET /api/admin/fraud ─────────────────────────────────────
// Paginated list with filters
router.get('/', requireAdmin, async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const { riskLevel, method, flagged, dateFrom, dateTo, search } = req.query;

    try {
        const pool = await poolPromise;

        // Build WHERE clause using only named parameters — no string interpolation of user input
        let where = 'WHERE 1=1';
        const filterParams = {}; // { paramName: { type, value } }

        if (riskLevel && riskLevel !== 'ALL') {
            where += ' AND fs.risk_level = @riskLevel';
            filterParams.riskLevel = { type: sql.NVarChar(20), value: riskLevel.toUpperCase() };
        }
        if (method && method !== 'ALL') {
            where += ' AND p.payment_method = @method';
            filterParams.method = { type: sql.NVarChar(50), value: method };
        }
        // flagged is a boolean flag — no user value is injected; EXISTS subquery is static
        if (flagged === 'true') {
            where += ' AND (SELECT COUNT(*) FROM fraud_flags ff WHERE ff.payment_id = p.id) > 0';
        }
        if (dateFrom) {
            where += ' AND p.created_at >= @dateFrom';
            filterParams.dateFrom = { type: sql.DateTime2, value: new Date(dateFrom) };
        }
        if (dateTo) {
            // Use start-of-next-day so the whole dateTo day is included
            const toDate = new Date(dateTo);
            toDate.setDate(toDate.getDate() + 1);
            where += ' AND p.created_at < @dateTo';
            filterParams.dateTo = { type: sql.DateTime2, value: toDate };
        }
        if (search) {
            where += ' AND (u.full_name LIKE @search OR p.reference_number LIKE @search)';
            filterParams.search = { type: sql.NVarChar(255), value: `%${search}%` };
        }

        // Helper: attach all filter params to a request object
        function bindFilters(req) {
            for (const [name, param] of Object.entries(filterParams)) {
                req.input(name, param.type, param.value);
            }
        }

        const query = `
            SELECT
                p.id                    AS payment_id,
                p.amount                AS amount_paid,
                p.expected_amount,
                p.payment_method,
                p.reference_number,
                p.gateway_transaction_id,
                p.gateway_status,
                p.status                AS payment_status,
                p.created_at,
                p.proof_image_url,
                p.booking_id,
                u.full_name             AS tenant_name,
                u.email                 AS tenant_email,
                t.id                    AS tenant_id,
                r.room_number,
                fs.risk_score,
                fs.risk_level,
                fs.decision,
                fs.analyzed_at,
                fs.admin_note,
                pr.sha256_hash,
                pr.phash_value,
                pr.ocr_raw_text,
                pr.ocr_ref_number,
                pr.ocr_amount,
                pr.ocr_timestamp,
                pr.file_path            AS receipt_path,
                (SELECT STRING_AGG(ff.flag_code, ', ') FROM fraud_flags ff WHERE ff.payment_id = p.id) AS flags
            FROM payments p
            LEFT JOIN tenants t ON p.tenant_id = t.id
            LEFT JOIN users u ON t.user_id = u.id
            LEFT JOIN rooms r ON t.room_id = r.id
            LEFT JOIN fraud_scores fs ON p.id = fs.payment_id
            LEFT JOIN LATERAL (
                SELECT sha256_hash, phash_value, ocr_raw_text, ocr_ref_number, ocr_amount, ocr_timestamp, file_path
                FROM payment_receipts WHERE payment_id = p.id ORDER BY uploaded_at DESC LIMIT 1
            ) pr ON TRUE
            ${where}
            ORDER BY p.created_at DESC
            LIMIT ${limit} OFFSET ${offset}
        `;

        const countQuery = `
            SELECT COUNT(*) as total
            FROM payments p
            LEFT JOIN tenants t ON p.tenant_id = t.id
            LEFT JOIN users u ON t.user_id = u.id
            LEFT JOIN fraud_scores fs ON p.id = fs.payment_id
            ${where}
        `;

        // Bind filter params to each request separately (mssql requests are not reusable)
        const dataReq = pool.request();
        bindFilters(dataReq);
        const countReq = pool.request();
        bindFilters(countReq);

        const [dataResult, countResult] = await Promise.all([
            dataReq.query(query),
            countReq.query(countQuery)
        ]);

        res.json({
            data: dataResult.recordset,
            total: countResult.recordset[0].total,
            page,
            limit
        });
    } catch (err) {
        console.error('[Fraud List Error]', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// ─── GET /api/admin/fraud/:id ─────────────────────────────────
router.get('/:id', requireAdmin, async (req, res) => {
    const paymentId = parseInt(req.params.id);
    try {
        const pool = await poolPromise;

        const payResult = await pool.request()
            .input('id', sql.Int, paymentId)
            .query(`
                SELECT
                    p.*,
                    u.full_name AS tenant_name, u.email AS tenant_email, u.phone_number,
                    t.id AS tenant_id, r.room_number,
                    fs.risk_score, fs.risk_level, fs.decision, fs.analyzed_at, fs.admin_note
                FROM payments p
                LEFT JOIN tenants t ON p.tenant_id = t.id
                LEFT JOIN users u ON t.user_id = u.id
                LEFT JOIN rooms r ON t.room_id = r.id
                LEFT JOIN fraud_scores fs ON p.id = fs.payment_id
                WHERE p.id = @id
            `);

        if (!payResult.recordset.length) return res.status(404).json({ error: 'Payment not found.' });

        const receiptResult = await pool.request()
            .input('pid', sql.Int, paymentId)
            .query('SELECT * FROM payment_receipts WHERE payment_id = @pid ORDER BY uploaded_at DESC');

        const flagsResult = await pool.request()
            .input('pid', sql.Int, paymentId)
            .query('SELECT * FROM fraud_flags WHERE payment_id = @pid ORDER BY created_at DESC');

        const attemptsResult = await pool.request()
            .input('pid', sql.Int, paymentId)
            .query('SELECT TOP 10 * FROM payment_attempt_logs WHERE payment_id = @pid ORDER BY attempted_at DESC');

        const tenantId = payResult.recordset[0].tenant_id;
        const deviceResult = tenantId ? await pool.request()
            .input('tid', sql.Int, tenantId)
            .query(`
                SELECT df.*, 
                       (SELECT COUNT(DISTINCT tenant_id) FROM device_fingerprints WHERE device_hash = df.device_hash) AS shared_by_count
                FROM device_fingerprints df
                WHERE df.tenant_id = @tid
                ORDER BY df.last_seen DESC
            `) : { recordset: [] };

        res.json({
            payment: payResult.recordset[0],
            receipts: receiptResult.recordset,
            flags: flagsResult.recordset,
            attempts: attemptsResult.recordset,
            devices: deviceResult.recordset
        });
    } catch (err) {
        console.error('[Fraud Detail Error]', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// ─── POST /api/admin/fraud/:id/decision ──────────────────────
router.post('/:id/decision', requireAdmin, async (req, res) => {
    const paymentId = parseInt(req.params.id);
    const { decision, note } = req.body;
    const allowed = ['MANUAL_APPROVED', 'MANUAL_BLOCKED', 'MANUAL_PARTIAL'];

    if (!allowed.includes(decision)) {
        return res.status(400).json({ error: `Decision must be one of: ${allowed.join(', ')}` });
    }

    try {
        const pool = await poolPromise;
        const adminName = req.session.user.email || 'Admin';

        // Load payment details to get tenant user_id, amounts for balance calculation & notification
        const payRes = await pool.request()
            .input('pid', sql.Int, paymentId)
            .query(`
                SELECT p.*, t.user_id AS tenant_user_id, u.full_name AS tenant_name
                FROM payments p
                LEFT JOIN tenants t ON p.tenant_id = t.id
                LEFT JOIN users u ON t.user_id = u.id
                WHERE p.id = @pid
            `);
        
        const payment = payRes.recordset[0] || {};
        const tenantUserId = payment.tenant_user_id || payment.tenant_id;

        // Ensure database check constraints permit 'MANUAL_PARTIAL' and 'partially_paid'
        await pool.request().query(`
            ALTER TABLE fraud_scores DROP CONSTRAINT IF EXISTS fraud_scores_decision_check;
            ALTER TABLE fraud_scores ADD CONSTRAINT fraud_scores_decision_check CHECK (decision IN ('AUTO_APPROVED', 'AUTO_BLOCKED', 'FLAGGED', 'MANUAL_APPROVED', 'MANUAL_BLOCKED', 'MANUAL_PARTIAL'));
            ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
            ALTER TABLE payments ADD CONSTRAINT payments_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'partially_paid'));
        `).catch(() => {});

        await pool.request()
            .input('pid', sql.Int, paymentId)
            .input('dec', sql.NVarChar, decision)
            .input('note', sql.NVarChar, note || null)
            .input('admin', sql.NVarChar, adminName)
            .query(`
                INSERT INTO fraud_scores (payment_id, risk_score, risk_level, decision, admin_note, reviewed_by)
                VALUES (@pid, 0, 'SAFE', @dec, @note, @admin)
                ON CONFLICT (payment_id) DO UPDATE 
                SET decision = @dec, admin_note = @note, reviewed_by = @admin
            `);

        // Sync payment status
        let payStatus = 'approved';
        if (decision === 'MANUAL_BLOCKED') payStatus = 'rejected';
        if (decision === 'MANUAL_PARTIAL') payStatus = 'partially_paid';

        await pool.request()
            .input('pid', sql.Int, paymentId)
            .input('st', sql.NVarChar, payStatus)
            .query('UPDATE payments SET status = @st WHERE id = @pid');

        // If Partial Payment accepted, send automated Live Chat notification to tenant
        if (decision === 'MANUAL_PARTIAL' && tenantUserId) {
            const paid = parseFloat(payment.amount || 0);
            const expected = parseFloat(payment.expected_amount || paid);
            const remaining = Math.max(0, expected - paid);

            const paidStr = paid.toLocaleString('en-US', { minimumFractionDigits: 2 });
            const remStr = remaining.toLocaleString('en-US', { minimumFractionDigits: 2 });

            const chatMsg = `🤖 System Notification: Your payment of ₱${paidStr} has been accepted as a Partial Payment. Remaining Balance: ₱${remStr}. Please log in to settle your remaining balance.`;
            const sessionId = `tenant_${tenantUserId}`;

            await pool.request()
                .input('sid', sql.NVarChar, sessionId)
                .input('tid', sql.Int, tenantUserId)
                .input('sender', sql.NVarChar, 'system')
                .input('msg', sql.NVarChar, chatMsg)
                .query(`
                    INSERT INTO live_chat_messages (session_id, tenant_id, sender, message)
                    VALUES (@sid, @tid, @sender, @msg)
                `).catch(err => console.warn('[Auto Live Chat Notice Error]', err.message));
        }

        res.json({ success: true, decision, paymentStatus: payStatus });
    } catch (err) {
        console.error('[Fraud Decision Error]', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// ─── POST /api/admin/fraud/:id/analyze ───────────────────────
router.post('/:id/analyze', requireAdmin, async (req, res) => {
    const paymentId = parseInt(req.params.id);
    try {
        const result = await analyzePayment(paymentId);
        res.json({ success: true, ...result });
    } catch (err) {
        console.error('[Re-analyze Error]', err);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

module.exports = router;
