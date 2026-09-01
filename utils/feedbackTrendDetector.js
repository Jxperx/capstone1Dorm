/**
 * utils/feedbackTrendDetector.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Detects brewing issues by analyzing the ratio of negative feedback per topic.
 * 
 * Threshold Rules:
 *   - Minimum 3 total reviews on a topic (prevents single-review false alarms)
 *   - ≥ 50% Negative → Medium Priority Alert
 *   - ≥ 70% Negative → High Priority Alert
 * 
 * Stores negative_ratio and total_count in feedback_alerts for display.
 */

const { poolPromise, sql } = require('../config/db');

async function detectTrendsAndAlert() {
    try {
        const pool = await poolPromise;
        
        // 1. Fetch ALL feedback from the last 90 days (both positive and negative)
        //    so we can calculate the true negative ratio per topic
        const result = await pool.request().query(`
            SELECT id, ai_topics, ai_sentiment, ai_sentiment_score 
            FROM tenant_feedback 
            WHERE created_at >= DATEADD(day, -90, GETDATE())
        `);

        const feedbacks = result.recordset;
        if (feedbacks.length === 0) return;

        // 2. Aggregate counts by topic — track total, negative, and scores
        const topicStats = {};

        feedbacks.forEach(fb => {
            let topics = [];
            try {
                topics = JSON.parse(fb.ai_topics || '[]');
            } catch (e) {
                // Ignore parsing errors for legacy/corrupted rows
            }
            
            const score = parseFloat(fb.ai_sentiment_score) || 0;
            const isNegative = (fb.ai_sentiment === 'Negative' || score <= -0.3);

            topics.forEach(topic => {
                if (!topicStats[topic]) {
                    topicStats[topic] = { totalCount: 0, negativeCount: 0, totalScore: 0, keywords: [] };
                }
                topicStats[topic].totalCount += 1;
                topicStats[topic].totalScore += score;
                if (isNegative) {
                    topicStats[topic].negativeCount += 1;
                }
            });
        });

        // 3. Evaluate percentage-based rules and generate alerts
        const MIN_SAMPLE_SIZE = 3;    // Minimum reviews before triggering
        const MEDIUM_THRESHOLD = 0.50; // 50% negative → Medium
        const HIGH_THRESHOLD = 0.70;   // 70% negative → High

        for (const [topic, stats] of Object.entries(topicStats)) {
            // Skip topics without enough reviews
            if (stats.totalCount < MIN_SAMPLE_SIZE) continue;

            const negativeRatio = stats.negativeCount / stats.totalCount;
            const avgScore = stats.totalScore / stats.totalCount;

            // Only trigger if at least 50% negative
            if (negativeRatio < MEDIUM_THRESHOLD) continue;

            // Check if an unresolved alert for this topic already exists to avoid spam
            const existingAlertRes = await pool.request()
                .input('topic', sql.NVarChar, topic)
                .query(`
                    SELECT TOP 1 id FROM feedback_alerts 
                    WHERE issue_topic = @topic 
                      AND is_resolved = 0 
                      AND created_at >= DATEADD(day, -7, GETDATE())
                `);

            if (existingAlertRes.recordset.length === 0) {
                // Determine Severity based on percentage
                let severity, action;
                const pct = Math.round(negativeRatio * 100);

                if (negativeRatio >= HIGH_THRESHOLD) {
                    severity = 'High';
                    action = `URGENT: ${pct}% of tenant reviews about ${topic} are negative (${stats.negativeCount} of ${stats.totalCount}). Immediate inspection and resolution required.`;
                } else {
                    severity = 'Medium';
                    action = `${pct}% of tenant reviews about ${topic} are negative (${stats.negativeCount} of ${stats.totalCount}). Investigate and address recurring complaints soon.`;
                }

                // Insert Alert with ratio data
                const safeAvgScore = parseFloat(avgScore.toFixed(2));

                await pool.request()
                    .input('topic', sql.NVarChar, topic)
                    .input('negCount', sql.Int, stats.negativeCount)
                    .input('totalCount', sql.Int, stats.totalCount)
                    .input('avgScore', sql.Decimal(4,2), safeAvgScore)
                    .input('period', sql.NVarChar, '90_days')
                    .input('severity', sql.NVarChar, severity)
                    .input('action', sql.NVarChar, action)
                    .query(`
                        INSERT INTO feedback_alerts 
                        (issue_topic, negative_count, avg_sentiment_score, period_type, alert_severity, recommended_action)
                        VALUES (@topic, @negCount, @avgScore, @period, @severity, @action)
                    `);
                
                console.log(`[AI Trend Detector] Alert: ${topic} — ${pct}% negative (${stats.negativeCount}/${stats.totalCount}), Severity: ${severity}`);
            }
        }

    } catch (err) {
        console.error('[AI Trend Detector Error] Failed to aggregate and alert:', err);
    }
}

module.exports = { detectTrendsAndAlert };

