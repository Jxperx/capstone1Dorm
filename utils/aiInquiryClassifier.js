'use strict';
/**
 * utils/aiInquiryClassifier.js
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * Classifies an inquiry message as REAL or SPAM using the Gemini REST API.
 * Uses the same direct REST API pattern as the existing chat.js in this project.
 * Falls back gracefully to heuristic rules if the API is unavailable.
 *
 * Returns: { result: 'REAL'|'SPAM', confidence: 0-100, reasoning: string }
 */

// â”€â”€â”€ Heuristic fallback (no API needed) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const SPAM_PATTERNS = [
    /\b(buy now|click here|free money|guaranteed|winner|prize|lottery|casino|viagra|crypto|bitcoin|earn \$|make money fast)\b/i,
    /https?:\/\/[^\s]+/i,       // URLs in message body
    /(.)\1{5,}/,                 // 6+ repeated characters: aaaaaaa
    /^[\s\W]*$/,                 // Only whitespace / punctuation
];

function heuristicClassify(message) {
    if (!message || message.trim().length < 5) {
        return { result: 'SPAM', confidence: 95, reasoning: 'Message is too short or empty.' };
    }
    for (const pat of SPAM_PATTERNS) {
        if (pat.test(message)) {
            return { result: 'SPAM', confidence: 88, reasoning: 'Matched known spam pattern.' };
        }
    }
    // Gibberish check: ratio of spaces to length
    const words = message.trim().split(/\s+/);
    if (words.length <= 1 && message.length > 20) {
        return { result: 'SPAM', confidence: 80, reasoning: 'Message appears to be gibberish (no spaces in a long text).' };
    }
    return { result: 'REAL', confidence: 70, reasoning: 'Passed heuristic checks.' };
}

// â”€â”€â”€ Main classifier â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function classifyInquiry(message, senderName = '') {
    if (!message || message.trim().length < 3) {
        return { result: 'SPAM', confidence: 99, reasoning: 'Empty or near-empty message.' };
    }

    const apiKey = process.env.GEMINI_API_KEY;

    // Use Gemini REST API if key is available (same pattern as chat.js)
    if (apiKey) {
        try {
            const prompt = `You are a spam detection system for a premium boarding house / property rental website.

Classify this inquiry as REAL or SPAM.

Check for:
- Gibberish or nonsense text
- Repeated words or characters (e.g. "aaaaaa" or "test test test test")
- Promotional content, suspicious URLs, or affiliate links
- Irrelevant or clearly bot-generated content
- Extremely short or meaningless messages

Context: This is an inquiry form where potential tenants ask about room availability, pricing, and viewing schedules.

Respond ONLY in this exact JSON format (no markdown, no extra text):
{"result":"REAL","confidence":85,"reasoning":"Brief one-sentence explanation"}

OR

{"result":"SPAM","confidence":92,"reasoning":"Brief one-sentence explanation"}

Sender name: ${senderName}
Message:
"""
${message}
"""`;

            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.1, maxOutputTokens: 150 }
                })
            });

            if (!response.ok) throw new Error(`Gemini API returned ${response.status}`);

            const data = await response.json();
            const raw  = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

            // Strip accidental markdown code fences
            const cleaned = raw.replace(/```json|```/g, '').trim();
            const parsed  = JSON.parse(cleaned);

            if (!parsed.result || !['REAL', 'SPAM'].includes(parsed.result.toUpperCase())) {
                throw new Error('Invalid result field from AI');
            }

            return {
                result:     parsed.result.toUpperCase(),
                confidence: Math.min(100, Math.max(0, parseInt(parsed.confidence) || 70)),
                reasoning:  (parsed.reasoning || '').slice(0, 400)
            };
        } catch (err) {
            console.error('[InquiryClassifier] Gemini API error â€” falling back to heuristic:', err.message);
        }
    }

    return heuristicClassify(message);
}

module.exports = { classifyInquiry };
