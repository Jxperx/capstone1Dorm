const { poolPromise, sql } = require('./config/db');
const bcrypt = require('bcrypt');
const axios = require('axios');

async function test() {
    try {
        const pool = await poolPromise;
        const hashedPassword = await bcrypt.hash('password123', 10);
        await pool.request().query(`UPDATE users SET password_hash = '${hashedPassword}' WHERE email = 'jas@gmail.com'`);
        
        console.log("Password updated. Testing login...");
        const res = await axios.post('http://localhost:3000/api/login', {
            email: 'jas@gmail.com',
            password: 'password123'
        });
        console.log("Login HTTP Response:", res.data);
    } catch (e) {
        console.log("Login Error:", e.response ? e.response.data : e.message);
    }
    process.exit();
}
test();
