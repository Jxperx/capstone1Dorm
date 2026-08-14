'use strict';
/**
 * routes/chat.js
 * ─────────────────────────────────────────────────────────────────────────────
 * AI Chatbot endpoint — powered by Groq (primary, free).
 *
 * Fallback chain:
 *   1. Groq  llama-3.3-70b-versatile  (free, fast, 14,400 req/day)
 *   2. Groq  llama-3.1-8b-instant     (free, fastest, higher quota)
 *   3. Gemini gemini-2.0-flash        (backup if Groq unavailable)
 *   4. Rule-based keyword fallback    (offline, no AI needed)
 */

const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const { getRuleBasedReply } = require('../utils/ruleBasedChat');

// ─── Config ────────────────────────────────────────────────────────────────────
const TIMEOUT_MS    = 20000;
const GROQ_BASE     = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODELS   = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
const GEMINI_BASE   = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODEL  = 'gemini-2.0-flash';

// ─── System Prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a smart, friendly AI assistant named "Dorm AI" built into the EliteStay student boarding house management system in the Philippines.

You have TWO roles:
1. **General AI Assistant** — You can answer ANY question a student might have: homework help, science, math, news, technology, general knowledge, language questions, advice, etc. Be helpful, accurate, and conversational.
2. **Boarding House Expert** — You have detailed knowledge about this boarding house:

   HOUSE RULES:
   - Quiet hours: 10:00 PM – 6:00 AM (no loud music, parties, or noise)
   - No smoking anywhere inside the building
   - Visitors allowed until 9:00 PM only; overnight guests are not allowed
   - Keep common areas (kitchen, bathroom, hallway) clean at all times
   - No cooking of strong-smelling food in rooms
   - Lights out in common areas at 11:00 PM

   PAYMENTS & RENT:
   - Rent is due on the 28th of every month
   - Pay through the Payments section in the tenant dashboard
   - We accept GCash and QRPH (via PayMongo)
   - Late payments may incur a penalty — contact admin for details

   UTILITY BILLS:
   - Electricity and water are billed monthly based on your room's sub-meter reading
   - View your current bill in the Payments tab of your dashboard

   MAINTENANCE:
   - Report broken items using the "Report Issue" button in your dashboard
   - Maintenance team responds within 24–48 hours on weekdays
   - For urgent issues (flooding, no electricity), contact admin directly

   WIFI / INTERNET:
   - WiFi password is updated monthly
   - Check the notice board or message admin for the current password
   - If slow, try restarting the router in the common area

   CONTACT / ADMIN:
   - Admin office on the ground floor, open 9 AM – 5 PM weekdays
   - For urgent matters, use the Live Chat feature in this app

   EMERGENCY:
   - Call 911 for fire, medical, or police emergencies immediately
   - Alert the security guard at the gate for building security issues

GUIDELINES:
- Be warm, friendly, and use simple English appropriate for students
- Answer ANY general question fully — NEVER redirect general questions to admin
- For boarding house questions you can answer from the info above — answer them directly
- Only suggest contacting admin for things ONLY admin can do: viewing specific account data, approving requests, resolving disputes, account-specific changes
- Format responses using markdown: **bold** for important info, bullet points for lists, numbered lists for steps
- Keep responses concise but complete`;

// ─── Build messages array (OpenAI-compatible format, used by Groq) ─────────────
function buildMessages(history, message) {
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
    if (history && Array.isArray(history)) {
        history.forEach(msg => messages.push({
            role:    msg.role === 'bot' ? 'assistant' : 'user',
            content: msg.text
        }));
    }
    messages.push({ role: 'user', content: message });
    return messages;
}

// ─── Build Gemini request body (backup) ───────────────────────────────────────
function buildGeminiBody(history, message) {
    const contents = [];
    if (history && Array.isArray(history)) {
        history.forEach(msg => contents.push({
            role:  msg.role === 'bot' ? 'model' : 'user',
            parts: [{ text: msg.text }]
        }));
    }
    contents.push({ role: 'user', parts: [{ text: message }] });
    return {
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents,
        generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
    };
}

// ─── Route: POST /chat ─────────────────────────────────────────────────────────
router.post('/chat', async (req, res) => {
    const { message, history } = req.body;

    if (!message || !message.trim()) {
        return res.status(400).json({ error: 'Message is required' });
    }

    const GROQ_API_KEY   = process.env.GROQ_API_KEY;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const messages       = buildMessages(history, message);

    // ── 1. Try Groq models (primary — free, fast) ─────────────────────────────
    if (GROQ_API_KEY) {
        for (const model of GROQ_MODELS) {
            try {
                const response = await axios.post(
                    GROQ_BASE,
                    { model, messages, temperature: 0.7, max_tokens: 1024 },
                    {
                        headers: {
                            'Authorization': `Bearer ${GROQ_API_KEY}`,
                            'Content-Type':  'application/json'
                        },
                        timeout: TIMEOUT_MS
                    }
                );

                const reply = response.data?.choices?.[0]?.message?.content;
                if (!reply) throw new Error(`Empty response from Groq ${model}`);

                console.log(`[Chatbot] ✓ Groq ${model} replied`);
                return res.json({ reply, model, provider: 'groq' });

            } catch (err) {
                const status = err.response?.status;
                if (status === 429) {
                    console.warn(`[Chatbot] Groq ${model} rate limited — trying next`);
                    continue;
                }
                if (status === 401) {
                    console.error('[Chatbot] Groq invalid API key — skipping Groq');
                    break;
                }
                console.warn(`[Chatbot] Groq ${model} failed (${status}): ${err.message}`);
            }
        }
    } else {
        console.warn('[Chatbot] GROQ_API_KEY not set — skipping Groq');
    }

    // ── 2. Fallback: Gemini ────────────────────────────────────────────────────
    if (GEMINI_API_KEY) {
        try {
            const url = `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
            const response = await axios.post(url, buildGeminiBody(history, message), {
                headers: { 'Content-Type': 'application/json' },
                timeout: TIMEOUT_MS
            });
            const reply = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!reply) throw new Error('Empty Gemini response');
            console.log('[Chatbot] ✓ Gemini (backup) replied');
            return res.json({ reply, model: GEMINI_MODEL, provider: 'gemini' });
        } catch (err) {
            console.warn(`[Chatbot] Gemini backup failed: ${err.response?.status} ${err.message}`);
        }
    }

    // ── 3. Last resort: rule-based offline fallback ───────────────────────────
    console.warn('[Chatbot] All AI providers failed — using rule-based fallback');
    return res.json({ reply: getRuleBasedReply(message), fallback: true });
});

module.exports = router;
