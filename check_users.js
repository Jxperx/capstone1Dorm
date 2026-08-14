const { poolPromise, sql } = require('./config/db');
const bcrypt = require('bcrypt');

async function check() {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(
            "SELECT id, email, role, password_hash FROM users ORDER BY id"
        );

        const lines = [];
        lines.push('=== Users in DB ===');
        for (const u of result.recordset) {
            lines.push(`ID:${u.id} Email:${u.email} Role:${u.role}`);
            lines.push(`  Hash:${u.password_hash ? u.password_hash.substring(0,30) : 'NULL'}`);
        }

        // Also test bcrypt compare directly
        lines.push('');
        lines.push('=== bcrypt test ===');
        const testHash = result.recordset.find(u => u.role === 'tenant')?.password_hash;
        const testEmail = result.recordset.find(u => u.role === 'tenant')?.email;
        if (testHash) {
            lines.push(`Testing tenant: ${testEmail}`);
            const testPwds = ['password123', 'Password123', '123456', 'tenant123'];
            for (const p of testPwds) {
                const m = await bcrypt.compare(p, testHash);
                lines.push(`  "${p}" → ${m ? 'MATCH' : 'no match'}`);
            }
        }

        console.log(lines.join('\n'));
    } catch (err) {
        console.log('Error:', err.message);
    }
    process.exit(0);
}

check();
