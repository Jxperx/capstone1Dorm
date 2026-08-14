const axios = require('axios');
require('dotenv').config();

async function listModels() {
    const key = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
    
    try {
        console.log('Listing models...');
        const response = await axios.get(url);
        console.log('Models:', response.data.models.map(m => m.name));
    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
    }
}

listModels();
