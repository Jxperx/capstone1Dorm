const { poolPromise, sql } = require('./config/db');
const { analyzeFeedback } = require('./utils/aiFeedbackSentimentAnalyzer');
const { detectTrendsAndAlert } = require('./utils/feedbackTrendDetector');

const tests = [
    "The WiFi is always slow.",
    "The hallway is noisy at night.",
    "The staff is very helpful.",
    "The bathroom smells bad.",
    "The internet is unreliable and affects my online classes.",
    "The hallway is too noisy, I can't sleep.", // Extra noise to trigger alert
    "People yelling in the hallway, very noisy." // Extra noise to trigger alert
];

async function runTests() {
    try {
        const pool = await poolPromise;
        console.log('--- Starting AI Feedback Tests ---');

        // Fetch a valid tenant ID to associate with the dummy feedback
        const tenantRes = await pool.request().query('SELECT TOP 1 id FROM tenants');
        const tId = tenantRes.recordset.length > 0 ? tenantRes.recordset[0].id : 1;

        for (const text of tests) {
            console.log(`\nAnalyzing: "${text}"`);
            const ai = await analyzeFeedback(text);
            console.log('Result:', JSON.stringify(ai, null, 2));

            // Insert into Database simulating the route behavior
            await pool.request()
                .input('tenant_id', sql.Int, tId)
                .input('text', sql.NVarChar, text)
                .input('sentiment', sql.NVarChar, ai.sentiment)
                .input('score', sql.Decimal(4,2), ai.score)
                .input('topics', sql.NVarChar, JSON.stringify(ai.topics))
                .input('keywords', sql.NVarChar, JSON.stringify(ai.keywords))
                .input('summary', sql.NVarChar(sql.MAX), ai.summary)
                .input('needs_attention', sql.Bit, ai.needsAttention ? 1 : 0)
                .input('confidence', sql.Decimal(5,2), ai.confidence)
                .query(`
                    INSERT INTO tenant_feedback 
                    (tenant_id, feedback_text, ai_sentiment, ai_sentiment_score, ai_topics, ai_keywords, ai_summary, ai_needs_attention, ai_confidence)
                    VALUES (@tenant_id, @text, @sentiment, @score, @topics, @keywords, @summary, @needs_attention, @confidence)
                `);
        }

        console.log('\n--- Running Trend Detector ---');
        await detectTrendsAndAlert();

        console.log('\n--- Checking Alerts Table ---');
        const alertRes = await pool.request().query('SELECT issue_topic, negative_count, avg_sentiment_score, alert_severity, recommended_action FROM feedback_alerts');
        console.table(alertRes.recordset);

    } catch(err) {
        console.error('Test failed:', err);
    } finally {
        process.exit();
    }
}

runTests();
