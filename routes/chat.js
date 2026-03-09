const express = require('express');
const router = express.Router();
const axios = require('axios');

router.post('/chat', async (req, res) => {
    const { message, history } = req.body;

    // Reload env var to be safe (though module level should work if dotenv is early enough)
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    // Use gemini-flash-latest as it is in the available models list
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_API_KEY}`;

    if (!GEMINI_API_KEY) {
        console.error('Error: GEMINI_API_KEY is missing in environment variables.');
        return res.status(500).json({ error: 'Server configuration error: API Key missing' });
    }

    if (!message) {
        return res.status(400).json({ error: 'Message is required' });
    }

    try {
        const systemInstruction = `You are a helpful assistant for a student boarding house. 
        You help tenants with questions about:
        - Utility bills (water/electric calculations)
        - Room maintenance requests
        - Payment submissions
        - General boarding house rules (quiet hours: 10PM-6AM, no smoking, visitors until 9PM)
        
        Keep your answers concise and friendly. If you don't know something, advise them to contact the admin directly.`;

        const contents = [];
        
        // Add history
        if (history && Array.isArray(history)) {
            history.forEach(msg => {
                contents.push({
                    role: msg.role === 'bot' ? 'model' : 'user',
                    parts: [{ text: msg.text }]
                });
            });
        }

        // Add current message with context
        // Note: For Gemini 1.5, we can use 'system_instruction' field, but sticking to prompt context is safer for compatibility
        contents.push({
            role: "user",
            parts: [{ text: `${systemInstruction}\n\nUser Question: ${message}` }]
        });

        const response = await axios.post(GEMINI_API_URL, {
            contents: contents
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (response.data && response.data.candidates && response.data.candidates.length > 0) {
            const botReply = response.data.candidates[0].content.parts[0].text;
            res.json({ reply: botReply });
        } else {
            console.error('Gemini API Response Unexpected:', JSON.stringify(response.data));
            res.status(500).json({ error: 'No response from AI' });
        }

    } catch (error) {
        console.error('Gemini API Error Details:', error.response ? JSON.stringify(error.response.data) : error.message);
        res.status(500).json({ error: 'Failed to get response from AI assistant.' });
    }
});

module.exports = router;
