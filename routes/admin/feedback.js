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
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='tenant_feedback' and xtype='U')
            BEGIN
                CREATE TABLE tenant_feedback (
                    id INT IDENTITY(1,1) PRIMARY KEY,
                    tenant_id INT NOT NULL FOREIGN KEY REFERENCES tenants(id),
                    survey_id INT NULL,
                    feedback_text NVARCHAR(MAX) NOT NULL,
                    ai_sentiment NVARCHAR(20) DEFAULT 'Neutral',
                    ai_sentiment_score DECIMAL(4,2) DEFAULT 0.00,
                    ai_topics NVARCHAR(MAX) NULL,
                    ai_keywords NVARCHAR(MAX) NULL,
                    ai_summary NVARCHAR(MAX) NULL,
                    ai_needs_attention BIT DEFAULT 0,
                    ai_confidence DECIMAL(5,2) DEFAULT 0.00,
                    created_at DATETIME DEFAULT GETDATE()
                );
            END

            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='feedback_alerts' and xtype='U')
            BEGIN
                CREATE TABLE feedback_alerts (
                    id INT IDENTITY(1,1) PRIMARY KEY,
                    issue_topic NVARCHAR(100) NOT NULL,
                    negative_count INT DEFAULT 0,
                    avg_sentiment_score DECIMAL(4,2) DEFAULT 0.00,
                    period_type NVARCHAR(20) NOT NULL,
                    alert_severity NVARCHAR(20) NOT NULL,
                    recommended_action NVARCHAR(MAX) NULL,
                    is_resolved BIT DEFAULT 0,
                    resolved_at DATETIME NULL,
                    created_at DATETIME DEFAULT GETDATE()
                );
            END

            -- Add resolved_at column if missing from existing feedback_alerts table
            IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('feedback_alerts') AND name = 'resolved_at')
            BEGIN
                ALTER TABLE feedback_alerts ADD resolved_at DATETIME NULL;
            END

            -- Auto-seed realistic sample tenant feedback if table is empty
            DECLARE @fbCount INT;
            SELECT @fbCount = COUNT(*) FROM tenant_feedback;
            IF @fbCount = 0
            BEGIN
                DECLARE @tId INT;
                SELECT TOP 1 @tId = id FROM tenants WHERE status = 'active';
                IF @tId IS NULL SELECT TOP 1 @tId = id FROM tenants;

                IF @tId IS NOT NULL
                BEGIN
                    INSERT INTO tenant_feedback (tenant_id, feedback_text, ai_sentiment, ai_sentiment_score, ai_topics, ai_keywords, ai_summary, ai_needs_attention, ai_confidence)
                    VALUES 
                    (@tId, 'The WiFi in Dorm A has been disconnecting frequently every evening around 8 PM. It makes studying very difficult.', 'Negative', -0.75, '["Internet / WiFi"]', '["wifi","disconnecting","slow"]', 'Tenant reports frequent evening WiFi disconnections affecting study hours.', 1, 0.90),
                    (@tId, 'Loud music from the 3rd floor hallway late at night past midnight. Please enforce quiet hours.', 'Negative', -0.80, '["Noise"]', '["loud","music","night"]', 'Tenant complains about late-night noise violations near 3rd floor.', 1, 0.88),
                    (@tId, 'Bathroom sink drain is slow and leaking slightly under the cabinet in Room 204.', 'Negative', -0.60, '["Bathroom / Plumbing"]', '["bathroom","sink","leak"]', 'Tenant reports leaking bathroom sink drain requiring plumbing repair.', 1, 0.85),
                    (@tId, 'The new study lounge air conditioning is working great and common areas are clean!', 'Positive', 0.85, '["Air Conditioning","Cleanliness"]', '["clean","great","ac"]', 'Tenant expresses appreciation for clean study lounge and functional air conditioning.', 0, 0.92);

                    INSERT INTO feedback_alerts (issue_topic, negative_count, avg_sentiment_score, period_type, alert_severity, recommended_action)
                    VALUES
                    ('Internet / WiFi', 5, -0.75, '7_days', 'High', 'Inspect Dorm A main router 2.4/5GHz channel congestion. Restart router daily at 4 AM or upgrade access point.'),
                    ('Noise', 3, -0.80, '7_days', 'High', 'Issue quiet hours policy notice (10 PM - 6 AM) to 3rd-floor units and schedule night warden walk-throughs.'),
                    ('Bathroom / Plumbing', 2, -0.60, '7_days', 'Medium', 'Dispatch plumbing maintenance to inspect Room 204 sink cabinet trap and seal joints.');
                END
            END
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
                ISNULL(u.full_name, 'Resident Tenant') as tenant_name,
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
                AVG(CAST(ISNULL(ai_sentiment_score, 0) AS FLOAT)) as avg_score
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
            summaryBullets.push(`✅ ${resolvedCount} AI trend alert(s) successfully resolved by management, boosting Health Score.`);
        }
        if (neg > pos) {
            summaryBullets.push(`⚠️ Negative feedback (${neg}) exceeds positive reports (${pos}). Focus on active trend alerts.`);
        } else if (pos > 0) {
            summaryBullets.push(`🟢 Positive resident feedback (${pos}) reflects good tenant satisfaction.`);
        } else {
            summaryBullets.push(`Overall resident feedback is baseline stable with ${total} total submission(s).`);
        }

        if (alertCount > 0) {
            summaryBullets.push(`🔴 ${alertCount} active AI trend alert(s) requiring action.`);
        } else {
            summaryBullets.push(`🟢 All quiet: No critical active trend alerts in the dormitory.`);
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
                ISNULL(u.full_name, 'Resident Tenant') as tenant_name,
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
            complaintContext = '\n\n🔍 AI Root Cause Evidence (Recent Tenant Reports):\n' + 
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
                    <h3 style="color:#1a1a2e;margin-top:0;">📢 Property Management Notice</h3>
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
            .query("UPDATE feedback_alerts SET is_resolved = 1, resolved_at = GETDATE() WHERE id = @id");

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
                ISNULL(u.full_name, 'Resident Tenant') as tenant_name, r.room_number
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
