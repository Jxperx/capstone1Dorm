const { poolPromise } = require('./config/db');

async function checkMaint() {
    try {
        const pool = await poolPromise;
        const res = await pool.request().query("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'maintenance_requests'");
        console.table(res.recordset);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
checkMaint();
