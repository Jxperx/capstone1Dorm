const axios = require('axios');
const http = require('http');

async function testOtpFlow() {
    try {
        // We need an axios instance with cookies to track session
        const api = axios.create({
            baseURL: 'http://localhost:3000/api',
            withCredentials: true,
            // this is basically how you handle cookies in axios across requests in Node
            // But actually we can just use the 'cookie' header from the first response
        });

        console.log("1. Sending login request...");
        const loginRes = await api.post('/login', {
            email: 'jas@gmail.com',
            password: 'password123'
        });
        
        const cookie = loginRes.headers['set-cookie'][0];
        console.log("Login Response:", loginRes.data);
        console.log("Cookie received:", cookie);

        // Wait, how do I get the OTP? It was sent to email.
        // It's also in the session memory of the server! I can't read it from the local script unless I inject something.
    } catch(err) {
        console.log("Error:", err.response ? err.response.data : err.message);
    }
}
testOtpFlow();
