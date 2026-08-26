const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../config/db');
const { analyzeFeedback } = require('../utils/aiFeedbackSentimentAnalyzer');
const { detectTrendsAndAlert } = require('../utils/feedbackTrendDetector');

/**
 * POST /api/feedback/submit
 * Tenant submits text-based feedback.
 */
router.post('/submit', async (req, res) => {
    // 1. Verify user (preserves existing logic by checking session)
    if (!req.session || !req.session.user || !req.session.user.id) {
        return res.status(401).json({ error: 'Unauthorized. Please login first.' });
    }
    
    // We use the tenant_id stored in session.
    // If not found (e.g. admin testing), we try to find one for the user.
    let tenantId = req.session.user.tenant_id;
    
    if (!tenantId) {
        // Try to find the tenant record from DB (handles incomplete session after login)
        try {
            const pool = await poolPromise;
            const tRes = await pool.request()
                .input('uid', sql.Int, req.session.user.id)
                .query('SELECT id FROM tenants WHERE user_id = @uid');
            if (tRes.recordset.length > 0) {
                tenantId = tRes.recordset[0].id;
                req.session.user.tenant_id = tenantId; // Cache for subsequent requests
            }
            // FIX: Removed the dummy INSERT fallback that created ghost tenant records
            // for admin users or sessions with no tenant association.
        } catch (e) { console.error('Error finding tenant for feedback:', e); }
    }

    if (!tenantId) {
        return res.status(403).json({ error: 'No tenant account linked to your session. Please contact admin.' });
    }

    const { feedback_text, survey_id } = req.body;

    if (!feedback_text || feedback_text.trim() === '') {
        return res.status(400).json({ error: 'Feedback text is required.' });
    }
    
    try {
        const pool = await poolPromise;
        
        // 2. Initial Safe Insert into Database
        const insertRes = await pool.request()
            .input('tenant_id', sql.Int, tenantId)
            .input('survey_id', sql.Int, survey_id || null)
            .input('feedback_text', sql.NVarChar, feedback_text)
            .query(`
                INSERT INTO tenant_feedback (tenant_id, survey_id, feedback_text) 
                OUTPUT INSERTED.id 
                VALUES (@tenant_id, @survey_id, @feedback_text)
            `);
            
        const fbId = insertRes.recordset[0].id;

        // 3. AI Processing (Non-blocking / Background Async)
        analyzeFeedback(feedback_text).then(async (ai) => {
            // Update newly created record with AI sentiment tracking properties
            await pool.request()
                .input('id', sql.Int, fbId)
                .input('sentiment', sql.NVarChar, ai.sentiment)
                .input('score', sql.Decimal(4,2), ai.score)
                .input('topics', sql.NVarChar, JSON.stringify(ai.topics))
                .input('keywords', sql.NVarChar, JSON.stringify(ai.keywords))
                .input('summary', sql.NVarChar(sql.MAX), ai.summary)
                .input('needs_attention', sql.Bit, ai.needsAttention ? 1 : 0)
                .input('confidence', sql.Decimal(5,2), ai.confidence)
                .query(`
                    UPDATE tenant_feedback 
                    SET ai_sentiment=@sentiment, 
                        ai_sentiment_score=@score, 
                        ai_topics=@topics, 
                        ai_keywords=@keywords, 
                        ai_summary=@summary, 
                        ai_needs_attention=@needs_attention,
                        ai_confidence=@confidence
                    WHERE id=@id
                `);
            
            // 4. Trigger Trend Detection Analysis on Background Thread
            await detectTrendsAndAlert();
            
        }).catch(err => console.error("[AI Feedback Pipeline] Fallback triggered:", err));

        // 5. Immediate response sent to tenant, without waiting for the AI loop
        res.json({ success: true, message: 'Thank you for your valuable feedback! The management team has received it.' });
        
    } catch (err) {
        console.error('[Feedback Submission Error]', err);
        res.status(500).json({ error: 'Database error occurred while submitting feedback.' });
    }
});

/**
 * GET /api/feedback/my-report
 * Fetches the current tenant's feedback history with AI analysis results.
 */
router.get('/my-report', async (req, res) => {
    if (!req.session || !req.session.user || !req.session.user.id) {
        return res.status(401).json({ error: 'Unauthorized. Please login first.' });
    }

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
        } catch (e) { console.error('Error finding tenant for report:', e); }
    }

    if (!tenantId) {
        return res.json([]);
    }

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('tenant_id', sql.Int, tenantId)
            .query(`
                SELECT 
                    id, 
                    feedback_text, 
                    ai_sentiment, 
                    ai_sentiment_score, 
                    ai_topics, 
                    ai_keywords, 
                    ai_summary, 
                    ai_needs_attention, 
                    ai_confidence, 
                    created_at
                FROM tenant_feedback
                WHERE tenant_id = @tenant_id
                ORDER BY created_at DESC
            `);

        // Parse JSON strings for topics and keywords
        const report = result.recordset.map(row => ({
            ...row,
            ai_topics: row.ai_topics ? JSON.parse(row.ai_topics) : [],
            ai_keywords: row.ai_keywords ? JSON.parse(row.ai_keywords) : []
        }));

        res.json(report);
    } catch (err) {
        console.error('[Feedback Report Error]', err);
        res.status(500).json({ error: 'Database error occurred while fetching your feedback report.' });
    }
});

module.exports = router;
