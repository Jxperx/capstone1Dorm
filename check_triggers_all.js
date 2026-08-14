const { poolPromise, sql } = require('./config/db');

async function check() {
    try {
        const pool = await poolPromise;
        const res = await pool.request().query(`
            SELECT name, OBJECT_NAME(parent_id) as table_name
            FROM sys.triggers 
        `);
        console.table(res.recordset);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
check();
