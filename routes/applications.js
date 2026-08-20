'use strict';
/**
 * routes/applications.js
 * Direct rental application endpoint — requires logged-in session.
 * Used when a customer is ready to rent after the 360° tour.
 */

const express  = require('express');
const router   = express.Router();
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');
const { poolPromise, sql } = require('../config/db');
const transporter = require('../utils/email');

// ─── Auth Guard ───────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
    if (!req.session?.user) {
        return res.status(401).json({ success: false, error: 'Login required.' });
    }
    next();
}

// ─── Multer — ID upload ───────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'applications');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const tmpDir = path.join(UPLOADS_DIR, 'tmp_' + Date.now());
        fs.mkdirSync(tmpDir, { recursive: true });
        req._appUploadDir = req._appUploadDir || tmpDir;
        cb(null, req._appUploadDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, file.fieldname + ext);
    }
});

const ALLOWED_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png']);
const ALLOWED_EXTS  = new Set(['.jpg', '.jpeg', '.png']);

const fileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_MIMES.has(file.mimetype) || !ALLOWED_EXTS.has(ext)) {
        return cb(new Error('Only JPEG and PNG images are allowed for ID uploads.'));
    }
    cb(null, true);
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 5 * 1024 * 1024 } });
const uploadFields = upload.fields([
    { name: 'school_id', maxCount: 1 },
    { name: 'govt_id',   maxCount: 1 }
]);

function sanitize(val, max = 500) {
    if (typeof val !== 'string') return '';
    return val.replace(/<[^>]*>/g, '').trim().slice(0, max);
}

// ─── GET /api/applications/check-auth ────────────────────────────────────────
// Frontend calls this to verify if user is logged in before showing the Rent modal
router.get('/check-auth', (req, res) => {
    if (req.session?.user) {
        return res.json({ loggedIn: true, user: { name: req.session.user.full_name, email: req.session.user.email } });
    }
    return res.json({ loggedIn: false });
});

// ─── POST /api/applications/submit ────────────────────────────────────────────
router.post('/submit', requireAuth, (req, res, next) => {
    uploadFields(req, res, (err) => {
        if (err instanceof multer.MulterError) return res.status(422).json({ success: false, errors: [`File upload error: ${err.message}`] });
        if (err) return res.status(422).json({ success: false, errors: [err.message] });
        next();
    });
}, async (req, res) => {
    const userId = req.session.user.id;
    const {
        unit_id, move_in_date, intended_stay_months,
        phone, guardian_phone, message
    } = req.body;

    const unitId        = parseInt(unit_id, 10);
    const stayMonths    = parseInt(intended_stay_months, 10);
    const cleanPhone    = sanitize(phone, 30);
    const cleanGuardian = sanitize(guardian_phone, 30);
    const cleanMessage  = sanitize(message, 1000);

    // ── Validation ────────────────────────────────────────────────────────────
    const errors = [];
    if (!unitId)          errors.push('Unit ID is required.');
    if (!move_in_date)    errors.push('Move-in date is required.');
    if (!stayMonths || stayMonths < 1) errors.push('Please specify intended stay duration.');

    // Check at least one ID
    const schoolIdFile = req.files?.school_id?.[0];
    const govtIdFile   = req.files?.govt_id?.[0];
    if (!schoolIdFile && !govtIdFile) errors.push('Please upload at least one ID document (School ID or Government ID).');

    if (errors.length > 0) {
        if (req._appUploadDir && fs.existsSync(req._appUploadDir)) {
            fs.rmSync(req._appUploadDir, { recursive: true, force: true });
        }
        return res.status(422).json({ success: false, errors });
    }

    let parsedMoveIn;
    try {
        parsedMoveIn = new Date(move_in_date);
        const today = new Date(); today.setHours(0, 0, 0, 0);
        if (parsedMoveIn < today) {
            return res.status(422).json({ success: false, errors: ['Move-in date must be in the future.'] });
        }
    } catch (_) {
        return res.status(422).json({ success: false, errors: ['Invalid move-in date.'] });
    }

    const schoolIdPath = schoolIdFile ? schoolIdFile.path.replace(/\\/g, '/') : null;
    const govtIdPath   = govtIdFile   ? govtIdFile.path.replace(/\\/g, '/')   : null;
    const moveInStr    = parsedMoveIn.toISOString().split('T')[0];

    try {
        const pool = await poolPromise;

        // Fetch user details from session for the inquiry record
        const userRes = await pool.request()
            .input('uid', sql.Int, userId)
            .query(`SELECT full_name, email, phone_number FROM users WHERE id = @uid`);
        const u = userRes.recordset[0];
        if (!u) return res.status(400).json({ success: false, errors: ['User not found.'] });

        const nameParts = (u.full_name || '').split(' ');
        const firstName = nameParts[0] || '';
        const lastName  = nameParts.slice(1).join(' ') || '';

        // Insert as a rental_application type into inquiries
        const result = await pool.request()
            .input('fn',    sql.NVarChar(100),       firstName)
            .input('ln',    sql.NVarChar(100),       lastName)
            .input('em',    sql.NVarChar(255),       u.email)
            .input('ph',    sql.NVarChar(30),        cleanPhone || u.phone_number || '')
            .input('gp',    sql.NVarChar(30),        cleanGuardian || null)
            .input('pu',    sql.NVarChar(50),        String(unitId))
            .input('msg',   sql.NVarChar(sql.MAX),   cleanMessage || null)
            .input('stat',  sql.NVarChar(20),        'approved')
            .input('air',   sql.NVarChar(10),        'REAL')
            .input('aic',   sql.Int,                 100)
            .input('airz',  sql.NVarChar(500),       'Direct rental application by verified user.')
            .input('mh',    sql.NVarChar(64),        '')
            .input('uh',    sql.NVarChar(64),        '')
            .input('ip',    sql.NVarChar(45),        req.socket?.remoteAddress || 'unknown')
            .input('ua',    sql.NVarChar(500),       (req.headers['user-agent'] || '').slice(0, 500))
            .input('type',  sql.NVarChar(30),        'rental_application')
            .input('mid',   sql.Date,                moveInStr)
            .input('ism',   sql.Int,                 stayMonths)
            .input('src',   sql.NVarChar(50),        '360_tour')
            .input('sip',   sql.NVarChar(500),       schoolIdPath)
            .input('gip',   sql.NVarChar(500),       govtIdPath)
            .input('ivs',   sql.NVarChar(20),        'pending')
            .query(`
                INSERT INTO inquiries
                    (first_name, last_name, email, phone, guardian_phone, preferred_unit,
                     message, message_hash, user_hash, ip_address, user_agent,
                     status, ai_result, ai_confidence, ai_reasoning,
                     type, move_in_date, intended_stay_months, source,
                     school_id_path, govt_id_path, id_verify_status)
                OUTPUT INSERTED.id
                VALUES
                    (@fn, @ln, @em, @ph, @gp, @pu,
                     @msg, @mh, @uh, @ip, @ua,
                     @stat, @air, @aic, @airz,
                     @type, @mid, @ism, @src,
                     @sip, @gip, @ivs)
            `);

        const appId = result.recordset[0]?.id;

        // Rename upload folder to use actual application ID
        if (req._appUploadDir && appId) {
            const finalDir = path.join(UPLOADS_DIR, String(appId));
            if (fs.existsSync(req._appUploadDir) && !fs.existsSync(finalDir)) {
                fs.renameSync(req._appUploadDir, finalDir);
            }
        }

        // ── Admin email notification (non-blocking) ───────────────────────────
        if (process.env.EMAIL_USER) {
            transporter.sendMail({
                from: `"EliteStay System" <${process.env.EMAIL_USER}>`,
                to:   process.env.EMAIL_USER,
                subject: `🏠 Priority: New Rental Application — ${u.full_name} for Unit #${unitId}`,
                html: `
                <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;padding:30px;border:2px solid #c5a059;">
                    <h2 style="color:#c5a059;font-family:serif">🏠 Direct Rental Application</h2>
                    <p style="color:#27ae60;font-weight:bold">Source: 360° Virtual Tour</p>
                    <hr>
                    <p><strong>Applicant:</strong> ${u.full_name}</p>
                    <p><strong>Email:</strong> ${u.email}</p>
                    <p><strong>Phone:</strong> ${cleanPhone || u.phone_number}</p>
                    <p><strong>Unit Requested:</strong> #${unitId}</p>
                    <p><strong>Move-In Date:</strong> ${moveInStr}</p>
                    <p><strong>Intended Stay:</strong> ${stayMonths} month(s)</p>
                    <p><strong>Message:</strong> ${cleanMessage || '(none)'}</p>
                    <a href="${process.env.APP_URL || 'http://localhost:' + (process.env.PORT || 3000)}/admin"
                       style="display:inline-block;margin-top:14px;padding:12px 24px;background:#c5a059;color:#fff;text-decoration:none;border-radius:4px;font-weight:bold">
                       Review Application →
                    </a>
                </div>`
            }).catch(e => console.error('[Applications] Admin email error:', e.message));
        }

        return res.json({
            success: true,
            message: 'Your rental application has been submitted! Our team will contact you within 24 hours to finalize the details.'
        });

    } catch (err) {
        console.error('[Applications] Submit error:', err.message);
        return res.status(500).json({ success: false, errors: ['An error occurred. Please try again.'] });
    }
});

module.exports = router;
