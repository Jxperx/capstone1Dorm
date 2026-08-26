const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../config/db');
const multer = require('multer');
const path = require('path');

const { profileStorage } = require('../config/cloudinary');
const upload = multer({ storage: profileStorage });

// API: Get Current User Profile (Common)
router.get('/me', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not authorized' });

    const userId = req.session.user.id;
    const role = req.session.user.role;

    try {
        const pool = await poolPromise;
        let query = '';
        
        if (role === 'tenant') {
            query = `
                SELECT u.full_name, u.email, u.phone_number, u.profile_image_url, 
                       t.guardian_name, t.guardian_address, t.guardian_contact,
                       t.lease_start_date, t.lease_end_date,
                       r.room_number, r.id as room_id, r.room_type, r.capacity, r.monthly_rate,
                       t.id as tenant_id,
                       (SELECT TOP 1 payment_date FROM payments WHERE tenant_id = t.id AND status = 'approved' ORDER BY payment_date DESC) as last_payment_date
                FROM users u
                LEFT JOIN tenants t ON u.id = t.user_id
                LEFT JOIN rooms r ON t.room_id = r.id
                WHERE u.id = @userId
            `;
        } else {
            // Admin
            query = `
                SELECT full_name, email, phone_number, profile_image_url, role
                FROM users
                WHERE id = @userId
            `;
        }

        const result = await pool.request()
            .input('userId', sql.Int, userId)
            .query(query);

        if (result.recordset.length > 0) {
            res.json(result.recordset[0]);
        } else {
            res.status(404).json({ error: 'User not found' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// API: Update Profile (Self)
router.post('/update', upload.single('profileImage'), async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not authorized' });

    const userId = req.session.user.id;
    const role = req.session.user.role;
    const { fullName, phone, guardianName, guardianAddress, guardianContact } = req.body;
    const imageUrl = req.file ? req.file.path : undefined;

    try {
        const pool = await poolPromise;
        
        // 1. Update User Table (Common)
        let userQuery = `UPDATE users SET full_name = @fullName, phone_number = @phone`;
        if (imageUrl) {
            userQuery += `, profile_image_url = @imageUrl`;
        }
        userQuery += ` WHERE id = @userId`;

        const req1 = pool.request()
            .input('fullName', sql.NVarChar, fullName)
            .input('phone', sql.NVarChar, phone)
            .input('userId', sql.Int, userId);
        
        if (imageUrl) req1.input('imageUrl', sql.NVarChar, imageUrl);
        
        await req1.query(userQuery);

        // 2. Update Tenant Table (If Tenant)
        if (role === 'tenant') {
            await pool.request()
                .input('userId', sql.Int, userId)
                .input('gName', sql.NVarChar, guardianName)
                .input('gAddress', sql.NVarChar, guardianAddress)
                .input('gContact', sql.NVarChar, guardianContact)
                .query(`
                    UPDATE tenants 
                    SET guardian_name = @gName, 
                        guardian_address = @gAddress, 
                        guardian_contact = @gContact 
                    WHERE user_id = @userId
                `);
        }

        // Update session name if changed
        req.session.user.name = fullName;

        res.json({ message: 'Profile updated successfully' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// API: Get Recent Activity
router.get('/recent-activity', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'tenant') {
        return res.status(401).json({ error: 'Not authorized' });
    }

    let tenantId = req.session.user.tenant_id;
    
    try {
        const pool = await poolPromise;
        if (!tenantId) {
            const tRes = await pool.request()
                .input('uid', sql.Int, req.session.user.id)
                .query('SELECT id FROM tenants WHERE user_id = @uid');
            if (tRes.recordset.length > 0) {
                tenantId = tRes.recordset[0].id;
                req.session.user.tenant_id = tenantId;
            } else {
                return res.json([]);
            }
        }

        const query = `
            SELECT 'payment' as type, created_at, amount, status, 'Rent Payment' as title
            FROM payments
            WHERE tenant_id = @tenantId
            UNION ALL
            SELECT 'maintenance' as type, reported_at as created_at, 0 as amount, status, title
            FROM maintenance_requests
            WHERE tenant_id = @tenantId
            ORDER BY created_at DESC
        `;
        
        const result = await pool.request()
            .input('tenantId', sql.Int, tenantId)
            .query(query);

        // Limit to top 5 recent activities
        res.json(result.recordset.slice(0, 5));
    } catch (err) {
        console.error('Error fetching recent activity:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

module.exports = router;
