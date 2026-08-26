const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../config/db');
const multer = require('multer');
const path = require('path');
const { classifyMaintenance } = require('../utils/aiMaintenanceClassifier');

const { maintenanceStorage } = require('../config/cloudinary');
const upload = multer({ storage: maintenanceStorage });

// Helper to resolve tenant_id for the logged-in user
async function getTenantId(req) {
    if (!req.session || !req.session.user) return null;
    let tenantId = req.session.user.tenant_id;
    if (!tenantId) {
        try {
            const pool = await poolPromise;
            const tRes = await pool.request()
                .input('uid', sql.Int, req.session.user.id)
                .query('SELECT id FROM tenants WHERE user_id = @uid');
            if (tRes.recordset.length > 0) {
                tenantId = tRes.recordset[0].id;
                req.session.user.tenant_id = tenantId;
            }
        } catch (e) {
            console.error('Error finding tenant for maintenance:', e);
        }
    }
    return tenantId;
}

// Report Maintenance Issue (with Image Upload, Urgency, & Preferred Schedule)
router.post('/report', upload.single('image'), async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Unauthorized. Please login first.' });
    }

    const tenantId = await getTenantId(req);
    if (!tenantId) {
        return res.status(403).json({ error: 'Not authorized. Maintenance reporting is only for tenants.' });
    }

    const { title, description, urgencyLevel, preferredSchedule } = req.body;
    const imageUrl = req.file ? req.file.path : null;

    try {
        const pool = await poolPromise;

        // Insert raw report with enhanced fields
        const insertResult = await pool.request()
            .input('tenant_id', sql.Int, tenantId)
            .input('title', sql.NVarChar, title || 'Maintenance Request')
            .input('description', sql.NVarChar, description || '')
            .input('photo_url', sql.NVarChar, imageUrl)
            .input('urgency_level', sql.NVarChar, urgencyLevel || 'normal')
            .input('preferred_schedule', sql.NVarChar, preferredSchedule || null)
            .query(`
                INSERT INTO maintenance_requests (tenant_id, title, description, status, photo_url, urgency_level, preferred_schedule)
                OUTPUT INSERTED.id
                VALUES (@tenant_id, @title, @description, 'pending', @photo_url, @urgency_level, @preferred_schedule)
            `);

        const reportId = insertResult.recordset[0].id;

        // Non-blocking AI Classification
        try {
            const inputText = `${title || ''} ${description || ''}`.trim();
            const ai = await classifyMaintenance(inputText);

            await pool.request()
                .input('id',          sql.Int,          reportId)
                .input('category',    sql.NVarChar,      ai.category)
                .input('priority',    sql.NVarChar,      ai.priority)
                .input('urgency',     sql.NVarChar,      ai.urgency)
                .input('department',  sql.NVarChar,      ai.department)
                .input('summary',     sql.NVarChar(sql.MAX), ai.summary)
                .input('keywords',    sql.NVarChar,      JSON.stringify(ai.keywords))
                .input('confidence',  sql.Decimal(5, 2), ai.confidence)
                .input('isEmergency', sql.Bit,           ai.isEmergency ? 1 : 0)
                .query(`
                    UPDATE maintenance_requests
                    SET ai_category     = @category,
                        ai_priority     = @priority,
                        ai_urgency      = @urgency,
                        ai_department   = @department,
                        ai_summary      = @summary,
                        ai_keywords     = @keywords,
                        ai_confidence   = @confidence,
                        ai_is_emergency = @isEmergency
                    WHERE id = @id
                `);

            console.log(`[AI Triage] Report #${reportId} → ${ai.priority} | ${ai.category}`);
        } catch (aiErr) {
            console.error('[AI Triage] Classification update failed:', aiErr.message);
        }

        res.json({ message: 'Issue reported successfully!', reportId });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// GET Tenant's Maintenance Requests
router.get('/my-requests', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const tenantId = await getTenantId(req);
    if (!tenantId) {
        return res.status(403).json({ error: 'Tenant access required' });
    }

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('tenantId', sql.Int, tenantId)
            .query(`
                SELECT id, title, description, status, photo_url, urgency_level, 
                       preferred_schedule, rating, feedback_comment, 
                       reported_at, resolved_at, ai_category, ai_priority
                FROM maintenance_requests
                WHERE tenant_id = @tenantId
                ORDER BY reported_at DESC
            `);

        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching maintenance requests:', err);
        res.status(500).json({ error: 'Failed to fetch maintenance requests' });
    }
});

// POST Rate & Review a Resolved Maintenance Request
router.post('/:id/rate', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const tenantId = await getTenantId(req);
    if (!tenantId) {
        return res.status(403).json({ error: 'Tenant access required' });
    }

    const requestId = req.params.id;
    const { rating, feedback } = req.body;

    if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'Please provide a valid rating between 1 and 5.' });
    }

    try {
        const pool = await poolPromise;
        const updateRes = await pool.request()
            .input('id', sql.Int, requestId)
            .input('tenantId', sql.Int, tenantId)
            .input('rating', sql.Int, rating)
            .input('feedback', sql.NVarChar, feedback || null)
            .query(`
                UPDATE maintenance_requests
                SET rating = @rating, feedback_comment = @feedback
                WHERE id = @id AND tenant_id = @tenantId AND status = 'resolved'
            `);

        if (updateRes.rowsAffected[0] === 0) {
            return res.status(400).json({ error: 'Request not found or not in resolved state.' });
        }

        res.json({ message: 'Thank you for your rating!' });
    } catch (err) {
        console.error('Error rating request:', err);
        res.status(500).json({ error: 'Failed to save rating' });
    }
});

module.exports = router;

