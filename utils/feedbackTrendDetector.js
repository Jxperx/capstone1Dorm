/**
 * utils/feedbackTrendDetector.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Detects brewing issues by analyzing recent negative feedback in the database.
 * If thresholds are met (e.g., 3 negative mentions of the same topic in 7 days),
 * it inserts a high-severity alert into the feedback_alerts table for the admin.
 */

const { poolPromise, sql } = require('../config/db');

async function detectTrendsAndAlert() {
    try {
        const pool = await poolPromise;
        
        // 1. Fetch all Negative or Attention-Needed feedback from the last 7 days
        const result = await pool.request().query(`
            SELECT id, ai_topics, ai_sentiment_score 
            FROM tenant_feedback 
            WHERE (ai_sentiment = 'Negative' OR ai_needs_attention = 1)
              AND created_at >= DATEADD(day, -90, GETDATE())
        `);

        const feedbacks = result.recordset;
        if (feedbacks.length === 0) return;

        // 2. Aggregate counts and scores by Topic in memory
        const topicStats = {};

        feedbacks.forEach(fb => {
            let topics = [];
            try {
                topics = JSON.parse(fb.ai_topics || '[]');
            } catch (e) {
                // Ignore parsing errors for legacy/corrupted rows
            }
            
            topics.forEach(topic => {
                if (!topicStats[topic]) {
                    topicStats[topic] = { count: 0, totalScore: 0 };
                }
                topicStats[topic].count += 1;
                topicStats[topic].totalScore += (fb.ai_sentiment_score || 0);
            });
        });

        // 3. Evaluate rules and generate alerts
        for (const [topic, stats] of Object.entries(topicStats)) {
            const avgScore = stats.totalScore / stats.count;
            
            // Rule: 3 or more negative mentions, OR average score falls below -0.4
            if (stats.count >= 3 || avgScore <= -0.4) {
                
                // Check if an unresolved alert for this topic already exists recently to avoid spam
                const existingAlertRes = await pool.request()
                    .input('topic', sql.NVarChar, topic)
                    .query(`
                        SELECT TOP 1 id FROM feedback_alerts 
                        WHERE issue_topic = @topic 
                          AND is_resolved = 0 
                          AND created_at >= DATEADD(day, -7, GETDATE())
                    `);

                if (existingAlertRes.recordset.length === 0) {
                    // Determine Severity & Action
                    let severity = 'Low';
                    let action = 'Monitor the situation.';
                    
                    if (stats.count >= 5 || avgScore <= -0.7) {
                        severity = 'High';
                        action = `Immediate inspection required regarding ${topic}. Multiple severe complaints logged.`;
                    } else if (stats.count >= 3 || avgScore <= -0.4) {
                        severity = 'Medium';
                        action = `Investigate ${topic} issues soon. A recurring trend has been detected.`;
                    }

                    // Insert Alert
                    await pool.request()
                        .input('topic', sql.NVarChar, topic)
                        .input('count', sql.Int, stats.count)
                        .input('avgScore', sql.Decimal(4,2), avgScore)
                        .input('period', sql.NVarChar, '7_days')
                        .input('severity', sql.NVarChar, severity)
                        .input('action', sql.NVarChar, action)
                        .query(`
                            INSERT INTO feedback_alerts 
                            (issue_topic, negative_count, avg_sentiment_score, period_type, alert_severity, recommended_action)
                            VALUES (@topic, @count, @avgScore, @period, @severity, @action)
                        `);
                    
                    console.log(`[AI Trend Detector] Alert generated for ${topic} (Severity: ${severity})`);
                }
            }
        }

    } catch (err) {
        console.error('[AI Trend Detector Error] Failed to aggregate and alert:', err);
    }
}

module.exports = { detectTrendsAndAlert };
