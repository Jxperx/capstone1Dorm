'use strict';
/**
 * routes/admin/visits.js
 * Admin CRUD for site visit requests.
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

// ─── GET /api/admin/visits ────────────────────────────────────────────────────
router.get('/', async (req, res) => {
    const { status = 'ALL', page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    try {
        const pool = await poolPromise;

        let whereClause = '1=1';
        const req1 = pool.request().input('offset', sql.Int, offset).input('limit', sql.Int, parseInt(limit));
        const req2 = pool.request();

        if (status !== 'ALL') {
            whereClause = 'v.status = @status';
            req1.input('status', sql.NVarChar(20), status);
            req2.input('status', sql.NVarChar(20), status);
        }

        const [cntRes, dataRes] = await Promise.all([
            req2.query(`SELECT COUNT(*) AS total FROM site_visit_requests v WHERE ${whereClause}`),
            req1.query(`
                SELECT v.*, r.room_number, r.room_type
                FROM site_visit_requests v
                LEFT JOIN rooms r ON r.id = v.unit_id
                WHERE ${whereClause}
                ORDER BY v.visit_date ASC, v.created_at DESC
                OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
            `)
        ]);

        return res.json({
            total: cntRes.recordset[0].total,
            visits: dataRes.recordset
        });
    } catch (err) {
        console.error('[Admin Visits] List error:', err.message);
        return res.status(500).json({ error: 'Failed to fetch visits.' });
    }
});

// ─── PATCH /api/admin/visits/:id/status ───────────────────────────────────────
router.patch('/:id/status', async (req, res) => {
    const id     = parseInt(req.params.id, 10);
    const status = req.body.status; // 'confirmed' | 'cancelled'

    if (!['confirmed', 'cancelled'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status.' });
    }

    try {
        const pool = await poolPromise;

        const visitRes = await pool.request()
            .input('id', sql.Int, id)
            .query('SELECT * FROM site_visit_requests WHERE id = @id');

        const visit = visitRes.recordset[0];
        if (!visit) return res.status(404).json({ error: 'Visit not found.' });

        await pool.request()
            .input('id',     sql.Int,          id)
            .input('status', sql.NVarChar(20), status)
            .query('UPDATE site_visit_requests SET status = @status WHERE id = @id');

        // Send confirmation email to visitor if confirmed and email is available
        if (status === 'confirmed' && visit.email && process.env.EMAIL_USER) {
            const slotLabel = {
                morning:        'Morning (9:00 AM – 11:00 AM)',
                afternoon:      'Afternoon (1:00 PM – 3:00 PM)',
                late_afternoon: 'Late Afternoon (3:00 PM – 5:00 PM)'
            }[visit.time_slot] || visit.time_slot;

            const dateStr = new Date(visit.visit_date).toDateString();

            transporter.sendMail({
                from: `"EliteStay" <${process.env.EMAIL_USER}>`,
                to:   visit.email,
                subject: '✅ Your Site Visit is Confirmed — EliteStay',
                html: `
                <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;padding:30px;border:1px solid #eee;">
                    <h2 style="color:#c5a059;font-family:serif">EliteStay — Visit Confirmed!</h2>
                    <p>Hello <strong>${visit.name}</strong>,</p>
                    <p>Your in-person site visit has been <strong style="color:#27ae60">confirmed</strong>.</p>
                    <div style="background:#f9f9f9;padding:20px;border-radius:8px;margin:20px 0;">
                        <p style="margin:4px 0"><strong>📅 Date:</strong> ${dateStr}</p>
                        <p style="margin:4px 0"><strong>⏰ Time Slot:</strong> ${slotLabel}</p>
                    </div>
                    <p>Please bring a valid ID when you visit. If you need to reschedule, please contact us as soon as possible.</p>
                    <p style="margin-top:30px;font-size:13px;color:#999;">
                        © ${new Date().getFullYear()} EliteStay Management. All rights reserved.
                    </p>
                </div>`
            }).catch(e => console.error('[Admin Visits] Confirmation email error:', e.message));
        }

        return res.json({ success: true, status });
    } catch (err) {
        console.error('[Admin Visits] Status update error:', err.message);
        return res.status(500).json({ error: 'Failed to update visit status.' });
    }
});

module.exports = router;
