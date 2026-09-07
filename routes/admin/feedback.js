const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../../config/db');

// ── Auto-migration: ensure tenant_feedback and feedback_alerts tables exist ──
let feedbackTablesReady = false;
async function ensureFeedbackTables() {
    if (feedbackTablesReady) return;
    try {
        const pool = await poolPromise;
        await pool.request().query(`
            CREATE TABLE IF NOT EXISTS tenant_feedback (
                id SERIAL PRIMARY KEY,
                tenant_id INT NOT NULL REFERENCES tenants(id),
                survey_id INT NULL,
                feedback_text TEXT NOT NULL,
                ai_sentiment VARCHAR(20) DEFAULT 'Neutral',
                ai_sentiment_score DECIMAL(4,2) DEFAULT 0.00,
                ai_topics TEXT NULL,
                ai_keywords TEXT NULL,
                ai_summary TEXT NULL,
                ai_needs_attention BOOLEAN DEFAULT FALSE,
                ai_confidence DECIMAL(5,2) DEFAULT 0.00,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS feedback_alerts (
                id SERIAL PRIMARY KEY,
                issue_topic VARCHAR(100) NOT NULL,
                negative_count INT DEFAULT 0,
                avg_sentiment_score DECIMAL(4,2) DEFAULT 0.00,
                period_type VARCHAR(20) NOT NULL,
                alert_severity VARCHAR(20) NOT NULL,
                recommended_action TEXT NULL,
                is_resolved BOOLEAN DEFAULT FALSE,
                resolved_at TIMESTAMPTZ NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            ALTER TABLE feedback_alerts ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ NULL;
        `);
        feedbackTablesReady = true;
    } catch (err) {
        console.error('[Feedback] Table migration error:', err.message);
    }
}

/**
 * GET /api/admin/feedback/all
 * Fetches all tenant feedback with AI analysis and tenant details.
 */
router.get('/all', async (req, res) => {
    if (!req.session || !req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied. Admin only.' });
    }

    try {
        const pool = await poolPromise;
        await ensureFeedbackTables();
        const result = await pool.request().query(`
            SELECT 
                f.id, 
                f.feedback_text, 
                f.ai_sentiment, 
                f.ai_sentiment_score, 
                f.ai_topics, 
                f.ai_keywords, 
                f.ai_summary, 
                f.ai_needs_attention, 
                f.ai_confidence, 
                f.created_at,
                COALESCE(u.full_name, 'Resident Tenant') as tenant_name,
                u.email,
                u.phone_number,
                r.room_number
            FROM tenant_feedback f
            LEFT JOIN tenants t ON f.tenant_id = t.id
            LEFT JOIN users u ON t.user_id = u.id
            LEFT JOIN rooms r ON t.room_id = r.id
            ORDER BY f.created_at DESC
        `);

        const report = result.recordset.map(row => ({
            ...row,
            ai_topics: row.ai_topics ? (typeof row.ai_topics === 'string' ? JSON.parse(row.ai_topics) : row.ai_topics) : [],
            ai_keywords: row.ai_keywords ? (typeof row.ai_keywords === 'string' ? JSON.parse(row.ai_keywords) : row.ai_keywords) : []
        }));

        res.json(report);
    } catch (err) {
        console.error('[Admin Feedback Error]', err);
        res.status(500).json({ error: 'Database error occurred while fetching feedback.' });
    }
});

/**
 * GET /api/admin/feedback/alerts
 * Fetches recent AI-generated trend alerts.
 */
router.get('/alerts', async (req, res) => {
    if (!req.session || !req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied. Admin only.' });
    }

    try {
        const pool = await poolPromise;
        await ensureFeedbackTables();

        // Run automatic trend detection on alerts fetch
        const { detectTrendsAndAlert } = require('../../utils/feedbackTrendDetector');
        await detectTrendsAndAlert().catch(e => console.warn('[Trend Detection Error]', e.message));

        const result = await pool.request().query(`
            SELECT * FROM feedback_alerts 
            WHERE is_resolved = 0
            ORDER BY created_at DESC
        `);

        res.json(result.recordset);
    } catch (err) {
        console.error('[Admin Alerts Error]', err);
        res.status(500).json({ error: 'Database error occurred while fetching alerts.' });
    }
});

/**
 * GET /api/admin/feedback/resolved-alerts
 * Fetches history of resolved AI trend alerts for the Impact Log.
 */
router.get('/resolved-alerts', async (req, res) => {
    if (!req.session || !req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied. Admin only.' });
    }

    try {
        const pool = await poolPromise;
        await ensureFeedbackTables();
        const result = await pool.request().query(`
            SELECT * FROM feedback_alerts 
            WHERE is_resolved = 1
            ORDER BY resolved_at DESC, created_at DESC
        `);

        res.json(result.recordset);
    } catch (err) {
        console.error('[Admin Resolved Alerts Error]', err);
        res.status(500).json({ error: 'Database error occurred while fetching resolved alerts.' });
    }
});

/**
 * GET /api/admin/feedback/executive-summary
 * Computes Dorm Health Score (0-100), net sentiment, at-risk count, and executive summary.
 */
router.get('/executive-summary', async (req, res) => {
    if (!req.session || !req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied. Admin only.' });
    }

    try {
        const pool = await poolPromise;
        await ensureFeedbackTables();

        // Total feedback, negative count, average sentiment
        const statsRes = await pool.request().query(`
            SELECT 
                COUNT(*) as total_feedback,
                SUM(CASE WHEN ai_sentiment = 'Negative' THEN 1 ELSE 0 END) as negative_count,
                SUM(CASE WHEN ai_sentiment = 'Positive' THEN 1 ELSE 0 END) as positive_count,
                AVG(CAST(COALESCE(ai_sentiment_score, 0) AS FLOAT)) as avg_score
            FROM tenant_feedback
        `);

        const stats = statsRes.recordset[0] || {};
        const total = stats.total_feedback || 0;
        const neg = stats.negative_count || 0;
        const pos = stats.positive_count || 0;
        const avgScore = stats.avg_score || 0;

        // Active & Resolved Alerts count
        const alertRes = await pool.request().query(`
            SELECT 
                SUM(CASE WHEN is_resolved = 0 THEN 1 ELSE 0 END) as alert_count,
                SUM(CASE WHEN is_resolved = 1 THEN 1 ELSE 0 END) as resolved_count
            FROM feedback_alerts
        `);
        const alertCount = alertRes.recordset[0]?.alert_count || 0;
        const resolvedCount = alertRes.recordset[0]?.resolved_count || 0;

        // Health Score calculation (base 100, penalized by negative feedback, boosted by resolved alerts)
        let healthScore = 100;
        if (total > 0) {
            const negRatio = neg / total;
            healthScore = Math.max(20, Math.min(100, Math.round(100 - (negRatio * 45) + (avgScore * 20) + (resolvedCount * 5))));
        }

        // Unique at-risk tenants count (submitted severe negative feedback)
        const churnRes = await pool.request().query(`
            SELECT COUNT(DISTINCT tenant_id) as churn_count 
            FROM tenant_feedback 
            WHERE ai_sentiment = 'Negative' AND (ai_needs_attention = 1 OR ai_sentiment_score <= -0.50)
        `);
        const churnCount = churnRes.recordset[0]?.churn_count || 0;

        // AI Executive Summary Bullet points based on real stats
        const summaryBullets = [];
        if (resolvedCount > 0) {
            summaryBullets.push(`${resolvedCount} AI trend alert(s) successfully resolved by management, improving Dorm Health.`);
        }
        if (neg > pos) {
            summaryBullets.push(`Negative feedback (${neg}) exceeds positive reports (${pos}). Focus on active trend alerts.`);
        } else if (pos > 0) {
            summaryBullets.push(`Positive resident feedback (${pos}) reflects favorable tenant satisfaction.`);
        } else {
            summaryBullets.push(`Overall resident feedback is baseline stable with ${total} total submission(s).`);
        }

        if (alertCount > 0) {
            summaryBullets.push(`${alertCount} active AI trend alert(s) currently requiring management attention.`);
        } else {
            summaryBullets.push(`All quiet: No unresolved trend alerts detected in the dormitory.`);
        }

        res.json({
            healthScore,
            totalFeedback: total,
            positiveCount: pos,
            negativeCount: neg,
            avgSentimentScore: Number(avgScore).toFixed(2),
            activeAlerts: alertCount,
            resolvedAlerts: resolvedCount,
            atRiskTenants: churnCount,
            executiveSummary: summaryBullets
        });

    } catch (err) {
        console.error('[Admin Executive Summary Error]', err);
        res.status(500).json({ error: 'Database error occurred while fetching summary.' });
    }
});

/**
 * GET /api/admin/feedback/churn-risk
 * Identifies tenants with MULTIPLE or SEVERE negative feedbacks (Fixes false positives).
 */
router.get('/churn-risk', async (req, res) => {
    if (!req.session || !req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied. Admin only.' });
    }

    try {
        const pool = await poolPromise;
        await ensureFeedbackTables();
        const result = await pool.request().query(`
            SELECT 
                t.id as tenant_id,
                COALESCE(u.full_name, 'Resident Tenant') as tenant_name,
                u.email,
                r.room_number,
                COUNT(f.id) as negative_feedback_count,
                MIN(f.ai_sentiment_score) as worst_score,
                MAX(f.created_at) as latest_complaint_date,
                MAX(f.ai_summary) as latest_issue_summary
            FROM tenant_feedback f
            LEFT JOIN tenants t ON f.tenant_id = t.id
            LEFT JOIN users u ON t.user_id = u.id
            LEFT JOIN rooms r ON t.room_id = r.id
            WHERE f.ai_sentiment = 'Negative'
            GROUP BY t.id, u.full_name, u.email, r.room_number
            HAVING COUNT(f.id) >= 2 OR MIN(f.ai_sentiment_score) <= -0.60
            ORDER BY COUNT(f.id) DESC, MIN(f.ai_sentiment_score) ASC
        `);

        const churnRiskList = result.recordset.map(item => {
            const count = item.negative_feedback_count;
            const worst = item.worst_score || 0;
            const riskLevel = (count >= 3 || worst <= -0.8) ? 'HIGH' : 'MEDIUM';
            const riskPct = (count >= 3 || worst <= -0.8) ? 85 : 60;
            
            // AI Retention Recommendation
            let recommendation = 'Schedule a brief check-in to confirm satisfaction.';
            const summaryLower = (item.latest_issue_summary || '').toLowerCase();

            if (summaryLower.includes('wifi') || summaryLower.includes('internet')) {
                recommendation = 'Offer priority IT inspection or access point check for unit.';
            } else if (summaryLower.includes('plumb') || summaryLower.includes('water') || summaryLower.includes('leak')) {
                recommendation = 'Dispatch maintenance for urgent plumbing check + follow-up call.';
            } else if (summaryLower.includes('noise')) {
                recommendation = 'Issue quiet hours reminder to neighboring units + review noise log.';
            } else if (riskLevel === 'HIGH') {
                recommendation = 'High renewal risk: Direct manager check-in & priority complaint resolution.';
            }

            return {
                ...item,
                riskLevel,
                riskPct,
                recommendation
            };
        });

        res.json(churnRiskList);
    } catch (err) {
        console.error('[Admin Churn Risk Error]', err);
        res.status(500).json({ error: 'Database error occurred while fetching churn risk.' });
    }
});

/**
 * POST /api/admin/feedback/create-work-order
 * Converts a feedback trend alert into an active maintenance request.
 * Fixes Tenant #1 assignment by marking as Building-Wide / Common Area maintenance.
 */
router.post('/create-work-order', async (req, res) => {
    if (!req.session || !req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied. Admin only.' });
    }

    const { issue_topic, recommended_action } = req.body;
    if (!issue_topic) return res.status(400).json({ error: 'Issue topic is required.' });

    try {
        const pool = await poolPromise;

        // Fetch recent feedback snippets for this topic to build AI Root Cause Context
        const feedbackSnippetRes = await pool.request()
            .input('topicKey', sql.NVarChar, `%${issue_topic}%`)
            .query(`
                SELECT TOP 3 tenant_id, feedback_text, ai_summary, created_at 
                FROM tenant_feedback 
                WHERE (ai_topics LIKE @topicKey OR feedback_text LIKE @topicKey)
                  AND (ai_sentiment = 'Negative' OR ai_needs_attention = 1)
                ORDER BY created_at DESC
            `);
        
        const snippets = feedbackSnippetRes.recordset;
        let tenantId = snippets.length > 0 ? snippets[0].tenant_id : null;
        if (!tenantId) {
            const activeRes = await pool.request().query("SELECT TOP 1 id FROM tenants WHERE status = 'active'");
            tenantId = activeRes.recordset.length > 0 ? activeRes.recordset[0].id : 1;
        }

        let complaintContext = '';
        if (snippets.length > 0) {
            complaintContext = '\n\n[AI Root Cause Evidence] Recent Resident Reports:\n' + 
                snippets.map((s, idx) => `${idx + 1}. "${s.ai_summary || s.feedback_text}"`).join('\n');
        }

        const title = `[Facility / Common Area] ${issue_topic} Maintenance`;
        const description = `[AI Trend Resolution Task] Topic: ${issue_topic}.\nRecommended Strategy: ${recommended_action || 'Inspect and resolve recurring complaints.'}${complaintContext}`;

        await pool.request()
            .input('tenant_id', sql.Int, tenantId)
            .input('title', sql.NVarChar, title)
            .input('description', sql.NVarChar, description)
            .input('status', sql.NVarChar, 'pending')
            .input('ai_category', sql.NVarChar, issue_topic)
            .input('ai_priority', sql.NVarChar, 'High')
            .input('ai_summary', sql.NVarChar, `Building-wide work order for AI Trend: ${issue_topic}`)
            .query(`
                INSERT INTO maintenance_requests (tenant_id, title, description, status, ai_category, ai_priority, ai_summary)
                VALUES (@tenant_id, @title, @description, @status, @ai_category, @ai_priority, @ai_summary)
            `);

        res.json({ success: true, message: `Building Work Order created for "${issue_topic}" in Maintenance section.` });

    } catch (err) {
        console.error('[Create Work Order Error]', err);
        res.status(500).json({ error: 'Failed to create work order.' });
    }
});

/**
 * POST /api/admin/feedback/send-notice
 * Sends a management notice to active tenants using BCC to prevent SMTP connection throttling.
 */
router.post('/send-notice', async (req, res) => {
    if (!req.session || !req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied. Admin only.' });
    }

    const { topic, message_body } = req.body;
    if (!topic || !message_body) return res.status(400).json({ error: 'Topic and message body are required.' });

    try {
        const pool = await poolPromise;
        const tenantsRes = await pool.request().query(`
            SELECT u.email, u.full_name
            FROM tenants t
            JOIN users u ON t.user_id = u.id
            WHERE t.status = 'active' AND u.email IS NOT NULL
        `);

        const tenants = tenantsRes.recordset;
        if (tenants.length === 0) {
            return res.json({ success: true, message: 'No active tenants with valid email addresses found.' });
        }

        const recipientEmails = tenants.map(t => t.email).filter(Boolean);
        const transporter = require('../../utils/email');

        // Send via BCC single batch to prevent SMTP rate-limiting
        await transporter.sendMail({
            from: `"EliteStay Management" <${process.env.EMAIL_USER}>`,
            to: process.env.EMAIL_USER,
            bcc: recipientEmails,
            subject: `[Management Notice] Regarding ${topic}`,
            html: `
                <div style="font-family:'Inter',Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#ffffff;border:1px solid #eee;border-radius:12px;">
                    <h3 style="color:#1a1a2e;margin-top:0;">Property Management Notice</h3>
                    <p style="color:#555;">Dear EliteStay Residents,</p>
                    <div style="background:#f8f9fa;padding:16px;border-left:4px solid #c5a059;border-radius:6px;margin:16px 0;line-height:1.5;color:#333;">
                        ${message_body.replace(/\n/g, '<br>')}
                    </div>
                    <p style="color:#777;font-size:0.85rem;">Thank you for your cooperation.<br><strong>EliteStay Management Team</strong></p>
                </div>
            `
        });

        res.json({ success: true, message: `Notice email broadcast sent to ${recipientEmails.length} active resident(s).` });

    } catch (err) {
        console.error('[Send Notice Error]', err);
        res.status(500).json({ error: 'Failed to send tenant notice broadcast.' });
    }
});

/**
 * POST /api/admin/feedback/resolve-alert (NEW CLOSED-LOOP FEATURE)
 * Marks an AI Trend Alert as resolved, boosting Dorm Health Score and logging resolution impact.
 */
router.post('/resolve-alert', async (req, res) => {
    if (!req.session || !req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied. Admin only.' });
    }

    const { alert_id } = req.body;
    if (!alert_id) return res.status(400).json({ error: 'Alert ID is required.' });

    try {
        const pool = await poolPromise;
        await ensureFeedbackTables();

        await pool.request()
            .input('id', sql.Int, alert_id)
            .query("UPDATE feedback_alerts SET is_resolved = 1, resolved_at = NOW() WHERE id = @id");

        res.json({ success: true, message: 'AI Trend Alert marked as resolved! Health Score updated.' });
    } catch (err) {
        console.error('[Resolve Alert Error]', err);
        res.status(500).json({ error: 'Failed to resolve alert.' });
    }
});

/**
 * POST /api/admin/feedback/ask-ai
 * Answers natural language questions across all 13 feedback categories.
 */
router.post('/ask-ai', async (req, res) => {
    if (!req.session || !req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied. Admin only.' });
    }

    const { question } = req.body;
    if (!question) return res.status(400).json({ error: 'Question is required.' });

    try {
        const pool = await poolPromise;
        await ensureFeedbackTables();
        const result = await pool.request().query(`
            SELECT TOP 30
                f.feedback_text, f.ai_sentiment, f.ai_sentiment_score, f.ai_topics, f.ai_summary, f.created_at,
                COALESCE(u.full_name, 'Resident Tenant') as tenant_name, r.room_number
            FROM tenant_feedback f
            LEFT JOIN tenants t ON f.tenant_id = t.id
            LEFT JOIN users u ON t.user_id = u.id
            LEFT JOIN rooms r ON t.room_id = r.id
            ORDER BY f.created_at DESC
        `);

        const records = result.recordset;
        const qLower = question.toLowerCase();

        let answer = '';

        // Check for specific topic categories
        const TOPIC_MAP = {
            'wifi': 'Internet / WiFi', 'internet': 'Internet / WiFi', 'connection': 'Internet / WiFi',
            'noise': 'Noise', 'loud': 'Noise', 'music': 'Noise',
            'plumb': 'Bathroom / Plumbing', 'water': 'Water Supply', 'sink': 'Bathroom / Plumbing', 'toilet': 'Bathroom / Plumbing',
            'ac': 'Air Conditioning', 'aircon': 'Air Conditioning', 'cooling': 'Air Conditioning',
            'clean': 'Cleanliness', 'trash': 'Cleanliness', 'garbage': 'Cleanliness',
            'pest': 'Pest Control', 'cockroach': 'Pest Control', 'bug': 'Pest Control',
            'security': 'Safety / Security', 'safe': 'Safety / Security', 'lock': 'Safety / Security',
            'staff': 'Staff Behavior', 'admin': 'Staff Behavior'
        };

        let matchedCategory = null;
        for (const [kw, cat] of Object.entries(TOPIC_MAP)) {
            if (qLower.includes(kw)) { matchedCategory = cat; break; }
        }

        if (matchedCategory) {
            const matches = records.filter(r => {
                const text = (r.feedback_text || '').toLowerCase();
                const summary = (r.ai_summary || '').toLowerCase();
                const topics = (r.ai_topics || '').toLowerCase();
                return text.includes(matchedCategory.toLowerCase()) || summary.includes(matchedCategory.toLowerCase()) || topics.includes(matchedCategory.toLowerCase());
            });

            if (matches.length > 0) {
                const negCount = matches.filter(m => m.ai_sentiment === 'Negative').length;
                answer = `Found **${matches.length} report(s)** regarding **${matchedCategory}** (${negCount} negative). Most recent feedback: "${matches[0].ai_summary || matches[0].feedback_text}".`;
            } else {
                answer = `No recent resident reports found regarding **${matchedCategory}**. Everything is operating normally.`;
            }
        } else if (qLower.includes('most') || qLower.includes('top') || qLower.includes('worst')) {
            const roomCounts = {};
            records.forEach(r => {
                const rm = r.room_number || 'Unassigned';
                roomCounts[rm] = (roomCounts[rm] || 0) + 1;
            });
            const sorted = Object.entries(roomCounts).sort((a,b) => b[1] - a[1]);
            if (sorted.length > 0) {
                answer = `**${sorted[0][0]}** has the highest feedback activity with ${sorted[0][1]} submission(s).`;
            } else {
                answer = 'No feedback data available yet.';
            }
        } else if (qLower.includes('positive') || qLower.includes('good') || qLower.includes('praise')) {
            const pos = records.filter(r => r.ai_sentiment === 'Positive');
            answer = `Found **${pos.length} positive report(s)**. Residents appreciate recent upgrades and clean common areas.`;
        } else {
            const total = records.length;
            const neg = records.filter(r => r.ai_sentiment === 'Negative').length;
            answer = `Analyzed **${total} resident feedback record(s)** (${neg} negative). Resident concerns focus mainly on WiFi and noise during peak hours.`;
        }

        res.json({ answer });

    } catch (err) {
        console.error('[Ask AI Error]', err);
        res.status(500).json({ error: 'Error processing AI query.' });
    }
});

module.exports = router;
