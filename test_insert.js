const { poolPromise, sql } = require('./config/db');
async function insert() {
    try {
        const pool = await poolPromise;
        const res = await pool.request().query("INSERT INTO rooms (room_number, capacity, monthly_rate, room_type) VALUES ('DormA1', 4, 6000, 'dorm')");
        console.log("Inserted!");
    } catch(e) {
        console.log('Error:', e);
    } finally {
        process.exit();
    }
}
insert();
