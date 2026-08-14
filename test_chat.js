const axios = require('axios');
async function testChat() {
    try {
        console.log('Testing chat fallback with "rules"...');
        const res = await axios.post('http://localhost:3000/api/chat/chat', {
            message: 'What are the house rules?'
        });
        console.log('Response:', res.data.reply);
        
        console.log('\nTesting chat fallback with unknown query...');
        const res2 = await axios.post('http://localhost:3000/api/chat/chat', {
            message: 'How is the weather today?'
        });
        console.log('Response:', res2.data.reply);
    } catch (e) {
        console.error('Test Failed:', e.message);
        if (e.response) console.log('Response Data:', e.response.data);
    }
}
testChat();
