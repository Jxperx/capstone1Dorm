const { poolPromise, sql } = require('../config/db');
const bcrypt = require('bcrypt');

async function seedAdmin() {
    try {
        const pool = await poolPromise;
        const email = 'jxperx@gmail.com';
        const password = 'admin123';
        const hashedPassword = await bcrypt.hash(password, 10);

        // Check if admin exists
        const result = await pool.request()
            .input('email', sql.NVarChar, email)
            .query('SELECT * FROM users WHERE email = @email');

        if (result.recordset.length > 0) {
            await pool.request()
                .input('email', sql.NVarChar, email)
                .input('password_hash', sql.NVarChar, hashedPassword)
                .query(`UPDATE users SET role = 'admin', password_hash = @password_hash WHERE email = @email`);
            console.log(`Updated user ${email} to Admin role.`);
            console.log(`Email: ${email}`);
            console.log(`Password: ${password}`);
        } else {
            await pool.request()
                .input('full_name', sql.NVarChar, 'System Admin')
                .input('email', sql.NVarChar, email)
                .input('password_hash', sql.NVarChar, hashedPassword)
                .input('role', sql.NVarChar, 'admin')
                .input('phone_number', sql.NVarChar, '0000000000')
                .query(`INSERT INTO users (full_name, email, password_hash, role, phone_number) 
                        VALUES (@full_name, @email, @password_hash, @role, @phone_number)`);
            
            console.log('Admin user created successfully.');
            console.log(`Email: ${email}`);
            console.log(`Password: ${password}`);
        }
        
        process.exit(0);
    } catch (err) {
        console.error('Error seeding admin:', err);
        process.exit(1);
    }
}

seedAdmin();
