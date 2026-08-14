const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../config/db');
const bcrypt = require('bcrypt');
const transporter = require('../utils/email');

// API: Register
router.post('/register', async (req, res) => {
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
router.post('/login', async (req, res) => {
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
                    await transporter.sendMail(mailOptions);
                    console.log(`✅ OTP sent successfully to ${user.email}`);
                } catch (mailError) {
                    console.error('❌ Nodemailer Error details:', mailError);
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
                if (err) console.error('Session Save Error (Admin):', err);
                console.log('Session saved for Admin:', req.session.user.name);
                return res.json({ role: user.role });
            });
        } else {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
    } catch (err) {
        console.error('Login Error:', err);
        return res.status(500).json({ error: 'Server error' });
    }
});

// API: Verify OTP
router.post('/verify-otp', async (req, res) => {
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
            if (err) console.error('Session Save Error (Tenant):', err);
            console.log('Session saved for Tenant:', req.session.user.name);
            res.json({ success: true, role: 'tenant' });
        });

    } catch (err) {
        console.error('OTP Verification Error:', err);
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

module.exports = router;
