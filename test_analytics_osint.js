const { poolPromise } = require('./config/db');
poolPromise.then(async pool => {
    // Test 1: count inquiries
    const cnt = await pool.request().query('SELECT COUNT(*) AS total FROM inquiries');
    console.log('Total inquiries:', cnt.recordset[0].total);

    // Test 2: analytics summary (same query as the route)
    const summary = await pool.request().query(`
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'approved'   THEN 1 ELSE 0 END) AS approved,
            SUM(CASE WHEN status = 'flagged'    THEN 1 ELSE 0 END) AS flagged,
            SUM(CASE WHEN status = 'duplicate'  THEN 1 ELSE 0 END) AS duplicate,
            SUM(CASE WHEN status = 'suspicious' THEN 1 ELSE 0 END) AS suspicious,
            SUM(CASE WHEN ai_result = 'SPAM'    THEN 1 ELSE 0 END) AS ai_spam,
            SUM(CASE WHEN ai_result = 'REAL'    THEN 1 ELSE 0 END) AS ai_real
        FROM inquiries
    `);
    console.log('Analytics summary:', JSON.stringify(summary.recordset[0], null, 2));

    // Test 3: blocked IPs
    const blocked = await pool.request().query('SELECT COUNT(*) AS cnt FROM inquiry_blocked_ips');
    console.log('Blocked IPs:', blocked.recordset[0].cnt);

    process.exit(0);
}).catch(e => { console.error('DB Error:', e.message); process.exit(1); });
