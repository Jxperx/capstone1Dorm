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

// Admin - Get All Maintenance Requests (sorted by AI priority, then oldest first)
router.get('/', async (req, res) => {
    try {
        const pool = await poolPromise;
        const query = `
            SELECT
                m.id,
                m.title,
                m.description,
                m.status,
                m.photo_url,       -- FIX: column is photo_url (not image_url) per INSERT in routes/maintenance.js
                m.reported_at,
                m.resolved_at,
                -- AI columns
                m.ai_category,
                m.ai_priority,
                m.ai_urgency,
                m.ai_department,
                m.ai_summary,
                m.ai_keywords,
                m.ai_confidence,
                m.ai_is_emergency,
                -- Tenant info
                u.full_name,
                r.room_number
            FROM maintenance_requests m
            JOIN tenants t       ON m.tenant_id = t.id
            JOIN users   u       ON t.user_id   = u.id
            LEFT JOIN rooms r    ON t.room_id   = r.id
            WHERE m.status != 'resolved'
            ORDER BY
                -- AI Priority sort: Emergency → High → Medium → Routine → unclassified
                CASE m.ai_priority
                    WHEN 'Emergency' THEN 1
                    WHEN 'High'      THEN 2
                    WHEN 'Medium'    THEN 3
                    WHEN 'Routine'   THEN 4
                    ELSE 5
                END,
                -- Emergency flag as tiebreaker (1 before 0)
                ISNULL(m.ai_is_emergency, 0) DESC,
                -- Oldest first within same priority
                m.reported_at ASC
        `;
        const result = await pool.request().query(query);
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ── Auto-migration: ensure admin_note column exists ──
let adminNoteColumnReady = false;
async function ensureAdminNoteColumn() {
    if (adminNoteColumnReady) return;
    try {
        const pool = await poolPromise;
        await pool.request().query(`
            IF COL_LENGTH('maintenance_requests', 'admin_note') IS NULL
                ALTER TABLE maintenance_requests ADD admin_note NVARCHAR(500) NULL;
        `);
        adminNoteColumnReady = true;
    } catch (err) {
        console.error('[Maintenance] admin_note migration error:', err.message);
    }
}

// Admin - Update Maintenance Status (with admin note + email notification)
router.post('/:id/update', async (req, res) => {
    const { status, admin_note } = req.body;
    const id = req.params.id;
    
    try {
        const pool = await poolPromise;

        // Ensure admin_note column exists
        await ensureAdminNoteColumn();

        // Build dynamic UPDATE query
        const resolvedClause = status === 'resolved' ? ', resolved_at = GETDATE()' : '';
        await pool.request()
            .input('id', sql.Int, id)
            .input('status', sql.NVarChar, status)
            .input('admin_note', sql.NVarChar, admin_note || null)
            .query(`UPDATE maintenance_requests SET status = @status, admin_note = @admin_note${resolvedClause} WHERE id = @id`);

        // Fetch tenant info for email notification
        const tenantInfo = await pool.request()
            .input('mid', sql.Int, id)
            .query(`
                SELECT u.email, u.full_name, m.title
                FROM maintenance_requests m
                JOIN tenants t ON m.tenant_id = t.id
                JOIN users u ON t.user_id = u.id
                WHERE m.id = @mid
            `);

        // Send email notification asynchronously (non-blocking)
        if (tenantInfo.recordset.length > 0) {
            const tenant = tenantInfo.recordset[0];
            const transporter = require('../../utils/email');
            const statusLabel = status.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
            const statusColor = status === 'resolved' ? '#27ae60' : status === 'in_progress' ? '#3498db' : '#f39c12';
            const noteHtml = admin_note
                ? `<div style="margin-top:16px;padding:12px 16px;background:#f8f9fa;border-left:4px solid #c5a059;border-radius:4px;">
                     <strong style="font-size:0.85rem;color:#555;">Admin Note:</strong>
                     <p style="margin:4px 0 0;color:#333;font-size:0.9rem;">${admin_note}</p>
                   </div>`
                : '';

            const mailOptions = {
                from: `"EliteStay Management" <${process.env.EMAIL_USER}>`,
                to: tenant.email,
                subject: `Maintenance Update: ${tenant.title} — ${statusLabel}`,
                html: `
                    <div style="font-family:'Inter',Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
                        <div style="text-align:center;margin-bottom:20px;">
                            <h2 style="color:#1a1a2e;margin:0;">🔧 Maintenance Update</h2>
                        </div>
                        <p style="color:#333;">Hi <strong>${tenant.full_name}</strong>,</p>
                        <p style="color:#555;">Your maintenance request has been updated:</p>
                        <div style="text-align:center;margin:20px 0;">
                            <div style="font-size:0.85rem;color:#888;margin-bottom:6px;">${tenant.title}</div>
                            <span style="display:inline-block;padding:8px 24px;background:${statusColor};color:#fff;border-radius:20px;font-weight:600;font-size:0.95rem;letter-spacing:0.03em;">
                                ${statusLabel}
                            </span>
                        </div>
                        ${noteHtml}
                        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
                        <p style="color:#888;font-size:0.8rem;text-align:center;">EliteStay Boarding House Management</p>
                    </div>
                `
            };

            transporter.sendMail(mailOptions).catch(err => {
                console.error('[Maintenance] Email notification failed:', err.message);
            });
        }

        res.json({ message: `Status updated to "${status.replace('_', ' ')}"${admin_note ? ' with note' : ''}` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

module.exports = router;
