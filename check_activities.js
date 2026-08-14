const { poolPromise } = require('./config/db');

async function checkActivities() {
    try {
        const pool = await poolPromise;
        const query = `
            SELECT 'payment' as type, created_at, amount, status, 'Rent Payment' as title
            FROM payments
            UNION ALL
            SELECT 'maintenance' as type, created_at, 0 as amount, status, title
            FROM maintenance_requests
            ORDER BY created_at DESC
        `;
        const res = await pool.request().query(query);
        console.table(res.recordset.slice(0, 5));
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
checkActivities();
