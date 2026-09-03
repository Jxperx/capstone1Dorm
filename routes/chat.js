'use strict';
/**
 * routes/chat.js
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * AI Chatbot endpoint â€” powered by Groq (primary, free).
 *
 * Fallback chain:
 *   1. Groq  llama-3.3-70b-versatile  (free, fast, 14,400 req/day)
 *   2. Groq  llama-3.1-8b-instant     (free, fastest, higher quota)
 *   3. Gemini gemini-3.6-flash        (backup if Groq unavailable)
 *   4. Rule-based keyword fallback    (offline, no AI needed)
 */

const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const { getRuleBasedReply } = require('../utils/ruleBasedChat');

// ─── Config ──────────────────────────────────────────────────────────────────
const TIMEOUT_MS     = 20000;
const GROQ_BASE      = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODELS    = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'allam-2-7b', 'qwen/qwen3.6-27b'];
const GEMINI_BASE    = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODELS  = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-3.6-flash'];

// ——————————————————————————————————————————————————————————————————————————————————————————————————
const SYSTEM_PROMPT = `You are a smart, friendly AI assistant named "Dorm AI" built into the EliteStay student boarding house management system in the Philippines.

You have TWO roles:
1. **General AI Assistant** — You can answer ANY question a student might have: homework help, science, math, news, technology, general knowledge, language questions, advice, etc. Be helpful, accurate, and conversational.
2. **Boarding House Expert** — You have detailed knowledge about this boarding house:

   HOUSE RULES:
   - Quiet hours: 10:00 PM â€“ 6:00 AM (no loud music, parties, or noise)
   - No smoking anywhere inside the building
   - Visitors allowed until 9:00 PM only; overnight guests are not allowed
   - Keep common areas (kitchen, bathroom, hallway) clean at all times
   - No cooking of strong-smelling food in rooms
   - Lights out in common areas at 11:00 PM

   PAYMENTS & RENT:
   - Rent is due on the 28th of every month
   - Pay through the Payments section in the tenant dashboard
   - We accept GCash and QRPH (via PayMongo)
   - Late payments may incur a penalty â€” contact admin for details

   UTILITY BILLS:
   - Electricity and water are billed monthly based on your room's sub-meter reading
   - View your current bill in the Payments tab of your dashboard

   MAINTENANCE:
   - Report broken items using the "Report Issue" button in your dashboard
   - Maintenance team responds within 24â€“48 hours on weekdays
   - For urgent issues (flooding, no electricity), contact admin directly

   WIFI / INTERNET:
   - WiFi password is updated monthly
   - Check the notice board or message admin for the current password
   - If slow, try restarting the router in the common area

   CONTACT / ADMIN:
   - Admin office on the ground floor, open 9 AM â€“ 5 PM weekdays
   - For urgent matters, use the Live Chat feature in this app

   EMERGENCY:
   - Call 911 for fire, medical, or police emergencies immediately
   - Alert the security guard at the gate for building security issues

GUIDELINES:
- Be warm, friendly, and use simple English appropriate for students
- Answer ANY general question fully â€” NEVER redirect general questions to admin
- For boarding house questions you can answer from the info above â€” answer them directly
- Only suggest contacting admin for things ONLY admin can do: viewing specific account data, approving requests, resolving disputes, account-specific changes
- Format responses using markdown: **bold** for important info, bullet points for lists, numbered lists for steps
- Keep responses concise but complete`;

// â”€â”€â”€ Build messages array (OpenAI-compatible format, used by Groq) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Build Gemini request body (backup) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// ─── Rate Limiter ────────────────────────────────────────────────────────────
const rateLimit = require('express-rate-limit');
const chatLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 20,                  // 20 messages per window
    message: { error: 'Too many chat messages. Please wait a few minutes.' },
    standardHeaders: true, legacyHeaders: false
});

// ─── Route: POST /chat ─────────────────────────────────────────────────────
router.post('/chat', chatLimiter, async (req, res) => {
    const { message, history } = req.body;

    if (!message || !message.trim()) {
        return res.status(400).json({ error: 'Message is required' });
    }

    const GROQ_API_KEY   = process.env.GROQ_API_KEY;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const messages       = buildMessages(history, message);

    // â”€â”€ 1. Try Groq models (primary â€” free, fast) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

                let reply = response.data?.choices?.[0]?.message?.content;
                if (!reply) throw new Error(`Empty response from Groq ${model}`);
                reply = reply.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

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

    // ── 2. Fallback: Gemini (Multi-model chain) ──────────────────────────────────
    if (GEMINI_API_KEY) {
        for (const model of GEMINI_MODELS) {
            try {
                const url = `${GEMINI_BASE}/${model}:generateContent?key=${GEMINI_API_KEY}`;
                const response = await axios.post(url, buildGeminiBody(history, message), {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: TIMEOUT_MS
                });
                let reply = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (!reply) throw new Error(`Empty Gemini response from ${model}`);
                reply = reply.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
                console.log(`[Chatbot] ✓ Gemini (${model}) replied`);
                return res.json({ reply, model, provider: 'gemini' });
            } catch (err) {
                const status = err.response?.status;
                if (status === 429) {
                    console.warn(`[Chatbot] Gemini ${model} rate limited (429) — trying next model`);
                    continue;
                }
                console.warn(`[Chatbot] Gemini ${model} failed (${status}): ${err.message}`);
            }
        }
    } else {
        console.warn('[Chatbot] GEMINI_API_KEY not set — skipping Gemini');
    }

    // â”€â”€ 3. Last resort: rule-based offline fallback â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    console.warn('[Chatbot] All AI providers failed â€” using rule-based fallback');
    return res.json({ reply: getRuleBasedReply(message), fallback: true });
});

module.exports = router;
