const { poolPromise, sql } = require('./config/db');

async function test() {
    try {
        const pool = await poolPromise;
        const res = await pool.request().query("INSERT INTO rooms (room_number, capacity, monthly_rate, room_type, status) VALUES ('DormB1', 6, 4500, 'dorm', 'available')");
        console.log('Inserted dorm successfully!');
    } catch(e) {
        console.error('SQL ERROR:', e.message);
    } finally {
        process.exit();
    }
}
test();
