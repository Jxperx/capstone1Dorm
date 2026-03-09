const axios = require('axios');

async function testChat() {
    try {
        console.log('Testing Chat API...');
        const response = await axios.post('http://localhost:3000/api/chat/chat', {
            message: "Hello, what are the quiet hours?",
            history: []
        });
        
        console.log('Success!');
        console.log('Reply:', response.data.reply);
    } catch (error) {
        console.error('Failed!');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', error.response.data);
        } else {
            console.error('Error:', error.message);
        }
    }
}

testChat();
