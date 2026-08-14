const { poolPromise } = require('./config/db');

async function checkDates() {
    try {
        const pool = await poolPromise;
        const res = await pool.request().query("SELECT COLUMN_NAME, TABLE_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME IN ('payments', 'maintenance_requests') AND (COLUMN_NAME LIKE '%date%' OR COLUMN_NAME LIKE '%time%' OR COLUMN_NAME LIKE '%created%')");
        console.table(res.recordset);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
checkDates();
