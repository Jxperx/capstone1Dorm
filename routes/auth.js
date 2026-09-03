const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../config/db');
const bcrypt = require('bcrypt');
const transporter = require('../utils/email');
const { sendMailWithFallback } = require('../utils/email');
const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

// Rate Limiters for Auth Endpoints
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,   // 15 minutes
    max: 10,
    message: { error: 'Too many login attempts. Please try again after 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false
});

const otpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,   // 15 minutes
    max: 5,
    message: { error: 'Too many OTP attempts. Please try again after 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false
});

const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,   // 1 hour
    max: 5,
    message: { error: 'Too many registration attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

// API: Email Diagnostics (Temporary for troubleshooting)
router.get('/email-diag', async (req, res) => {
    const diag = {
        hasEmailJS: !!process.env.EMAILJS_PUBLIC_KEY,
        emailjsServiceId: process.env.EMAILJS_SERVICE_ID,
        emailjsTemplateId: process.env.EMAILJS_TEMPLATE_ID,
        emailjsPublicKeyLength: process.env.EMAILJS_PUBLIC_KEY ? process.env.EMAILJS_PUBLIC_KEY.length : 0,
        emailjsPrivateKeyLength: process.env.EMAILJS_PRIVATE_KEY ? process.env.EMAILJS_PRIVATE_KEY.length : 0,
        hasResend: !!process.env.RESEND_API_KEY,
        resendKeyLength: process.env.RESEND_API_KEY ? process.env.RESEND_API_KEY.length : 0,
        hasSmtpUser: !!process.env.EMAIL_USER,
        hasSmtpPass: !!process.env.EMAIL_PASS,
        nodeEnv: process.env.NODE_ENV
    };

    if (!process.env.EMAILJS_PUBLIC_KEY && !process.env.RESEND_API_KEY) {
        return res.json({ success: false, message: 'Neither EMAILJS_PUBLIC_KEY nor RESEND_API_KEY is configured.', diag });
    }

    try {
        console.log('[Diag] Attempting test send via fallback pipeline...');
        const mailOptions = {
            from: '"EliteStay Diag" <onboarding@resend.dev>',
            to: process.env.EMAIL_USER || 'jxperx@gmail.com', // Try sending to owner
            subject: 'EliteStay 123456 Diagnostic Test',
            text: 'Hello, if you see this, your EmailJS/Resend setup is working! Your diagnostic code is 123456.'
        };

        const result = await sendMailWithFallback(mailOptions);
        return res.json({ success: true, message: 'Email sent successfully!', result, diag });
    } catch (err) {
        console.error('[Diag] Test failed:', err.message);
        return res.json({ success: false, error: err.message, stack: err.stack, diag });
    }
});

// API: Register
router.post('/register', registerLimiter, async (req, res) => {
    const { fullName, email, password, phone } = req.body;
    
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const pool = await poolPromise;
        
        await pool.request()
            .input('full_name', sql.NVarChar, fullName)
            .input('email', sql.NVarChar, email)
            .input('password_hash', sql.NVarChar, hashedPassword)
            .input('role', sql.NVarChar, 'tenant')
            .input('phone_number', sql.NVarChar, phone)
            .query('INSERT INTO users (full_name, email, password_hash, role, phone_number) VALUES (@full_name, @email, @password_hash, @role, @phone_number)');
            
        res.status(201).json({ message: 'User registered successfully' });
    } catch (err) {
        console.error('Registration Error:', err);
        res.status(500).json({ error: 'Database error or Email already exists' });
    }
});

// API: Login
router.post('/login', loginLimiter, async (req, res) => {
    const { email, password } = req.body;

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('email', sql.NVarChar, email)
            .query('SELECT * FROM users WHERE email = @email');

        if (result.recordset.length === 0) {
             return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = result.recordset[0];
        const match = await bcrypt.compare(password, user.password_hash);

        if (match) {
            // Check if user is a tenant
            if (user.role === 'tenant') {
                // Generate OTP
                const otp = Math.floor(100000 + Math.random() * 900000).toString();
                
                // Store in session temporarily
                req.session.otp = {
                    code: otp,
                    userId: user.id,
                    email: user.email,
                    expires: Date.now() + 5 * 60 * 1000 // 5 minutes
                };

                // Send Email via Nodemailer 
                const mailOptions = {
                    from: `"EliteStay Manager" <${process.env.EMAIL_USER}>`,
                    to: user.email,
                    replyTo: process.env.EMAIL_USER,
                    subject: `${otp} is your EliteStay verification code`,
                    text: `Hello ${user.full_name}, your verification code for EliteStay is: ${otp}. This code will expire in 5 minutes.`,
                    html: `
                        <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px; color: #1a1a1a; border: 1px solid #f0f0f0;">
                            <div style="text-align: center; margin-bottom: 30px;">
                                <h1 style="color: #c5a059; font-family: 'Playfair Display', serif; margin: 0; font-size: 28px;">EliteStay</h1>
                                <p style="text-transform: uppercase; letter-spacing: 2px; font-size: 10px; margin-top: 5px; color: #666;">Premium Student Living</p>
                            </div>
                            <div style="background-color: #f9f9f9; padding: 30px; border-radius: 4px; text-align: center;">
                                <p style="margin-top: 0; color: #444;">Hello <strong>${user.full_name}</strong>,</p>
                                <p style="color: #444;">Your one-time verification code is:</p>
                                <div style="font-size: 38px; font-weight: bold; letter-spacing: 8px; margin: 25px 0; color: #1a1a1a; font-family: monospace;">${otp}</div>
                                <p style="font-size: 13px; color: #888; margin-bottom: 0;">This code is valid for 5 minutes.</p>
                            </div>
                            <div style="margin-top: 30px; font-size: 12px; color: #999; line-height: 1.6; text-align: center;">
                                <p>If you did not request this code, please ignore this email or contact support if you have concerns about your account security.</p>
                                <p style="margin-top: 20px; border-top: 1px solid #eee; padding-top: 20px;">© ${new Date().getFullYear()} EliteStay Management. All rights reserved.</p>
                            </div>
                        </div>
                    `,
                    headers: {
                        'X-Priority': '1 (Highest)',
                        'X-MSMail-Priority': 'High',
                        'Importance': 'high'
                    }
                };

                try {
                    await sendMailWithFallback(mailOptions);
                    logger.debug(`[Auth] OTP sent successfully to ${user.email}`);
                } catch (mailError) {
                    logger.error('[Auth] Nodemailer Error:', mailError.message);
                    return res.status(500).json({ 
                        error: 'Failed to send OTP email.', 
                        details: mailError.message 
                    });
                }

                return res.json({ 
                    otpRequired: true, 
                    message: 'Please enter the verification code sent to your email.' 
                });
            }

            // Admin Login (No OTP for now)
            req.session.user = { id: user.id, role: user.role, name: user.full_name };
            req.session.save((err) => {
                if (err) logger.error('[Auth] Session Save Error (Admin):', err);
                logger.debug('[Auth] Session saved for Admin:', req.session.user.name);
                return res.json({ role: user.role });
            });
        } else {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
    } catch (err) {
        logger.error('[Auth] Login Error:', err.message);
        return res.status(500).json({ error: 'Server error' });
    }
});

// API: Verify OTP
router.post('/verify-otp', otpLimiter, async (req, res) => {
    const { otp } = req.body;

    if (!req.session.otp) {
        return res.status(400).json({ error: 'No OTP request found. Please login again.' });
    }

    const { code, userId, expires } = req.session.otp;

    if (Date.now() > expires) {
        delete req.session.otp;
        return res.status(400).json({ error: 'OTP expired. Please login again.' });
    }

    if (otp !== code) {
        return res.status(400).json({ error: 'Invalid OTP.' });
    }

    // OTP Verified - Complete Login
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('id', sql.Int, userId)
            .query('SELECT * FROM users WHERE id = @id');
        
        if (result.recordset.length === 0) {
            return res.status(500).json({ error: 'User not found.' });
        }

        const user = result.recordset[0];
        req.session.user = { id: user.id, role: user.role, name: user.full_name };

        // Load Tenant Details
        const tenantRes = await pool.request()
            .input('user_id', sql.Int, user.id)
            .query('SELECT id, room_id FROM tenants WHERE user_id = @user_id');
            
        if (tenantRes.recordset.length > 0) {
            req.session.user.tenant_id = tenantRes.recordset[0].id;
            req.session.user.room_id = tenantRes.recordset[0].room_id;
        } else {
            // Create a dummy tenant record
            try {
                const insertTenant = await pool.request()
                    .input('user_id', sql.Int, user.id)
                    .input('lease_start', sql.Date, new Date())
                    .query('INSERT INTO tenants (user_id, lease_start_date) OUTPUT INSERTED.id VALUES (@user_id, @lease_start)');
                 
                req.session.user.tenant_id = insertTenant.recordset[0].id;
                req.session.user.room_id = null;
            } catch (insertErr) {
                console.error('Error creating tenant record:', insertErr);
            }
        }

        delete req.session.otp;
        req.session.save((err) => {
            if (err) logger.error('[Auth] Session Save Error (Tenant):', err);
            logger.debug('[Auth] Session saved for Tenant:', req.session.user.name);
            res.json({ success: true, role: 'tenant' });
        });

    } catch (err) {
        logger.error('[Auth] OTP Verification Error:', err.message);
        res.status(500).json({ error: 'Server error during verification.' });
    }
});

// API: Logout
router.get('/logout', (req, res) => {
    // Destroy session fully before redirecting; the callback guarantees the store write completes
    req.session.destroy((err) => {
        if (err) {
            console.error('Session destroy error on logout:', err);
            // Still redirect — the user cannot use a destroyed-request session anyway
        }
        res.clearCookie('connect.sid'); // Belt-and-suspenders: clear the cookie client-side too
        res.redirect('/login');
    });
});

// API: Get Current User Info
router.get('/current-user', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not authorized' });
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('id', sql.Int, req.session.user.id)
            .query('SELECT full_name, email, phone_number FROM users WHERE id = @id');
        if (result.recordset.length === 0) return res.status(404).json({ error: 'User not found' });
        res.json(result.recordset[0]);
    } catch (err) {
        console.error('Current User Error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// API: Get session user id (lightweight — for client-side socket identification)
router.get('/session-user', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not authorized' });
    res.json({ id: req.session.user.id, role: req.session.user.role, name: req.session.user.name });
});

// ── Password Reset Flow ────────────────────────────────────────────────────────

const forgotLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 3,
    message: { error: 'Too many reset requests. Please try again after 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false
});

const resetOtpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'Too many OTP attempts. Please try again after 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false
});

// POST /api/forgot-password
// Sends a 6-digit reset OTP to the user's email.
// Always returns a generic response to prevent email enumeration.
router.post('/forgot-password', forgotLimiter, async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required.' });

    const GENERIC_OK = { success: true, message: 'If that email is registered, a reset code has been sent.' };

    try {
        const pool = await poolPromise;

        // Look up the user
        const result = await pool.request()
            .input('email', sql.NVarChar, email.trim().toLowerCase())
            .query('SELECT id, full_name FROM users WHERE LOWER(email) = @email');

        if (result.recordset.length === 0) {
            // Don't reveal whether email exists
            return res.json(GENERIC_OK);
        }

        const user = result.recordset[0];
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        // Invalidate any existing unused tokens for this user
        await pool.request()
            .input('user_id', sql.Int, user.id)
            .query('UPDATE password_reset_tokens SET used = 1 WHERE user_id = @user_id AND used = 0');

        // Store new OTP
        await pool.request()
            .input('user_id',    sql.Int,      user.id)
            .input('otp_code',   sql.NVarChar, otp)
            .input('expires_at', sql.DateTime, expiresAt)
            .query('INSERT INTO password_reset_tokens (user_id, otp_code, expires_at) VALUES (@user_id, @otp_code, @expires_at)');

        // Send email
        const mailOptions = {
            from: `"EliteStay Manager" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: `${otp} is your EliteStay password reset code`,
            html: `
                <div style="font-family:'Inter',Arial,sans-serif;max-width:600px;margin:0 auto;padding:40px;color:#1a1a1a;border:1px solid #f0f0f0;">
                    <div style="text-align:center;margin-bottom:30px;">
                        <h1 style="color:#c5a059;font-family:'Playfair Display',serif;margin:0;font-size:28px;">EliteStay</h1>
                        <p style="text-transform:uppercase;letter-spacing:2px;font-size:10px;margin-top:5px;color:#666;">Password Reset</p>
                    </div>
                    <div style="background-color:#f9f9f9;padding:30px;border-radius:4px;text-align:center;">
                        <p style="margin-top:0;color:#444;">Hello <strong>${user.full_name}</strong>,</p>
                        <p style="color:#444;">Your password reset code is:</p>
                        <div style="font-size:38px;font-weight:bold;letter-spacing:8px;margin:25px 0;color:#1a1a1a;font-family:monospace;">${otp}</div>
                        <p style="font-size:13px;color:#888;margin-bottom:0;">This code is valid for <strong>10 minutes</strong>. If you did not request a password reset, please ignore this email.</p>
                    </div>
                    <div style="margin-top:30px;font-size:12px;color:#999;text-align:center;">
                        <p style="margin-top:20px;border-top:1px solid #eee;padding-top:20px;">© ${new Date().getFullYear()} EliteStay Management. All rights reserved.</p>
                    </div>
                </div>
            `
        };

        try {
            await sendMailWithFallback(mailOptions);
        } catch (mailErr) {
            logger.error('[Auth] Forgot-password email error:', mailErr.message);
            return res.status(500).json({ error: 'Failed to send reset email. Please try again.' });
        }

        return res.json(GENERIC_OK);
    } catch (err) {
        logger.error('[Auth] Forgot-password error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// POST /api/verify-reset-otp
// Verifies the OTP and stores a short-lived session flag allowing the reset step.
router.post('/verify-reset-otp', resetOtpLimiter, async (req, res) => {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required.' });

    try {
        const pool = await poolPromise;

        const result = await pool.request()
            .input('email', sql.NVarChar, email.trim().toLowerCase())
            .input('otp',   sql.NVarChar, otp.trim())
            .query(`
                SELECT t.id, t.user_id, t.expires_at, t.used
                FROM password_reset_tokens t
                INNER JOIN users u ON u.id = t.user_id
                WHERE LOWER(u.email) = @email
                  AND t.otp_code = @otp
                  AND t.used = 0
            `);

        if (result.recordset.length === 0) {
            return res.status(400).json({ error: 'Invalid or expired reset code.' });
        }

        const token = result.recordset[0];

        if (new Date() > new Date(token.expires_at)) {
            return res.status(400).json({ error: 'Reset code has expired. Please request a new one.' });
        }

        // Store verified flag in session — required by reset-password endpoint
        req.session.passwordReset = {
            userId:  token.user_id,
            tokenId: token.id,
            email:   email.trim().toLowerCase(),
            expires: Date.now() + 10 * 60 * 1000 // 10 more minutes to complete
        };

        req.session.save((err) => {
            if (err) {
                logger.error('[Auth] Session save error (reset-otp):', err);
                return res.status(500).json({ error: 'Failed to establish secure reset session.' });
            }
            return res.json({ success: true });
        });
    } catch (err) {
        logger.error('[Auth] Verify-reset-otp error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// POST /api/reset-password
// Sets the new password. Requires a valid passwordReset session flag from verify-reset-otp.
router.post('/reset-password', async (req, res) => {
    const { newPassword } = req.body;

    if (!req.session.passwordReset) {
        return res.status(403).json({ error: 'Session expired or invalid. Please start the reset process again.' });
    }

    const { userId, tokenId, expires } = req.session.passwordReset;

    if (Date.now() > expires) {
        delete req.session.passwordReset;
        return res.status(403).json({ error: 'Reset session expired. Please request a new code.' });
    }

    if (!newPassword || newPassword.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    try {
        const pool = await poolPromise;
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password
        await pool.request()
            .input('password_hash', sql.NVarChar, hashedPassword)
            .input('user_id',       sql.Int,      userId)
            .query('UPDATE users SET password_hash = @password_hash WHERE id = @user_id');

        // Mark OTP as used
        await pool.request()
            .input('token_id', sql.Int, tokenId)
            .query('UPDATE password_reset_tokens SET used = 1 WHERE id = @token_id');

        // Clear reset session flag
        delete req.session.passwordReset;
        req.session.save((err) => {
            if (err) {
                logger.error('[Auth] Session save error (reset-password):', err);
                return res.status(500).json({ error: 'Failed to complete reset session.' });
            }
            return res.json({ success: true, message: 'Password updated successfully.' });
        });
    } catch (err) {
        logger.error('[Auth] Reset-password error:', err.message);
        return res.status(500).json({ error: 'Server error.' });
    }
});

// GET /api/auth/verify-setup-token?token=...
router.get('/verify-setup-token', async (req, res) => {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Token is required' });

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('token', sql.NVarChar, token)
            .query(`
                SELECT t.id as token_id, t.user_id, t.expires_at, t.used, u.email, u.full_name
                FROM password_reset_tokens t
                JOIN users u ON t.user_id = u.id
                WHERE t.token = @token AND (t.used IS NULL OR t.used = 0 OR t.used = false)
            `);

        if (result.recordset.length === 0) {
            return res.status(400).json({ error: 'Invalid or expired setup token link.' });
        }

        const record = result.recordset[0];
        if (new Date(record.expires_at) < new Date()) {
            return res.status(400).json({ error: 'This setup link has expired. Please ask your administrator for a new setup link.' });
        }

        res.json({
            valid: true,
            email: record.email,
            fullName: record.full_name,
            userId: record.user_id
        });
    } catch (err) {
        logger.error('[Auth] verify-setup-token error:', err.message);
        res.status(500).json({ error: 'Server error verifying token.' });
    }
});

// POST /api/auth/set-tenant-password
router.post('/set-tenant-password', async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password || password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    try {
        const pool = await poolPromise;

        // Verify Token
        const tokenRes = await pool.request()
            .input('token', sql.NVarChar, token)
            .query(`
                SELECT t.id as token_id, t.user_id, t.expires_at, t.used, u.email, u.full_name, u.role
                FROM password_reset_tokens t
                JOIN users u ON t.user_id = u.id
                WHERE t.token = @token AND (t.used IS NULL OR t.used = 0 OR t.used = false)
            `);

        if (tokenRes.recordset.length === 0) {
            return res.status(400).json({ error: 'Invalid or already used setup token link.' });
        }

        const record = tokenRes.recordset[0];
        if (new Date(record.expires_at) < new Date()) {
            return res.status(400).json({ error: 'Setup link has expired. Please ask your administrator to resend an invite.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // Update User password and set status to active
        await pool.request()
            .input('password_hash', sql.NVarChar, hashedPassword)
            .input('user_id', sql.Int, record.user_id)
            .query(`UPDATE users SET password_hash = @password_hash, status = 'active' WHERE id = @user_id`);

        // Mark token as used
        await pool.request()
            .input('token_id', sql.Int, record.token_id)
            .query(`UPDATE password_reset_tokens SET used = true WHERE id = @token_id`);

        // Create Tenant Auth Session
        req.session.user = {
            id: record.user_id,
            email: record.email,
            full_name: record.full_name,
            role: record.role || 'tenant'
        };

        req.session.save((err) => {
            if (err) {
                logger.error('[Auth] Session save error on set-tenant-password:', err);
            }
            res.json({
                success: true,
                message: 'Password created successfully! Welcome to your Tenant Portal.',
                redirectUrl: '/tenant-dashboard.html'
            });
        });

    } catch (err) {
        logger.error('[Auth] set-tenant-password error:', err.message);
        res.status(500).json({ error: 'Server error setting password.' });
    }
});

module.exports = router;
