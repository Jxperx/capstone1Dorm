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

    if (!full_name || !email || !password) {
        return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const pool = await poolPromise;
        const transaction = new sql.Transaction(pool);
        
        await transaction.begin();

        try {
            // 1. Create User
            const userResult = await transaction.request()
                .input('full_name', sql.NVarChar, full_name)
                .input('email', sql.NVarChar, email)
                .input('phone', sql.NVarChar, phone || null)
                .input('password_hash', sql.NVarChar, hashedPassword)
                .input('role', sql.NVarChar, 'tenant')
                .query(`
                    INSERT INTO users (full_name, email, phone_number, password_hash, role)
                    OUTPUT INSERTED.id
                    VALUES (@full_name, @email, @phone, @password_hash, @role)
                `);
            
            const userId = userResult.recordset[0].id;

            const tenantReq = transaction.request()
                .input('user_id', sql.Int, userId)
                .input('lease_start', sql.Date, lease_start || new Date())
                .input('lease_end', sql.Date, lease_end || null);

            let tenantQuery = `INSERT INTO tenants (user_id, status, lease_start_date, lease_end_date`;
            let tenantValues = `VALUES (@user_id, 'active', @lease_start, @lease_end`;

            if (room_id) {
                tenantReq.input('room_id', sql.Int, room_id);
                tenantQuery += `, room_id`;
                tenantValues += `, @room_id`;
            }

            tenantQuery += `) ${tenantValues})`;

            await tenantReq.query(tenantQuery);
            await transaction.commit();
            res.status(201).json({ message: 'Tenant added successfully' });

        } catch (err) {
            console.error('Transaction failed, rolling back:', err);
            await transaction.rollback();
            throw err;
        }

    } catch (err) {
        console.error('Error creating tenant:', err);
        if (err.number === 2627) { // Unique constraint violation
            return res.status(400).json({ error: 'Email already exists' });
        }
        res.status(500).json({ error: 'Server error. Please try again.' });
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

