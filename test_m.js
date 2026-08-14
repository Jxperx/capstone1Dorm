const { poolPromise } = require('./config/db');
async function test() {
    const pool = await poolPromise;
    const res = await pool.request().query('SELECT TOP 1 * FROM maintenance_requests');
    const cols = Object.keys(res.recordset[0] || {});
    console.log("ColsString:", JSON.stringify(cols));
    process.exit();
}
test();
