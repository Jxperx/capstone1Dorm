const { poolPromise, sql } = require('./config/db');
async function check() {
    try {
        const pool = await poolPromise;
        const res = await pool.request().query("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'tenant_feedback'");
        console.log('--- tenant_feedback Columns ---');
        console.table(res.recordset);
        
        const res2 = await pool.request().query("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'feedback_alerts'");
        console.log('--- feedback_alerts Columns ---');
        console.table(res2.recordset);
    } catch(e) {
        console.log('Error:', e);
    } finally {
        process.exit();
    }
}
check();
