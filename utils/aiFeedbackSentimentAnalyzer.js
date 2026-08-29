'use strict';

/**
 * utils/aiFeedbackSentimentAnalyzer.js
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * Gemini-powered AI sentiment analyzer for tenant feedback.
 * Provides accurate, professional sentiment analysis with narrative summaries.
 * Falls back to a rule-based engine if Gemini is unavailable.
 */

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent';

const FALLBACK_RESULT = {
    sentiment: 'Neutral',
    score: 0.00,
    topics: ['General Experience'],
    keywords: [],
    summary: 'This feedback has been received and will be reviewed by the management team.',
    needsAttention: false,
    confidence: 0.50
};

// â”€â”€â”€ Rule-Based Fallback â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const TOPIC_KEYWORDS = {
    'Internet / WiFi': ['wifi', 'internet', 'connection', 'slow', 'disconnect', 'router', 'network'],
    'Noise': ['noise', 'noisy', 'loud', 'music', 'party', 'yelling', 'shouting', 'fight', 'fighting'],
    'Cleanliness': ['clean', 'dirty', 'messy', 'garbage', 'trash', 'dust', 'stain', 'smell', 'odor', 'hygiene'],
    'Safety / Security': ['safe', 'security', 'guard', 'lock', 'stolen', 'thief', 'camera', 'cctv', 'danger', 'fight'],
    'Staff Behavior': ['staff', 'management', 'admin', 'helpful', 'rude', 'friendly', 'manager'],
    'Maintenance': ['broken', 'fix', 'repair', 'maintenance', 'damage', 'leak'],
    'Water Supply': ['water', 'pressure', 'shower', 'sink', 'leak', 'plumbing'],
    'Electricity': ['electricity', 'power', 'blackout', 'outage', 'lights'],
    'Bathroom / Plumbing': ['bathroom', 'toilet', 'flush', 'shower', 'smell', 'clog'],
    'Air Conditioning': ['ac', 'aircon', 'air conditioning', 'hot', 'cold', 'fan', 'ventilation'],
    'Pest Control': ['pest', 'cockroach', 'rat', 'mouse', 'ants', 'bug', 'insect', 'mosquito'],
    'Amenities': ['gym', 'pool', 'laundry', 'kitchen', 'parking', 'amenities'],
    'General Experience': ['experience', 'stay', 'overall', 'recommend', 'place', 'room', 'dorm', 'condo']
};

const NEGATIVE_WORDS = [
    'bad', 'terrible', 'awful', 'horrible', 'worst', 'poor', 'slow', 'loud',
    'noisy', 'dirty', 'broken', 'rude', 'unsafe', 'smell', 'annoying',
    'hate', 'disappointing', 'messy', 'complain', 'issue', 'problem', 'fight',
    'fighting', 'danger', 'dangerous', 'unacceptable', 'never'
];

const POSITIVE_WORDS = [
    'good', 'great', 'excellent', 'amazing', 'perfect', 'awesome', 'nice',
    'love', 'best', 'helpful', 'friendly', 'clean', 'safe', 'quiet', 'fast',
    'reliable', 'comfortable', 'happy', 'satisfied', 'beautiful', 'improved'
];

function _ruleBased(text) {
    const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
    const words = normalized.split(/\s+/);

    let posScore = 0, negScore = 0;
    words.forEach(w => {
        if (POSITIVE_WORDS.includes(w)) posScore++;
        if (NEGATIVE_WORDS.includes(w)) negScore++;
    });

    let sentiment = 'Neutral';
    let score = 0;
    if (posScore > negScore) { sentiment = 'Positive'; score = Math.min(1.0, posScore * 0.3); }
    else if (negScore > posScore) { sentiment = 'Negative'; score = Math.max(-1.0, -(negScore * 0.3)); }
    else if (posScore > 0 && negScore > 0) { sentiment = 'Mixed'; score = 0; }

    const matchedTopics = [];
    const matchedKeywords = [];
    Object.entries(TOPIC_KEYWORDS).forEach(([topic, kws]) => {
        const found = kws.filter(kw => normalized.includes(kw));
        if (found.length > 0) {
            matchedTopics.push(topic);
            matchedKeywords.push(...found);
        }
    });
    if (matchedTopics.length === 0) matchedTopics.push('General Experience');

    const uniqueKeywords = [...new Set(matchedKeywords)].slice(0, 5);
    const needsAttention = sentiment === 'Negative' || NEGATIVE_WORDS.some(w => words.includes(w) && ['danger', 'fight', 'fighting', 'stolen', 'thief', 'unsafe'].includes(w));
    const confidence = Math.min(0.75, 0.3 + ((posScore + negScore) * 0.08) + (matchedTopics.length * 0.05));

    // Build a proper narrative summary
    let summary = '';
    if (sentiment === 'Negative') {
        summary = `The tenant has raised a concern regarding ${matchedTopics.join(' and ')}. This feedback has been flagged for management review.`;
    } else if (sentiment === 'Positive') {
        summary = `The tenant has shared positive feedback regarding ${matchedTopics.join(' and ')}. This reflects a satisfactory experience.`;
    } else if (sentiment === 'Mixed') {
        summary = `The tenant's feedback reflects a mixed experience regarding ${matchedTopics.join(' and ')}. Management may wish to review for areas of improvement.`;
    } else {
        summary = `The tenant has submitted feedback regarding ${matchedTopics.join(' and ')}. This has been logged for administrative review.`;
    }

    return {
        sentiment,
        score: parseFloat(score.toFixed(2)),
        topics: matchedTopics,
        keywords: uniqueKeywords,
        summary,
        needsAttention,
        confidence: parseFloat(confidence.toFixed(2))
    };
}

// â”€â”€â”€ Gemini AI Analysis â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function _geminiAnalyze(text) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

    const prompt = `You are an expert sentiment analysis AI for a student dormitory and condominium property management system called EliteStay.

A tenant has submitted the following feedback:
"${text}"

Analyze this feedback and respond ONLY with a valid JSON object (no markdown, no code fences) in this exact format:
{
  "sentiment": "<Positive|Negative|Neutral|Mixed>",
  "score": <float between -1.0 and 1.0>,
  "topics": ["<topic1>", "<topic2>"],
  "keywords": ["<keyword1>", "<keyword2>", "<keyword3>"],
  "summary": "<A professional 2-3 sentence narrative summary for property management. Describe what the tenant is experiencing, the category of concern or praise, and recommend action if needed.>",
  "needsAttention": <true|false>,
  "confidence": <float between 0.0 and 1.0>
}

Rules:
- sentiment must be one of: Positive, Negative, Neutral, Mixed
- score: -1.0 = very negative, 0 = neutral, 1.0 = very positive
- topics: identify 1-3 relevant topics from: [Internet/WiFi, Noise, Cleanliness, Safety/Security, Staff Behavior, Maintenance, Water Supply, Electricity, Bathroom/Plumbing, Air Conditioning, Pest Control, Amenities, General Experience]
- keywords: extract 2-5 key words or phrases directly from the feedback
- summary: write in a formal, professional tone suitable for a property manager. Do NOT just restate the feedback word for word. Provide insight.
- needsAttention: true if the feedback indicates a safety issue, repeated complaint, urgent matter, or strong negative sentiment
- confidence: your confidence in the analysis (0.0-1.0)`;

    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 512,
            }
        })
    });

    if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) throw new Error('Empty Gemini response');

    // Strip markdown fences if present
    const cleaned = raw.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();
    const parsed = JSON.parse(cleaned);

    // Validate and sanitize
    return {
        sentiment: ['Positive', 'Negative', 'Neutral', 'Mixed'].includes(parsed.sentiment) ? parsed.sentiment : 'Neutral',
        score: typeof parsed.score === 'number' ? Math.max(-1.0, Math.min(1.0, parseFloat(parsed.score.toFixed(2)))) : 0,
        topics: Array.isArray(parsed.topics) && parsed.topics.length > 0 ? parsed.topics : ['General Experience'],
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 5) : [],
        summary: typeof parsed.summary === 'string' && parsed.summary.length > 10 ? parsed.summary : FALLBACK_RESULT.summary,
        needsAttention: Boolean(parsed.needsAttention),
        confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1.0, parseFloat(parsed.confidence.toFixed(2)))) : 0.75
    };
}

// â”€â”€â”€ Main Export â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function analyzeFeedback(text) {
    if (!text || typeof text !== 'string' || text.trim().length < 3) {
        return { ...FALLBACK_RESULT };
    }

    // Try Gemini first (high quality), fall back to rule-based engine
    try {
        const result = await _geminiAnalyze(text);
        console.log(`[AI Feedback] Gemini analysis complete â€” ${result.sentiment} (${Math.round(result.confidence * 100)}% confidence)`);
        return result;
    } catch (err) {
        console.warn('[AI Feedback] Gemini unavailable, using rule-based fallback:', err.message);
        try {
            return _ruleBased(text);
        } catch (fallbackErr) {
            console.error('[AI Feedback] Rule-based fallback failed:', fallbackErr.message);
            return { ...FALLBACK_RESULT };
        }
    }
}

module.exports = { analyzeFeedback };