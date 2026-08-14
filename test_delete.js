const { poolPromise, sql } = require('./config/db');

async function test() {
    try {
        const pool = await poolPromise;
        const userResult = await pool.request().query("INSERT INTO users (full_name, email, password_hash) OUTPUT INSERTED.id VALUES ('Test', 'test1@test.com', 'hash')");
        const userId = userResult.recordset[0].id;
        const tenantResult = await pool.request().input('userId', sql.Int, userId).query("INSERT INTO tenants (user_id, lease_start_date) OUTPUT INSERTED.id VALUES (@userId, GETDATE())");
        const tenantId = tenantResult.recordset[0].id;
        
        await pool.request().input('tenantId', sql.Int, tenantId).query("INSERT INTO tenant_feedback (tenant_id, feedback_text) VALUES (@tenantId, 'good')");
        
        try {
            await pool.request().input('userId', sql.Int, userId).query("DELETE FROM users WHERE id = @userId");
            console.log('Delete successful');
        } catch (e) {
            console.error('Delete failed:', e.message);
        }
        
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
test();
