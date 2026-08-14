const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../../config/db');
const { sendDormRentReminders } = require('../../utils/reminders');
const { predictVacancyTrends } = require('../../utils/aiVacancyPredictor');

// Admin Middleware
router.use((req, res, next) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(401).json({ error: 'Not authorized' });
    }
    next();
});

// Admin - Get Stats
router.get('/', async (req, res) => {
    try {
        const pool = await poolPromise;
        
        // Total Revenue (Sum of approved payments)
        const revenueRes = await pool.request().query("SELECT SUM(amount) as total FROM payments WHERE status = 'approved'");
        const revenue = revenueRes.recordset[0].total || 0;

        // Pending Payments Count
        const pendingRes = await pool.request().query("SELECT COUNT(*) as count FROM payments WHERE status = 'pending'");
        const pending = pendingRes.recordset[0].count;

        // Open Issues Count
        const issuesRes = await pool.request().query("SELECT COUNT(*) as count FROM maintenance_requests WHERE status != 'resolved'");
        const issues = issuesRes.recordset[0].count;

        // Occupancy (Tenants with active status)
        const tenantsRes = await pool.request().query("SELECT COUNT(*) as count FROM tenants WHERE status = 'active'");
        const tenants = tenantsRes.recordset[0].count;

        // Total Capacity
        const capacityRes = await pool.request().query("SELECT SUM(capacity) as total FROM rooms");
        const capacity = capacityRes.recordset[0].total || 0;

        res.json({
            revenue,
            pending,
            issues,
            occupancy: `${tenants}/${capacity}`
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Admin - Trigger Rent Reminders Manually
router.post('/trigger-reminders', async (req, res) => {
    try {
        await sendDormRentReminders();
        res.json({ message: 'Rent reminders sent successfully to all active dorm tenants.' });
    } catch (err) {
        console.error('Manual Reminder Trigger Error:', err);
        res.status(500).json({ error: 'Failed to send reminders' });
    }
});

// Admin - Predictive Vacancy Analytics
router.get('/vacancy-prediction', async (req, res) => {
    try {
        const pool = await poolPromise;

        // Get occupancy
        const tenantsRes = await pool.request().query("SELECT COUNT(*) as count FROM tenants WHERE status = 'active'");
        const capacityRes = await pool.request().query("SELECT SUM(capacity) as total FROM rooms");
        const occupancy = `${tenantsRes.recordset[0].count}/${capacityRes.recordset[0].total || 0}`;

        // Get upcoming expirations
        const expirationsRes = await pool.request().query(`
            SELECT 
                ISNULL(SUM(CASE WHEN DATEDIFF(day, GETDATE(), lease_end_date) <= 30 THEN 1 ELSE 0 END), 0) as exp30,
                ISNULL(SUM(CASE WHEN DATEDIFF(day, GETDATE(), lease_end_date) > 30 AND DATEDIFF(day, GETDATE(), lease_end_date) <= 60 THEN 1 ELSE 0 END), 0) as exp60,
                ISNULL(SUM(CASE WHEN DATEDIFF(day, GETDATE(), lease_end_date) > 60 AND DATEDIFF(day, GETDATE(), lease_end_date) <= 90 THEN 1 ELSE 0 END), 0) as exp90
            FROM tenants 
            WHERE status = 'active' AND lease_end_date IS NOT NULL
        `);
        const exp = expirationsRes.recordset[0];

        // Get recent inquiry volume (last 30 days)
        let inquiryCount = 0;
        try {
            const inquiryRes = await pool.request().query(`
                SELECT COUNT(*) as count FROM inquiries 
                WHERE created_at >= DATEADD(day, -30, GETDATE())
            `);
            inquiryCount = inquiryRes.recordset[0].count;
        } catch (e) {
            // Ignore if inquiries table doesn't exist yet in some environments
            console.log('Inquiries table not found or empty, defaulting to 0');
        }

        // Get details of tenants expiring in < 30 days
        const namesRes = await pool.request().query(`
            SELECT t.id, u.full_name, u.email, u.phone_number, r.room_number, t.lease_end_date 
            FROM tenants t
            JOIN users u ON t.user_id = u.id
            LEFT JOIN rooms r ON t.room_id = r.id
            WHERE t.status = 'active' 
              AND t.lease_end_date IS NOT NULL 
              AND DATEDIFF(day, GETDATE(), t.lease_end_date) <= 30
        `);
        const expiringTenants = namesRes.recordset;

        const data = {
            occupancy,
            expiring30: exp.exp30 || 0,
            expiring60: exp.exp60 || 0,
            expiring90: exp.exp90 || 0,
            inquiryCount,
            expiringTenants
        };

        const prediction = await predictVacancyTrends(data);

        res.json({
            data,
            prediction
        });

    } catch (err) {
        console.error('Vacancy Prediction Error:', err);
        res.status(500).json({ error: 'Failed to generate prediction' });
    }
});

module.exports = router;
