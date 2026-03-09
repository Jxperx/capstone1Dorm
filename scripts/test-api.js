const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const path = require('path');

const BASE_URL = 'http://localhost:3000';
let cookie = '';

async function runTests() {
    try {
        console.log('--- Starting API Tests ---');

        // 1. Register User
        const email = `testuser_${Date.now()}@example.com`;
        const password = 'password123';
        console.log(`\n1. Registering user: ${email}`);
        
        try {
            await axios.post(`${BASE_URL}/api/register`, {
                fullName: 'Test User',
                email: email,
                password: password,
                phone: '1234567890'
            });
            console.log('✅ Registration Successful');
        } catch (err) {
            console.error('❌ Registration Failed:', err.response ? err.response.data : err.message);
            return;
        }

        // 2. Login User
        console.log(`\n2. Logging in...`);
        try {
            const loginRes = await axios.post(`${BASE_URL}/api/login`, {
                email: email,
                password: password
            });
            
            // Extract session cookie
            const cookies = loginRes.headers['set-cookie'];
            if (cookies) {
                cookie = cookies.find(c => c.startsWith('connect.sid'));
                console.log('✅ Login Successful');
            } else {
                console.error('❌ Login Failed: No cookie received');
                return;
            }
        } catch (err) {
            console.error('❌ Login Failed:', err.response ? err.response.data : err.message);
            return;
        }

        // Setup Axios instance with cookie
        const client = axios.create({
            baseURL: BASE_URL,
            headers: {
                'Cookie': cookie
            }
        });

        // 3. Report Maintenance Issue
        console.log(`\n3. Reporting Maintenance Issue...`);
        try {
            await client.post('/api/maintenance/report', {
                title: 'Plumbing',
                description: 'Leaky faucet in bathroom'
            });
            console.log('✅ Maintenance Report Successful');
        } catch (err) {
            console.error('❌ Maintenance Report Failed:', err.response ? err.response.data : err.message);
        }

        // 4. Upload Payment Proof
        console.log(`\n4. Uploading Payment Proof...`);
        try {
            // Create a dummy file
            const filePath = path.join(__dirname, 'test-proof.txt');
            fs.writeFileSync(filePath, 'dummy image content');

            const form = new FormData();
            form.append('amount', 350);
            form.append('paymentDate', new Date().toISOString());
            form.append('referenceNumber', `REF-${Date.now()}`);
            form.append('proof', fs.createReadStream(filePath));

            await client.post('/api/payments/upload', form, {
                headers: {
                    ...form.getHeaders()
                }
            });
            
            console.log('✅ Payment Upload Successful');
            
            // Cleanup
            fs.unlinkSync(filePath);
        } catch (err) {
            console.error('❌ Payment Upload Failed:', err.response ? err.response.data : err.message);
        }

        // 5. Get Payment History
        console.log(`\n5. Getting Payment History...`);
        try {
            const historyRes = await client.get('/api/payments/history');
            console.log(`✅ History Retrieved: ${historyRes.data.length} records found`);
            if (historyRes.data.length > 0) {
                console.log('   Last record:', historyRes.data[0]);
            }
        } catch (err) {
            console.error('❌ Get History Failed:', err.response ? err.response.data : err.message);
        }

        console.log('\n--- Tests Completed ---');

    } catch (err) {
        console.error('Unexpected Error:', err);
    }
}

runTests();
