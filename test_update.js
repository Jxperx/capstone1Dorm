const { poolPromise, sql } = require('./config/db');

async function test() {
    try {
        const pool = await poolPromise;
        const userResult = await pool.request().query("INSERT INTO users (full_name, email, password_hash) OUTPUT INSERTED.id VALUES ('Test2', 'test2@test.com', 'hash')");
        const userId = userResult.recordset[0].id;
        const roomResult = await pool.request().query("INSERT INTO rooms (room_number, capacity, monthly_rate) OUTPUT INSERTED.id VALUES ('TEST01', 1, 1000)");
        const roomId = roomResult.recordset[0].id;
        
        const tenantResult = await pool.request()
            .input('userId', sql.Int, userId)
            .input('roomId', sql.Int, roomId)
            .query("INSERT INTO tenants (user_id, room_id, lease_start_date) OUTPUT INSERTED.id VALUES (@userId, @roomId, GETDATE())");
        const tenantId = tenantResult.recordset[0].id;
        
        try {
            await pool.request()
            .input('id', sql.Int, tenantId)
            .query(`
                UPDATE tenants 
                SET status = 'past', 
                    room_id = NULL 
                WHERE id = @id
            `);
            console.log('Update successful');
        } catch (e) {
            console.error('Update failed:', e.message);
        }
        
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
test();
