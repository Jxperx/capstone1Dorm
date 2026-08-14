const { poolPromise, sql } = require('./config/db');

poolPromise.then(async (pool) => {
    try {
        const r = await pool.request().query(`
            SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'live_chat_messages' 
            ORDER BY ORDINAL_POSITION
        `);
        console.log('Table schema:');
        console.log(JSON.stringify(r.recordset, null, 2));

        // Also check row count
        const c = await pool.request().query(`SELECT COUNT(*) as cnt FROM live_chat_messages`);
        console.log('\nRow count:', c.recordset[0].cnt);

        // Sample last 5 messages
        const s = await pool.request().query(`SELECT TOP 5 * FROM live_chat_messages ORDER BY created_at DESC`);
        console.log('\nLast 5 messages:');
        console.log(JSON.stringify(s.recordset, null, 2));
    } catch (e) {
        console.error('Query error:', e.message);
    }
    process.exit(0);
}).catch(e => {
    console.error('DB connection error:', e.message);
    process.exit(1);
});
