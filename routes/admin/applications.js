'use strict';
/**
 * routes/admin/applications.js
 * Admin endpoints for managing direct rental applications (type = 'rental_application').
 */

const express = require('express');
const router  = express.Router();
const { poolPromise, sql } = require('../../config/db');
const transporter = require('../../utils/email');

function requireAdmin(req, res, next) {
    if (!req.session?.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required.' });
    }
    next();
}
router.use(requireAdmin);

// ─── GET /api/admin/applications ──────────────────────────────────────────────
router.get('/', async (req, res) => {
    const { status = 'ALL', page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    try {
        const pool = await poolPromise;

        let whereClause = `i.type = 'rental_application'`;
        const req1 = pool.request().input('offset', sql.Int, offset).input('limit', sql.Int, parseInt(limit));
        const req2 = pool.request();

        if (status !== 'ALL') {
            whereClause += ' AND i.status = @status';
            req1.input('status', sql.NVarChar(20), status);
            req2.input('status', sql.NVarChar(20), status);
        }

        const [cntRes, dataRes] = await Promise.all([
            req2.query(`SELECT COUNT(*) AS total FROM inquiries i WHERE ${whereClause}`),
            req1.query(`
                SELECT i.id, i.first_name, i.last_name, i.email, i.phone,
                       i.preferred_unit AS unit_id, i.move_in_date,
                       i.intended_stay_months, i.source, i.status,
                       i.school_id_path, i.govt_id_path, i.id_verify_status,
                       i.created_at, i.message,
                       r.room_number, r.room_type
                FROM inquiries i
                LEFT JOIN rooms r ON r.id = TRY_CAST(i.preferred_unit AS INT)
                WHERE ${whereClause}
                ORDER BY i.created_at DESC
                OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
            `)
        ]);

        return res.json({ total: cntRes.recordset[0].total, applications: dataRes.recordset });
    } catch (err) {
        console.error('[Admin Applications] List error:', err.message);
        return res.status(500).json({ error: 'Failed to fetch applications.' });
    }
});

// ─── PATCH /api/admin/applications/:id/status ─────────────────────────────────
router.patch('/:id/status', async (req, res) => {
    const id     = parseInt(req.params.id, 10);
    const status = req.body.status; // 'approved' | 'rejected'

    if (!['approved', 'rejected'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status. Use approved or rejected.' });
    }

    try {
        const pool = await poolPromise;

        const appRes = await pool.request()
            .input('id', sql.Int, id)
            .query(`SELECT * FROM inquiries WHERE id = @id AND type = 'rental_application'`);

        const app = appRes.recordset[0];
        if (!app) return res.status(404).json({ error: 'Application not found.' });

        await pool.request()
            .input('id',     sql.Int,          id)
            .input('status', sql.NVarChar(20), status)
            .query(`UPDATE inquiries SET status = @status WHERE id = @id`);

        // ── Send result email to applicant ────────────────────────────────────
        if (app.email && process.env.EMAIL_USER) {
            const fullName    = `${app.first_name} ${app.last_name}`;
            const moveInDate  = app.move_in_date ? new Date(app.move_in_date).toDateString() : 'TBD';
            const stayMonths  = app.intended_stay_months || '—';

            const isApproved = status === 'approved';
            const subject = isApproved
                ? '🎉 Your Rental Application is Approved — EliteStay'
                : '❌ Your Rental Application — EliteStay Update';

            const bodyHtml = isApproved ? `
                <h2 style="color:#c5a059;font-family:serif">Congratulations, ${app.first_name}! 🎉</h2>
                <p>Your rental application for <strong>Unit #${app.preferred_unit}</strong> has been <strong style="color:#27ae60">approved</strong>.</p>
                <div style="background:#f9f9f9;padding:20px;border-radius:8px;margin:20px 0;">
                    <p style="margin:4px 0"><strong>📅 Move-In Date:</strong> ${moveInDate}</p>
                    <p style="margin:4px 0"><strong>📆 Intended Stay:</strong> ${stayMonths} month(s)</p>
                </div>
                <p>Our team will reach out to you shortly to finalize the contract and walk you through the next steps.</p>
                <p>Please prepare the following when you come in:</p>
                <ul>
                    <li>Valid Government-Issued ID</li>
                    <li>School ID (if applicable)</li>
                    <li>Initial deposit / reservation fee</li>
                </ul>
            ` : `
                <h2 style="color:#c5a059;font-family:serif">Rental Application Update</h2>
                <p>Hello <strong>${fullName}</strong>,</p>
                <p>Unfortunately, we are unable to proceed with your rental application for Unit #${app.preferred_unit} at this time.</p>
                <p>If you have questions or would like to explore other available units, please don't hesitate to contact us or visit our website.</p>
            `;

            transporter.sendMail({
                from: `"EliteStay" <${process.env.EMAIL_USER}>`,
                to:   app.email,
                subject,
                html: `
                <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;padding:30px;border:1px solid #eee;">
                    ${bodyHtml}
                    <p style="margin-top:30px;font-size:13px;color:#999;">
                        © ${new Date().getFullYear()} EliteStay Management. All rights reserved.
                    </p>
                </div>`
            }).catch(e => console.error('[Admin Applications] Email error:', e.message));
        }

        return res.json({ success: true, status });
    } catch (err) {
        console.error('[Admin Applications] Status error:', err.message);
        return res.status(500).json({ error: 'Failed to update application.' });
    }
});

module.exports = router;
