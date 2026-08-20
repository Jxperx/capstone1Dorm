'use strict';
/**
 * routes/visits.js
 * Public endpoint for scheduling in-person site visits.
 * - Monday (1) and Tuesday (2) are never available
 * - Max 3 bookings per time slot per day
 * - No login required
 */

const express = require('express');
const router  = express.Router();
const { poolPromise, sql } = require('../config/db');
const transporter = require('../utils/email');

const TIME_SLOTS = ['morning', 'afternoon', 'late_afternoon'];
const MAX_PER_SLOT = 3;
const BLOCKED_DAYS = [1, 2]; // Sunday=0, Monday=1, Tuesday=2

function sanitize(val, max = 200) {
    if (typeof val !== 'string') return '';
    return val.replace(/<[^>]*>/g, '').trim().slice(0, max);
}

function isValidEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e); }
function isValidPhone(p) { return /^\+?[\d\s\-(). ]{7,20}$/.test(p); }

// ─── GET /api/visits/availability/:unitId ─────────────────────────────────────
// Returns booked dates { date, time_slot, remaining } for calendar display
router.get('/availability/:unitId', async (req, res) => {
    const unitId = parseInt(req.params.unitId, 10);
    if (!unitId) return res.status(400).json({ error: 'Invalid unit ID.' });

    try {
        const pool = await poolPromise;

        // Fetch upcoming confirmed/pending visits for this unit
        const result = await pool.request()
            .input('uid', sql.Int, unitId)
            .query(`
                SELECT visit_date, time_slot, COUNT(*) AS booked
                FROM site_visit_requests
                WHERE unit_id = @uid
                  AND status IN ('pending','confirmed')
                  AND visit_date >= CAST(GETDATE() AS DATE)
                GROUP BY visit_date, time_slot
            `);

        // Build a map: { 'YYYY-MM-DD': { morning: 2, afternoon: 1, ... } }
        const slotMap = {};
        for (const row of result.recordset) {
            const d = new Date(row.visit_date).toISOString().split('T')[0];
            if (!slotMap[d]) slotMap[d] = {};
            slotMap[d][row.time_slot] = row.booked;
        }

        // Build response: fully-booked dates and per-slot counts
        const bookedDates = Object.entries(slotMap).map(([date, slots]) => {
            const totalBooked = Object.values(slots).reduce((a, b) => a + b, 0);
            return { date, slots, totalBooked, fullyBooked: totalBooked >= MAX_PER_SLOT * TIME_SLOTS.length };
        });

        return res.json({ success: true, bookedDates, maxPerSlot: MAX_PER_SLOT });
    } catch (err) {
        console.error('[Visits] Availability error:', err.message);
        return res.status(500).json({ error: 'Failed to fetch availability.' });
    }
});

// ─── POST /api/visits/schedule ───────────────────────────────────────────────
router.post('/schedule', async (req, res) => {
    const { unit_id, visit_date, time_slot, name, email, phone, notes } = req.body;

    // ── Validate ──────────────────────────────────────────────────────────────
    const errors = [];

    const unitId    = parseInt(unit_id, 10);
    const cleanName = sanitize(name, 100);
    const cleanEmail = sanitize(email, 255).toLowerCase();
    const cleanPhone = sanitize(phone, 30);
    const cleanNotes = sanitize(notes, 500);
    const cleanSlot  = sanitize(time_slot, 20);

    if (!unitId)                            errors.push('Unit ID is required.');
    if (!cleanName)                         errors.push('Your name is required.');
    if (cleanEmail && !isValidEmail(cleanEmail)) errors.push('Please enter a valid email address.');
    if (!cleanPhone || !isValidPhone(cleanPhone)) errors.push('A valid phone number is required.');
    if (!TIME_SLOTS.includes(cleanSlot))    errors.push('Please select a valid time slot.');

    // Date validation
    let parsedDate;
    if (!visit_date) {
        errors.push('Please select a visit date.');
    } else {
        parsedDate = new Date(visit_date);
        const today = new Date(); today.setHours(0, 0, 0, 0);
        if (isNaN(parsedDate.getTime()))         errors.push('Invalid date.');
        else if (parsedDate < today)              errors.push('Visit date must be in the future.');
        else if (BLOCKED_DAYS.includes(parsedDate.getDay())) {
            errors.push('Monday and Tuesday are not available for visits. Please choose another day.');
        }
    }

    if (errors.length > 0) return res.status(422).json({ success: false, errors });

    try {
        const pool = await poolPromise;
        const dateStr = parsedDate.toISOString().split('T')[0];

        // ── Slot limit check ────────────────────────────────────────────────
        const slotCheck = await pool.request()
            .input('uid',  sql.Int,          unitId)
            .input('date', sql.Date,         dateStr)
            .input('slot', sql.NVarChar(20), cleanSlot)
            .query(`
                SELECT COUNT(*) AS cnt
                FROM site_visit_requests
                WHERE unit_id    = @uid
                  AND visit_date = @date
                  AND time_slot  = @slot
                  AND status IN ('pending','confirmed')
            `);

        if ((slotCheck.recordset[0]?.cnt || 0) >= MAX_PER_SLOT) {
            return res.status(409).json({
                success: false,
                errors: ['This time slot is fully booked. Please choose a different slot or date.']
            });
        }

        // ── Insert ──────────────────────────────────────────────────────────
        await pool.request()
            .input('uid',   sql.Int,          unitId)
            .input('date',  sql.Date,         dateStr)
            .input('slot',  sql.NVarChar(20), cleanSlot)
            .input('name',  sql.NVarChar(100), cleanName)
            .input('email', sql.NVarChar(255), cleanEmail || null)
            .input('phone', sql.NVarChar(30),  cleanPhone)
            .input('notes', sql.NVarChar(500), cleanNotes || null)
            .query(`
                INSERT INTO site_visit_requests (unit_id, visit_date, time_slot, name, email, phone, notes)
                VALUES (@uid, @date, @slot, @name, @email, @phone, @notes)
            `);

        // ── Admin notification (non-blocking) ────────────────────────────────
        if (process.env.EMAIL_USER) {
            const slotLabel = { morning: 'Morning (9AM–11AM)', afternoon: 'Afternoon (1PM–3PM)', late_afternoon: 'Late Afternoon (3PM–5PM)' }[cleanSlot];
            transporter.sendMail({
                from: `"EliteStay System" <${process.env.EMAIL_USER}>`,
                to:   process.env.EMAIL_USER,
                subject: `📅 New Site Visit Request — Unit #${unitId}`,
                html: `
                <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;padding:30px;border:1px solid #eee;">
                    <h2 style="color:#c5a059;font-family:serif">EliteStay — Site Visit Request</h2>
                    <p><strong>Unit ID:</strong> ${unitId}</p>
                    <p><strong>Visit Date:</strong> ${dateStr}</p>
                    <p><strong>Time Slot:</strong> ${slotLabel}</p>
                    <hr>
                    <p><strong>Name:</strong> ${cleanName}</p>
                    <p><strong>Phone:</strong> ${cleanPhone}</p>
                    <p><strong>Email:</strong> ${cleanEmail || 'Not provided'}</p>
                    <p><strong>Notes:</strong> ${cleanNotes || '(none)'}</p>
                    <a href="${process.env.APP_URL || 'http://localhost:' + (process.env.PORT || 3000)}/admin"
                       style="display:inline-block;margin-top:14px;padding:10px 20px;background:#c5a059;color:#fff;text-decoration:none;border-radius:4px">
                       View in Dashboard →
                    </a>
                </div>`
            }).catch(e => console.error('[Visits] Admin email error:', e.message));
        }

        return res.json({ success: true, message: 'Your visit has been scheduled! We will confirm within 24 hours.' });

    } catch (err) {
        console.error('[Visits] Schedule error:', err.message);
        return res.status(500).json({ success: false, errors: ['An error occurred. Please try again.'] });
    }
});

module.exports = router;
