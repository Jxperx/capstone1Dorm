const { poolPromise } = require('./config/db');

async function check() {
    try {
        const pool = await poolPromise;
        const res = await pool.request().query(`
            SELECT name, object_definition(object_id) as definition 
            FROM sys.triggers 
            WHERE parent_id = OBJECT_ID('tenants')
        `);
        console.table(res.recordset);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
check();
