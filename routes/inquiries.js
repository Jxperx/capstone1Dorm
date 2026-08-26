'use strict';
/**
 * routes/inquiries.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Public inquiry submission endpoint with multi-layer protection:
 *   1. IP block check
 *   2. Honeypot field detection
 *   3. Rate limiting (handled at server level via express-rate-limit)
 *   4. Input validation & sanitization
 *   5. SHA-256 duplicate detection
 *   6. Device suspicion detection (FingerprintJS device_id)
 *   7. Gemini AI spam classification
 *   8. Status assignment & DB persist
 *   9. Admin email notification (non-blocking)
 */

const express  = require('express');
const router   = express.Router();
const crypto   = require('crypto');
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');
const { poolPromise, sql } = require('../config/db');
const { classifyInquiry }  = require('../utils/aiInquiryClassifier');
const transporter = require('../utils/email');
const { runOsintCheck, analyzeIdDocuments } = require('../utils/osintSearch');

// ─── Multer — file upload config for ID documents (Cloudinary Private Document Storage) ───
const { privateDocumentStorage } = require('../config/cloudinary');
const storage = privateDocumentStorage;

const fileFilter = (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png'];
    if (allowed.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Only JPG and PNG images are accepted for ID uploads.'), false);
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB per file
});

const uploadFields = upload.fields([
    { name: 'school_id', maxCount: 1 },
    { name: 'govt_id',   maxCount: 1 }
]);

// ─── Helpers ────────────────────────────────────────────────────────────────

function sha256(str) {
    return crypto.createHash('sha256').update(str || '').digest('hex');
}

/** Sanitise a string: strip HTML tags, trim whitespace */
function sanitize(val) {
    if (typeof val !== 'string') return '';
    return val.replace(/<[^>]*>/g, '').trim().slice(0, 2000);
}

/** Minimal email format check */
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

/** Minimal phone check: at least 7 digits */
function isValidPhone(phone) {
    return /^\+?[\d\s\-().]{7,20}$/.test(phone);
}

/** Get real client IP (handles proxies) */
function getClientIp(req) {
    return (
        req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.headers['x-real-ip'] ||
        req.socket?.remoteAddress ||
        'unknown'
    );
}

/** Notify admin asynchronously — never blocks the response */
async function notifyAdmin(inquiry, status) {
    if (!process.env.EMAIL_USER) return;
    try {
        const subject = status === 'suspicious'
            ? `⚠️ Suspicious Inquiry Alert — ${inquiry.first_name} ${inquiry.last_name}`
            : `📩 New Inquiry — ${inquiry.first_name} ${inquiry.last_name}`;

        const html = `
        <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;padding:30px;border:1px solid #eee;">
            <h2 style="color:#c5a059;font-family:serif">EliteStay — New Inquiry</h2>
            <p><strong>Status:</strong> <span style="color:${status==='suspicious'?'#e74c3c':'#27ae60'}">${status.toUpperCase()}</span></p>
            <hr>
            <p><strong>Name:</strong> ${inquiry.first_name} ${inquiry.last_name}</p>
            <p><strong>Email:</strong> ${inquiry.email}</p>
            <p><strong>Phone:</strong> ${inquiry.phone}</p>
            <p><strong>Preferred Unit:</strong> ${inquiry.preferred_unit || 'Not specified'}</p>
            <p><strong>Message:</strong><br>${inquiry.message || '(no message)'}</p>
            <hr>
            <p style="font-size:12px;color:#999">
                IP: ${inquiry.ip_address} &nbsp;|&nbsp; Device: ${(inquiry.device_id||'').slice(0,16)}… &nbsp;|&nbsp;
                AI: ${inquiry.ai_result} (${inquiry.ai_confidence}%)
            </p>
            <a href="${process.env.APP_URL || 'http://localhost:' + (process.env.PORT || 3000)}/admin" 
               style="display:inline-block;margin-top:14px;padding:10px 20px;background:#c5a059;color:#fff;text-decoration:none;border-radius:4px">
               View in Dashboard →
            </a>
        </div>`;

        await transporter.sendMail({
            from: `"EliteStay System" <${process.env.EMAIL_USER}>`,
            to:   process.env.EMAIL_USER,
            subject,
            html
        });
    } catch (e) {
        console.error('[Inquiry] Admin notification email failed:', e.message);
    }
}

// ─── POST /api/inquiries/submit ──────────────────────────────────────────────

router.post('/submit', (req, res, next) => {
    uploadFields(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            return res.status(422).json({ success: false, errors: [`File upload error: ${err.message}`] });
        } else if (err) {
            return res.status(422).json({ success: false, errors: [err.message] });
        }
        next();
    });
}, async (req, res) => {
    const ip = getClientIp(req);

    // ── Step 1: IP Block Check ───────────────────────────────────────────────
    try {
        const pool = await poolPromise;
        const blockedRes = await pool.request()
            .input('ip', sql.NVarChar(45), ip)
            .query('SELECT id FROM inquiry_blocked_ips WHERE ip_address = @ip');
        if (blockedRes.recordset.length > 0) {
            // Respond positively to avoid fingerprinting our block list
            return res.json({ success: true, message: 'Your inquiry has been received.' });
        }
    } catch (dbErr) {
        console.error('[Inquiry] Block check error:', dbErr.message);
    }

    // ── Step 2: Honeypot Check ───────────────────────────────────────────────
    if (req.body.hp_field && req.body.hp_field.trim() !== '') {
        console.warn(`[Inquiry] Honeypot triggered by IP: ${ip}`);
        return res.json({ success: true, message: 'Your inquiry has been received.' });
    }

    // ── Step 3: Input Validation ─────────────────────────────────────────────
    const firstName     = sanitize(req.body.first_name);
    const lastName      = sanitize(req.body.last_name);
    const email         = sanitize(req.body.email)?.toLowerCase();
    const phone         = sanitize(req.body.phone);
    const guardianPhone = sanitize(req.body.guardian_phone)?.slice(0, 30);
    const prefUnit      = sanitize(req.body.preferred_unit)?.slice(0, 50);
    const message       = sanitize(req.body.message);
    const deviceId      = sanitize(req.body.device_id)?.slice(0, 255);
    const userAgent     = (req.headers['user-agent'] || '').slice(0, 500);

    // Capture uploaded file paths
    const schoolIdFile = req.files?.school_id?.[0];
    const govtIdFile   = req.files?.govt_id?.[0];
    const schoolIdPath = schoolIdFile ? schoolIdFile.path.replace(/\\/g, '/') : null;
    const govtIdPath   = govtIdFile   ? govtIdFile.path.replace(/\\/g, '/')   : null;

    // Validate required fields including ID documents
    const errors = [];
    if (!firstName) errors.push('First name is required.');
    if (!lastName)  errors.push('Last name is required.');
    if (!email || !isValidEmail(email)) errors.push('A valid email address is required.');
    if (!phone || !isValidPhone(phone)) errors.push('A valid phone number is required.');
    if (!schoolIdFile && !govtIdFile) errors.push('At least one ID photo is required (School ID or Government ID).');

    if (errors.length > 0) {
        return res.status(422).json({ success: false, errors });
    }

    // ── Room Matching Quiz (optional — only for dorm inquiries) ──────────────
    let roomQuizJson = null;
    let quizScore    = null;
    if (req.body.room_quiz) {
        try {
            const parsed = JSON.parse(req.body.room_quiz);
            roomQuizJson = JSON.stringify(parsed);
        } catch (_) { /* invalid JSON — ignore */ }
    }
    if (typeof req.body.quiz_score === 'number' || typeof req.body.quiz_score === 'string') {
        const sc = parseInt(req.body.quiz_score, 10);
        if (!isNaN(sc) && sc >= 0 && sc <= 100) quizScore = sc;
    }


    try {
        const pool = await poolPromise;

        // ── Step 4: Generate Hashes ──────────────────────────────────────────
        const messageHash = sha256(message.toLowerCase().replace(/\s+/g, ' '));
        const userHash    = sha256(`${email}::${phone}`);

        // ── Step 5: Duplicate Detection ──────────────────────────────────────
        const dupRes = await pool.request()
            .input('mh', sql.NVarChar(64), messageHash)
            .input('uh', sql.NVarChar(64), userHash)
            .query(`
                SELECT TOP 1 id, status 
                FROM inquiries 
                WHERE message_hash = @mh OR user_hash = @uh
                ORDER BY created_at DESC
            `);
        const isDuplicate = dupRes.recordset.length > 0;

        // ── Step 6: Device Suspicion Check ───────────────────────────────────
        let isSuspicious = false;
        if (deviceId) {
            const deviceRes = await pool.request()
                .input('did', sql.NVarChar(255), deviceId)
                .query(`
                    SELECT COUNT(*) AS cnt
                    FROM inquiries
                    WHERE device_id = @did
                      AND created_at >= DATEADD(hour, -1, SYSDATETIME())
                `);
            const recentCount = deviceRes.recordset[0]?.cnt || 0;
            if (recentCount >= 3) {
                isSuspicious = true;
                console.warn(`[Inquiry] Suspicious device: ${deviceId} sent ${recentCount} in last hour`);
            }
        }

        // Also check IP-based volume
        const ipRes = await pool.request()
            .input('ip', sql.NVarChar(45), ip)
            .query(`
                SELECT COUNT(*) AS cnt
                FROM inquiries
                WHERE ip_address = @ip
                  AND created_at >= DATEADD(hour, -1, SYSDATETIME())
            `);
        const ipCount = ipRes.recordset[0]?.cnt || 0;
        if (ipCount >= 5) {
            isSuspicious = true;
            // Auto-block after 10 submissions from same IP in 1 hour
            if (ipCount >= 10) {
                await pool.request()
                    .input('ip', sql.NVarChar(45), ip)
                    .input('reason', sql.NVarChar(255), `Auto-blocked: ${ipCount} submissions in 1 hour`)
                    .query(`
                        IF NOT EXISTS (SELECT 1 FROM inquiry_blocked_ips WHERE ip_address = @ip)
                            INSERT INTO inquiry_blocked_ips (ip_address, reason, blocked_by)
                            VALUES (@ip, @reason, 'system')
                    `);
                console.warn(`[Inquiry] Auto-blocked IP: ${ip} (${ipCount} submissions)`);
            }
        }

        // ── Step 7: AI Classification ─────────────────────────────────────────
        let aiResult = 'REAL', aiConfidence = 70, aiReasoning = 'Not analyzed.';
        try {
            const ai = await classifyInquiry(message, `${firstName} ${lastName}`);
            aiResult     = ai.result;
            aiConfidence = ai.confidence;
            aiReasoning  = ai.reasoning;
        } catch (aiErr) {
            console.error('[Inquiry] AI classifier error:', aiErr.message);
        }

        // ── Step 8: Assign Final Status ───────────────────────────────────────
        let status = 'approved';
        if (isDuplicate)            status = 'duplicate';
        if (isSuspicious)           status = 'suspicious';
        if (aiResult === 'SPAM')    status = 'flagged';

        // Suspicious always wins over duplicate (needs more attention)
        if (isSuspicious && status === 'duplicate') status = 'suspicious';

        // ── Step 9: Persist to Database ───────────────────────────────────────
        await pool.request()
            .input('fn',   sql.NVarChar(100),  firstName)
            .input('ln',   sql.NVarChar(100),  lastName)
            .input('em',   sql.NVarChar(255),  email)
            .input('ph',   sql.NVarChar(30),   phone)
            .input('gp',   sql.NVarChar(30),   guardianPhone || null)
            .input('pu',   sql.NVarChar(50),   prefUnit || null)
            .input('msg',  sql.NVarChar(sql.MAX), message || null)
            .input('mh',   sql.NVarChar(64),   messageHash)
            .input('uh',   sql.NVarChar(64),   userHash)
            .input('did',  sql.NVarChar(255),  deviceId || null)
            .input('ip',   sql.NVarChar(45),   ip)
            .input('ua',   sql.NVarChar(500),  userAgent)
            .input('stat', sql.NVarChar(20),   status)
            .input('air',  sql.NVarChar(10),   aiResult)
            .input('aic',  sql.Int,            aiConfidence)
            .input('airz', sql.NVarChar(500),  aiReasoning)
            .input('rq',   sql.NVarChar(sql.MAX), roomQuizJson)
            .input('qs',   sql.Int,            quizScore)
            .input('sip',  sql.NVarChar(500),  schoolIdPath)
            .input('gip',  sql.NVarChar(500),  govtIdPath)
            .input('ivs',  sql.NVarChar(20),   'pending')
            .query(`
                INSERT INTO inquiries
                    (first_name, last_name, email, phone, guardian_phone, preferred_unit,
                     message, message_hash, user_hash, device_id, ip_address,
                     user_agent, status, ai_result, ai_confidence, ai_reasoning,
                     room_quiz, quiz_score, school_id_path, govt_id_path, id_verify_status)
                VALUES
                    (@fn, @ln, @em, @ph, @gp, @pu,
                     @msg, @mh, @uh, @did, @ip,
                     @ua, @stat, @air, @aic, @airz, @rq, @qs, @sip, @gip, @ivs)
            `);

        console.log(`[Inquiry] Saved — status:${status} ai:${aiResult}(${aiConfidence}%) ip:${ip}`);

        // ── Step 10: Admin Notification (non-blocking) ────────────────────────
        if (status === 'approved' || status === 'suspicious') {
            notifyAdmin(
                { first_name: firstName, last_name: lastName, email, phone,
                  preferred_unit: prefUnit, message, ip_address: ip,
                  device_id: deviceId, ai_result: aiResult, ai_confidence: aiConfidence },
                status
            ).catch(() => {});
        }

        // ── Step 11: Auto OSINT + ID Document Analysis (non-blocking) ────────
        // Runs for approved, suspicious, and flagged inquiries (not duplicates).
        if (status !== 'duplicate') {
            (async () => {
                try {
                    // Fetch the newly inserted inquiry ID
                    const idRes = await pool.request()
                        .input('uh', sql.NVarChar(64), userHash)
                        .input('mh', sql.NVarChar(64), messageHash)
                        .query(`SELECT TOP 1 id FROM inquiries
                                WHERE user_hash = @uh AND message_hash = @mh
                                ORDER BY created_at DESC`);
                    const inqId = idRes.recordset[0]?.id;
                    if (!inqId) return;
                    // Run OSINT check in parallel with ID analysis using Cloudinary URLs
                    const [osintResult, idAnalysis] = await Promise.all([
                        runOsintCheck({ first_name: firstName, last_name: lastName, email, phone, message }),
                        analyzeIdDocuments(inqId, schoolIdPath, govtIdPath, `${firstName} ${lastName}`)
                    ]);

                    const osintJson      = JSON.stringify(osintResult);
                    const idAnalysisJson = JSON.stringify(idAnalysis);

                    // Determine ID verify status from AI verdict
                    const idVerifyStatus = idAnalysis.skipped          ? 'pending'
                                        : idAnalysis.verdict === 'PASS' ? 'passed'
                                        : idAnalysis.verdict === 'FAIL' ? 'failed'
                                        : 'flagged';

                    // Auto-flag if trust score is critically low or ID verification failed
                    let finalStatus = status === 'suspicious' ? 'suspicious' : 'approved';
                    if (osintResult.trustScore < 30)   finalStatus = 'suspicious';
                    if (idAnalysis.verdict === 'FAIL') finalStatus = 'suspicious';

                    await pool.request()
                        .input('inqId',  sql.Int,                inqId)
                        .input('osint',  sql.NVarChar(sql.MAX),  osintJson)
                        .input('idana',  sql.NVarChar(sql.MAX),  idAnalysisJson)
                        .input('idvs',   sql.NVarChar(20),       idVerifyStatus)
                        .input('status', sql.NVarChar(20),       finalStatus)
                        .query(`UPDATE inquiries
                                SET osint_result      = @osint,
                                    id_analysis       = @idana,
                                    id_verify_status  = @idvs,
                                    status            = @status
                                WHERE id = @inqId`);

                    console.log(`[Inquiry] #${inqId} background complete — OSINT: ${osintResult.trustScore}/100, ID: ${idVerifyStatus}`);
                } catch (osintErr) {
                    console.error('[OSINT] Auto-run error:', osintErr.message);
                }
            })().catch(() => {});
        }


        // Always return success to avoid bots adjusting strategy
        return res.json({
            success: true,
            message: 'Thank you! Your inquiry has been received. We will contact you within 24 hours.'
        });

    } catch (err) {
        console.error('[Inquiry] Submission error:', err);
        return res.status(500).json({ success: false, message: 'An error occurred. Please try again later.' });
    }
});

module.exports = router;
