const { poolPromise, sql } = require('./config/db');

async function checkUser() {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .query("SELECT id, full_name, email, role FROM users WHERE role = 'admin'");
        
        console.log('Users found:', result.recordset);
    } catch (err) {
        console.error('Error:', err);
    } finally {
        // Close connection if needed, or just exit
        process.exit();
    }
}

checkUser();
