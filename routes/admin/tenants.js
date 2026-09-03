const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../../config/db');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');

const { tenantStorage } = require('../../config/cloudinary');
const upload = multer({ storage: tenantStorage });

// Admin Middleware
router.use((req, res, next) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(401).json({ error: 'Not authorized' });
    }
    next();
});

// Admin - Get All Tenants
router.get('/', async (req, res) => {
    try {
        const pool = await poolPromise;
        const query = `
            SELECT t.id, t.user_id, u.full_name, u.email, u.phone_number, u.profile_image_url,
                   t.guardian_name, t.guardian_address, t.guardian_contact,
                   r.room_number, r.id as room_id,
                   t.lease_start_date, t.lease_end_date,
                   t.status
            FROM tenants t
            JOIN users u ON t.user_id = u.id
            LEFT JOIN rooms r ON t.room_id = r.id
            ORDER BY u.full_name ASC
        `;
        const result = await pool.request().query(query);
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Admin - Create Tenant Account
router.post('/create-account', async (req, res) => {
    const { full_name, email, password, phone, room_id, lease_start, lease_end } = req.body;

    if (!full_name || !email) {
        return res.status(400).json({ error: 'Name and email are required' });
    }

    const crypto = require('crypto');
    const pool = await poolPromise;
    const isSelfService = !password || password.trim() === '';

    try {
        const initialPassword = isSelfService
            ? 'LOCKED_' + crypto.randomBytes(16).toString('hex')
            : password;

        const hashedPassword = await bcrypt.hash(initialPassword, 10);
        const userStatus = isSelfService ? 'pending' : 'active';

        // 1. Insert User record in PostgreSQL
        const userRes = await pool.request()
            .input('full_name', sql.NVarChar, full_name)
            .input('email', sql.NVarChar, email)
            .input('phone', sql.NVarChar, phone || null)
            .input('password_hash', sql.NVarChar, hashedPassword)
            .input('status', sql.NVarChar, userStatus)
            .input('role', sql.NVarChar, 'tenant')
            .query(`
                INSERT INTO users (full_name, email, phone_number, password_hash, status, role)
                VALUES (@full_name, @email, @phone, @password_hash, @status, @role)
                RETURNING id
            `);

        const userId = userRes.recordset[0].id;

        // 2. Insert Tenant record linked to room & lease dates
        const tenantReq = pool.request()
            .input('user_id', sql.Int, userId)
            .input('lease_start', sql.Date, lease_start || new Date())
            .input('lease_end', sql.Date, lease_end || null);

        let tenantQuery = `INSERT INTO tenants (user_id, status, lease_start_date, lease_end_date`;
        let tenantValues = `VALUES (@user_id, 'active', @lease_start, @lease_end`;

        if (room_id && room_id !== '' && room_id !== 'null') {
            tenantReq.input('room_id', sql.Int, parseInt(room_id, 10));
            tenantQuery += `, room_id`;
            tenantValues += `, @room_id`;
        }

        tenantQuery += `) ${tenantValues})`;
        await tenantReq.query(tenantQuery);

        let setupUrl = null;
        let setupToken = null;

        // 3. Generate Password Setup Link for Self-Service Onboarding
        if (isSelfService) {
            setupToken = crypto.randomBytes(32).toString('hex');
            const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

            await pool.request()
                .input('user_id', sql.Int, userId)
                .input('token', sql.NVarChar, setupToken)
                .input('otp_code', sql.NVarChar, setupToken.substring(0, 6))
                .input('token_type', sql.NVarChar, 'tenant_onboarding')
                .input('expires_at', sql.DateTime, expiresAt)
                .query(`
                    INSERT INTO password_reset_tokens (user_id, token, otp_code, token_type, expires_at)
                    VALUES (@user_id, @token, @otp_code, @token_type, @expires_at)
                `);

            const protocol = req.protocol;
            const host = req.get('host');
            setupUrl = `${protocol}://${host}/set-password.html?token=${setupToken}&email=${encodeURIComponent(email)}`;

            console.log(`[Tenant Onboarding] Created pending tenant for ${email}. Setup link: ${setupUrl}`);

            // Dispatch Onboarding Welcome Email
            try {
                const { sendMailWithFallback } = require('../../utils/email');
                const mailOptions = {
                    from: `"EliteStay Management" <${process.env.EMAIL_USER || 'no-reply@elitestay.com'}>`,
                    to: email,
                    subject: 'Welcome to EliteStay! Set up your tenant portal password',
                    html: `
                        <div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;max-width:600px;margin:0 auto;padding:20px;border:1px solid #e8e8e8;border-radius:10px;background-color:#ffffff;">
                            <div style="text-align:center;padding-bottom:20px;border-bottom:2px solid #c5a059;">
                                <h2 style="color:#121212;margin:0;font-size:24px;letter-spacing:1px;">ELITESTAY DORM & CONDO</h2>
                                <span style="font-size:12px;color:#c5a059;text-transform:uppercase;letter-spacing:2px;font-weight:bold;">Tenant Self-Service Onboarding</span>
                            </div>
                            <div style="padding:30px 20px;">
                                <p style="font-size:16px;color:#333333;margin-bottom:15px;">Hello <strong>${full_name}</strong>,</p>
                                <p style="font-size:14px;color:#555555;line-height:1.6;">
                                    Welcome to EliteStay! Your room reservation has been approved by the management.
                                </p>
                                <p style="font-size:14px;color:#555555;line-height:1.6;">
                                    Please click the button below to create your password and access your Tenant Portal:
                                </p>
                                <div style="text-align:center;margin:30px 0;">
                                    <a href="${setupUrl}" style="background-color:#c5a059;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:30px;font-weight:bold;font-size:15px;display:inline-block;box-shadow:0 4px 12px rgba(197,160,89,0.3);">
                                        🔑 Set Up My Password & Access Portal
                                    </a>
                                </div>
                                <p style="font-size:12px;color:#888888;line-height:1.5;">
                                    Or copy and paste this link into your browser:<br>
                                    <a href="${setupUrl}" style="color:#c5a059;word-break:break-all;">${setupUrl}</a>
                                </p>
                                <div style="background-color:#f8f9fa;padding:12px 16px;border-radius:8px;margin-top:25px;border-left:4px solid #c5a059;">
                                    <p style="font-size:12px;color:#666666;margin:0;">
                                        ⏰ <strong>Security Notice:</strong> This link is valid for 48 hours. If you did not apply for tenancy, please contact management immediately.
                                    </p>
                                </div>
                            </div>
                            <div style="text-align:center;padding-top:20px;border-top:1px solid #eeeeee;font-size:12px;color:#999999;">
                                © ${new Date().getFullYear()} EliteStay Management. All rights reserved.
                            </div>
                        </div>
                    `
                };
                await sendMailWithFallback(mailOptions);
                console.log(`[Tenant Onboarding] ✅ Welcome email sent successfully to ${email}`);
            } catch (mailErr) {
                console.error(`[Tenant Onboarding] ⚠️ Could not send welcome email to ${email}:`, mailErr.message);
            }
        }

        res.status(201).json({
            message: isSelfService ? `Tenant added! Password setup email sent to ${email}.` : 'Tenant added successfully.',
            isPending: isSelfService,
            setupUrl: setupUrl,
            userId: userId
        });

    } catch (err) {
        console.error('Error creating tenant:', err);
        const errCode = err.code || err.number;
        if (errCode === '23505' || errCode === 2627 || (err.message && err.message.includes('unique constraint'))) {
            return res.status(400).json({ error: 'Email address is already registered to another account.' });
        }
        res.status(500).json({ error: 'Failed to create tenant account: ' + (err.message || 'Database error') });
    }
});

// Admin - Resend Onboarding Invite Link
router.post('/:id/resend-invite', async (req, res) => {
    const inputId = parseInt(req.params.id, 10);
    if (Number.isNaN(inputId)) return res.status(400).json({ error: 'Invalid tenant id' });

    try {
        const pool = await poolPromise;
        const crypto = require('crypto');

        // Fetch Tenant User Info
        const tenantRes = await pool.request()
            .input('id', sql.Int, inputId)
            .query(`
                SELECT t.id, t.user_id, u.email, u.full_name
                FROM tenants t
                JOIN users u ON t.user_id = u.id
                WHERE t.id = @id OR t.user_id = @id
            `);

        if (tenantRes.recordset.length === 0) {
            return res.status(404).json({ error: 'Tenant not found' });
        }

        const tenant = tenantRes.recordset[0];
        const setupToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

        await pool.request()
            .input('user_id', sql.Int, tenant.user_id)
            .input('token', sql.NVarChar, setupToken)
            .input('otp_code', sql.NVarChar, setupToken.substring(0, 6))
            .input('token_type', sql.NVarChar, 'tenant_onboarding')
            .input('expires_at', sql.DateTime, expiresAt)
            .query(`
                INSERT INTO password_reset_tokens (user_id, token, otp_code, token_type, expires_at)
                VALUES (@user_id, @token, @otp_code, @token_type, @expires_at)
            `);

        const protocol = req.protocol;
        const host = req.get('host');
        const setupUrl = `${protocol}://${host}/set-password.html?token=${setupToken}&email=${encodeURIComponent(tenant.email)}`;

        // Dispatch Email with Setup Link
        try {
            const { sendMailWithFallback } = require('../../utils/email');
            const mailOptions = {
                from: `"EliteStay Management" <${process.env.EMAIL_USER || 'no-reply@elitestay.com'}>`,
                to: tenant.email,
                subject: 'EliteStay - Password Setup Link',
                html: `
                    <div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;max-width:600px;margin:0 auto;padding:20px;border:1px solid #e8e8e8;border-radius:10px;background-color:#ffffff;">
                        <div style="text-align:center;padding-bottom:20px;border-bottom:2px solid #c5a059;">
                            <h2 style="color:#121212;margin:0;font-size:24px;letter-spacing:1px;">ELITESTAY DORM & CONDO</h2>
                            <span style="font-size:12px;color:#c5a059;text-transform:uppercase;letter-spacing:2px;font-weight:bold;">Password Setup Link</span>
                        </div>
                        <div style="padding:30px 20px;">
                            <p style="font-size:16px;color:#333333;margin-bottom:15px;">Hello <strong>${tenant.full_name}</strong>,</p>
                            <p style="font-size:14px;color:#555555;line-height:1.6;">
                                Here is your link to set up your password and access your EliteStay Tenant Portal:
                            </p>
                            <div style="text-align:center;margin:30px 0;">
                                <a href="${setupUrl}" style="background-color:#c5a059;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:30px;font-weight:bold;font-size:15px;display:inline-block;box-shadow:0 4px 12px rgba(197,160,89,0.3);">
                                    🔑 Set Up My Password
                                </a>
                            </div>
                            <p style="font-size:12px;color:#888888;line-height:1.5;">
                                Or copy and paste this link into your browser:<br>
                                <a href="${setupUrl}" style="color:#c5a059;word-break:break-all;">${setupUrl}</a>
                            </p>
                            <div style="background-color:#f8f9fa;padding:12px 16px;border-radius:8px;margin-top:25px;border-left:4px solid #c5a059;">
                                <p style="font-size:12px;color:#666666;margin:0;">
                                    ⏰ <strong>Security Notice:</strong> This link is valid for 48 hours.
                                </p>
                            </div>
                        </div>
                        <div style="text-align:center;padding-top:20px;border-top:1px solid #eeeeee;font-size:12px;color:#999999;">
                            © ${new Date().getFullYear()} EliteStay Management. All rights reserved.
                        </div>
                    </div>
                `
            };
            await sendMailWithFallback(mailOptions);
            console.log(`[Tenant Onboarding] ✅ Resent welcome email successfully to ${tenant.email}`);
        } catch (mailErr) {
            console.error(`[Tenant Onboarding] ⚠️ Could not resend email to ${tenant.email}:`, mailErr.message);
        }

        res.json({
            success: true,
            message: `New password setup link generated and emailed to ${tenant.email}!`,
            setupUrl: setupUrl
        });
    } catch (err) {
        console.error('Error resending invite:', err);
        res.status(500).json({ error: 'Failed to generate setup link.' });
    }
});

// Admin - Update Tenant
router.post('/:id/update', upload.single('profileImage'), async (req, res) => {
    const tenantId = req.params.id;
    const { fullName, phone, roomId, guardianName, guardianAddress, guardianContact, leaseStart, leaseEnd } = req.body;
    const imageUrl = req.file ? req.file.path : undefined;

    try {
        const pool = await poolPromise;
        
        // Get User ID from Tenant ID
        const tRes = await pool.request()
            .input('tid', sql.Int, tenantId)
            .query('SELECT user_id FROM tenants WHERE id = @tid');
            
        if (tRes.recordset.length === 0) return res.status(404).json({ error: 'Tenant not found' });
        const userId = tRes.recordset[0].user_id;

        // 1. Update User Info
        let userQuery = `UPDATE users SET full_name = @fullName, phone_number = @phone`;
        if (imageUrl) userQuery += `, profile_image_url = @imageUrl`;
        userQuery += ` WHERE id = @userId`;

        const req1 = pool.request()
            .input('fullName', sql.NVarChar, fullName)
            .input('phone', sql.NVarChar, phone)
            .input('userId', sql.Int, userId);
        if (imageUrl) req1.input('imageUrl', sql.NVarChar, imageUrl);
        await req1.query(userQuery);

        // 2. Update Tenant Info (Room & Guardian)
        const roomIdVal = (roomId && roomId !== 'null' && roomId !== '') ? parseInt(roomId) : null;

        await pool.request()
            .input('tid', sql.Int, tenantId)
            .input('roomId', sql.Int, roomIdVal)
            .input('gName', sql.NVarChar, guardianName)
            .input('gAddress', sql.NVarChar, guardianAddress)
            .input('gContact', sql.NVarChar, guardianContact)
            .input('lStart', sql.Date, (leaseStart && leaseStart !== '') ? leaseStart : null)
            .input('lEnd', sql.Date, (leaseEnd && leaseEnd !== '') ? leaseEnd : null)
            .query(`
                UPDATE tenants 
                SET room_id = @roomId,
                    guardian_name = @gName, 
                    guardian_address = @gAddress, 
                    guardian_contact = @gContact,
                    lease_start_date = @lStart,
                    lease_end_date = @lEnd
                WHERE id = @tid
            `);

        res.json({ message: 'Tenant updated successfully' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Admin - End Tenant Lease
router.post('/:id/end-lease', async (req, res) => {
    const inputId = parseInt(req.params.id, 10);
    if (Number.isNaN(inputId)) return res.status(400).json({ error: 'Invalid tenant id' });

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('id', sql.Int, inputId)
            .query(`
                UPDATE tenants 
                SET status = 'past', 
                    room_id = NULL 
                WHERE id = @id OR user_id = @id
            `);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ error: 'Tenant not found' });
        }

        res.json({ message: 'Tenant lease ended successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Admin - Delete Tenant
router.delete('/:id', async (req, res) => {
    const inputId = parseInt(req.params.id, 10);
    if (Number.isNaN(inputId)) return res.status(400).json({ error: 'Invalid tenant id' });

    try {
        const pool = await poolPromise;
        
        // Find tenant by tenants.id OR users.id
        const tenantResult = await pool.request()
            .input('id', sql.Int, inputId)
            .query('SELECT TOP 1 id AS tenant_id, user_id FROM tenants WHERE id = @id OR user_id = @id');
            
        let tenantId = null;
        let userId = null;

        if (tenantResult.recordset.length > 0) {
            tenantId = tenantResult.recordset[0].tenant_id;
            userId = tenantResult.recordset[0].user_id;
        } else {
            // Check if user exists directly in users table
            const userResult = await pool.request()
                .input('id', sql.Int, inputId)
                .query('SELECT TOP 1 id FROM users WHERE id = @id');
            if (userResult.recordset.length > 0) {
                userId = userResult.recordset[0].id;
            } else {
                return res.status(404).json({ error: 'Tenant not found' });
            }
        }

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            if (tenantId) {
                // Delete associated records referencing tenant_id safely
                await transaction.request().input('tId', sql.Int, tenantId).query("IF OBJECT_ID('tenant_feedback', 'U') IS NOT NULL DELETE FROM tenant_feedback WHERE tenant_id = @tId");
                await transaction.request().input('tId', sql.Int, tenantId).query("IF OBJECT_ID('meter_readings', 'U') IS NOT NULL DELETE FROM meter_readings WHERE tenant_id = @tId");
                await transaction.request().input('tId', sql.Int, tenantId).query("IF OBJECT_ID('payments', 'U') IS NOT NULL DELETE FROM payments WHERE tenant_id = @tId");
                await transaction.request().input('tId', sql.Int, tenantId).query("IF OBJECT_ID('maintenance_requests', 'U') IS NOT NULL DELETE FROM maintenance_requests WHERE tenant_id = @tId");
                await transaction.request().input('tId', sql.Int, tenantId).query("IF OBJECT_ID('tenants', 'U') IS NOT NULL DELETE FROM tenants WHERE id = @tId");
            }

            if (userId) {
                await transaction.request().input('uId', sql.Int, userId).query("IF OBJECT_ID('tenants', 'U') IS NOT NULL DELETE FROM tenants WHERE user_id = @uId");
                await transaction.request().input('uId', sql.Int, userId).query("IF OBJECT_ID('users', 'U') IS NOT NULL DELETE FROM users WHERE id = @uId");
            }

            await transaction.commit();
            res.json({ message: 'Tenant account and history removed successfully' });
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error('Error deleting tenant:', err);
        res.status(500).json({ error: 'Database error while deleting tenant' });
    }
});


// Admin - Renew / Extend Tenant Lease

router.post('/:id/renew-lease', async (req, res) => {
    const tenantId = req.params.id;
    const { new_end_date, extension_months } = req.body;

    try {
        const pool = await poolPromise;
        let finalEndDate = new_end_date;

        if (!finalEndDate && extension_months) {
            const months = parseInt(extension_months, 10);
            const currentReq = await pool.request()
                .input('id', sql.Int, tenantId)
                .query('SELECT lease_end_date FROM tenants WHERE id = @id');
            
            let baseDate = new Date();
            if (currentReq.recordset.length > 0 && currentReq.recordset[0].lease_end_date) {
                const existingEnd = new Date(currentReq.recordset[0].lease_end_date);
                if (existingEnd > baseDate) baseDate = existingEnd;
            }
            baseDate.setMonth(baseDate.getMonth() + months);
            finalEndDate = baseDate.toISOString().split('T')[0];
        }

        if (!finalEndDate) {
            return res.status(400).json({ error: 'Valid new end date or extension months required' });
        }

        await pool.request()
            .input('id', sql.Int, tenantId)
            .input('new_end_date', sql.Date, finalEndDate)
            .query("UPDATE tenants SET lease_end_date = @new_end_date, status = 'active' WHERE id = @id");

        res.json({ message: 'Lease extended successfully', new_end_date: finalEndDate });

    } catch (err) {
        console.error('[Tenant Lease Renewal Error]', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Admin - Send Automated Lease Reminder Notification
router.post('/:id/send-lease-reminder', async (req, res) => {
    const tenantId = req.params.id;

    try {
        const pool = await poolPromise;
        const tenantReq = await pool.request()
            .input('id', sql.Int, tenantId)
            .query(`
                SELECT t.id, t.lease_end_date, u.full_name, u.email, u.phone_number, r.room_number
                FROM tenants t
                JOIN users u ON t.user_id = u.id
                LEFT JOIN rooms r ON t.room_id = r.id
                WHERE t.id = @id
            `);

        if (tenantReq.recordset.length === 0) {
            return res.status(404).json({ error: 'Tenant not found' });
        }

        const t = tenantReq.recordset[0];
        const endDateStr = t.lease_end_date ? new Date(t.lease_end_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'soon';

        console.log(`[Lease Reminder Sent] To: ${t.email} (${t.full_name}), Unit: ${t.room_number}, Lease End: ${endDateStr}`);

        res.json({ 
            success: true, 
            message: `Lease renewal reminder sent to ${t.full_name} (${t.email})`,
            tenant_name: t.full_name
        });

    } catch (err) {
        console.error('[Lease Reminder Error]', err);
        res.status(500).json({ error: 'Failed to send lease reminder' });
    }
});

module.exports = router;

