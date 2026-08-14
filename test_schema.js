const { poolPromise, sql } = require('./config/db');
async function test() {
    try {
        const pool = await poolPromise;
        const res = await pool.request().query("SELECT TOP 1 * FROM rooms");
        console.log("Columns:", Object.keys(res.recordset[0]));
    } catch(e) {
        console.log('Error:', e);
    } finally {
        process.exit();
    }
}
test();
