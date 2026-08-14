const { poolPromise } = require('./config/db');

async function checkRooms() {
    try {
        const pool = await poolPromise;
        const res = await pool.request().query("SELECT TOP 5 id, room_number, room_type, monthly_rate FROM rooms");
        console.table(res.recordset);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
checkRooms();
