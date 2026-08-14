const { poolPromise, sql } = require('./config/db');
async function check() {
    try {
        const pool = await poolPromise;
        const res = await pool.request().query("SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE '%feedback%' OR TABLE_NAME LIKE '%survey%'");
        console.log("Feedback tables:", res.recordset);
    } catch(e) {
        console.log('Error:', e);
    } finally {
        process.exit();
    }
}
check();
