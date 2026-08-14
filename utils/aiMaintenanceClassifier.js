/**
 * utils/aiMaintenanceClassifier.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Rule-based AI maintenance triage classifier.
 * Requires NO external API key and works fully offline.
 *
 * How it works:
 *  1. Stage 1 — Emergency keyword scan (instant, pre-AI gate)
 *  2. Stage 2 — Scored keyword matching + priority/category matrix
 *  3. Stage 3 — Safe fallback if nothing matches well enough
 *
 * To swap in an LLM (OpenAI / Gemini / etc.) later, replace the
 * `_ruleBased()` call inside `classifyMaintenance()` with your API call
 * and keep the same return shape.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

// ─── Stage 1: Emergency keywords ─────────────────────────────────────────────
const EMERGENCY_KEYWORDS = [
    'fire', 'smoke', 'sparks', 'spark', 'burning smell', 'gas leak',
    'exposed wire', 'exposed live wire', 'live wire', 'flooding', 'flooded',
    'water burst', 'ceiling collapse', 'collapsed ceiling', 'sewage overflow',
    'broken door lock', 'door lock broken', 'danger', 'explosion', 'explode',
    'electrical fire', 'short circuit', 'no power', 'blackout',
];

// ─── Stage 2: Category + keyword matrix ──────────────────────────────────────
/**
 * Each entry:
 *  category   — display name of the maintenance category
 *  department — assigned team
 *  keywords   — words that raise this category's score (word anywhere in text)
 *  priority   — default priority when this category wins
 * Priority overrides are applied AFTER category wins using the priority matrix.
 */
const CATEGORY_MATRIX = [
    {
        category: 'Plumbing',
        department: 'Plumbing Team',
        priority: 'High',
        keywords: [
            'leak', 'leaking', 'pipe', 'pipes', 'water', 'sink', 'drain',
            'clogged', 'toilet', 'flush', 'faucet', 'tap', 'drip', 'dripping',
            'sewage', 'sewerage', 'sewer', 'overflow', 'flood', 'wet',
            'no water', 'water supply', 'pressure', 'broken pipe',
        ],
    },
    {
        category: 'Electrical',
        department: 'Electrical Team',
        priority: 'High',
        keywords: [
            'electric', 'electrical', 'wire', 'wiring', 'outlet', 'socket',
            'power', 'switch', 'breaker', 'circuit', 'bulb', 'light', 'lights',
            'lamp', 'flickering', 'flicker', 'spark', 'sparks', 'shock',
            'no electricity', 'tripped', 'fuse', 'voltage', 'current',
        ],
    },
    {
        category: 'HVAC / Air Conditioning',
        department: 'HVAC Team',
        priority: 'Medium',
        keywords: [
            'aircon', 'air con', 'air conditioning', 'ac', 'a/c', 'hvac',
            'cooling', 'heat', 'warm', 'cold', 'fan', 'ventilation', 'vent',
            'noisy ac', 'loud ac', 'dripping ac', 'remote', 'temperature',
        ],
    },
    {
        category: 'Structural',
        department: 'Structural Team',
        priority: 'High',
        keywords: [
            'ceiling', 'wall', 'floor', 'crack', 'cracked', 'broken', 'hole',
            'damage', 'damaged', 'roof', 'door', 'window', 'glass', 'tile',
            'tiles', 'collapse', 'fallen', 'weak', 'structural', 'concrete',
        ],
    },
    {
        category: 'Sanitation / Pest Control',
        department: 'Sanitation Team',
        priority: 'Medium',
        keywords: [
            'pest', 'pests', 'cockroach', 'cockroaches', 'rat', 'rats',
            'mouse', 'mice', 'ants', 'mosquito', 'bug', 'bugs', 'insects',
            'mold', 'mould', 'fungi', 'odor', 'smell', 'garbage', 'trash',
            'dirty', 'hygiene', 'sanitation', 'exterminator',
        ],
    },
    {
        category: 'Security / Safety',
        department: 'Security Team',
        priority: 'High',
        keywords: [
            'lock', 'locked', 'key', 'door lock', 'security', 'cctv', 'camera',
            'break in', 'break-in', 'stolen', 'theft', 'unsafe', 'hazard',
            'emergency exit', 'fire exit', 'alarm', 'smoke detector',
        ],
    },
    {
        category: 'Appliance / Furniture',
        department: 'Maintenance Team',
        priority: 'Routine',
        keywords: [
            'refrigerator', 'fridge', 'stove', 'oven', 'microwave', 'washer',
            'dryer', 'washing machine', 'furniture', 'chair', 'table', 'bed',
            'cabinet', 'drawer', 'hinge', 'shelf', 'curtain', 'curtain rod',
            'broken appliance', 'appliance', 'tv', 'television',
        ],
    },
    {
        category: 'Internet / WiFi',
        department: 'IT / Network Team',
        priority: 'Medium',
        keywords: [
            'wifi', 'wi-fi', 'internet', 'network', 'router', 'signal',
            'slow internet', 'no internet', 'connection', 'disconnected',
            'broadband', 'cable', 'modem', 'ethernet',
        ],
    },
];

// ─── Priority rules (keyword → priority override) ────────────────────────────
const PRIORITY_OVERRIDES = [
    // Emergency
    { priority: 'Emergency', keywords: EMERGENCY_KEYWORDS },
    // High
    {
        priority: 'High',
        keywords: [
            'no water', 'no electricity', 'severe leak', 'flooding', 'flooded',
            'overflowing', 'toilet not flushing', 'sewage', 'mold', 'mould',
            'broken lock', 'broken door', 'ceiling leak',
        ],
    },
    // Routine
    {
        priority: 'Routine',
        keywords: [
            'paint', 'painting', 'scratch', 'scratched', 'cosmetic', 'stain',
            'curtain rod', 'curtain', 'bulb replacement', 'replace bulb',
            'minor crack', 'loose drawer', 'loose handle',
        ],
    },
];

// ─── Urgency map from priority ────────────────────────────────────────────────
const URGENCY_MAP = {
    Emergency: 'Immediate',
    High:      'Within 24 hours',
    Medium:    'Within 2-3 days',
    Routine:   'Can be scheduled this week',
};

// ─── Fallback result ──────────────────────────────────────────────────────────
const FALLBACK = {
    category:    'General Maintenance',
    priority:    'Medium',
    urgency:     'Within 2-3 days',
    department:  'General Maintenance Team',
    summary:     'Maintenance issue submitted by tenant. Awaiting manual review.',
    keywords:    [],
    isEmergency: false,
    confidence:  0,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalise(text) {
    return text.toLowerCase().replace(/[^a-z0-9\s\/]/g, ' ').trim();
}

/** Counts how many keywords from the list appear in the text. */
function scoreKeywords(text, keywords) {
    let score = 0;
    for (const kw of keywords) {
        if (text.includes(kw.toLowerCase())) score++;
    }
    return score;
}

/** Extract keywords that actually appear in the text (max 8). */
function extractKeywords(text, keywords) {
    return keywords
        .filter(kw => text.includes(kw.toLowerCase()))
        .slice(0, 8);
}

/** Stage 1 — fast emergency gate. Returns true/false. */
function _isEmergency(text) {
    const n = normalise(text);
    return EMERGENCY_KEYWORDS.some(kw => n.includes(kw.toLowerCase()));
}

/** Stage 2 — full rule-based classification. */
function _ruleBased(text) {
    const n = normalise(text);

    // Score every category
    let bestScore = 0;
    let bestEntry = null;

    for (const entry of CATEGORY_MATRIX) {
        const score = scoreKeywords(n, entry.keywords);
        if (score > bestScore) {
            bestScore = score;
            bestEntry = entry;
        }
    }

    // Default to General Maintenance if no category matched
    if (!bestEntry || bestScore === 0) {
        return null; // trigger fallback
    }

    // Determine priority (start with category default, then override)
    let priority = bestEntry.priority;
    for (const override of PRIORITY_OVERRIDES) {
        if (scoreKeywords(n, override.keywords) > 0) {
            // Only upgrade priority, never downgrade via override unless Routine
            const levels = ['Routine', 'Medium', 'High', 'Emergency'];
            if (levels.indexOf(override.priority) > levels.indexOf(priority) ||
                override.priority === 'Routine') {
                priority = override.priority;
            }
            break; // apply the first (highest) override
        }
    }

    const isEmergency = priority === 'Emergency';
    const allKw = [...bestEntry.keywords, ...EMERGENCY_KEYWORDS];
    const kw = extractKeywords(n, allKw);

    // Build a quick summary
    const summary = `${isEmergency ? '⚠️ EMERGENCY: ' : ''}${bestEntry.category} issue reported. ` +
        `Keywords detected: ${kw.length ? kw.join(', ') : 'general complaint'}.`;

    // Confidence: based on score relative to max possible keywords
    const maxPossible = bestEntry.keywords.length;
    const confidence = Math.min(100, Math.round((bestScore / maxPossible) * 100));

    return {
        category:    bestEntry.category,
        priority,
        urgency:     URGENCY_MAP[priority] || 'Within 2-3 days',
        department:  bestEntry.department,
        summary,
        keywords:    kw,
        isEmergency,
        confidence,
    };
}

// ─── Main exported function ───────────────────────────────────────────────────

/**
 * classifyMaintenance(text)
 * ─────────────────────────
 * Classifies a maintenance request text.
 *
 * @param  {string} text  — combined title + description from the tenant
 * @returns {Promise<object>}  always resolves (never throws); returns fallback on error
 *
 * To swap in an LLM later, replace the `_ruleBased(text)` call
 * with an async LLM call and parse the JSON it returns.
 */
async function classifyMaintenance(text) {
    try {
        if (!text || typeof text !== 'string' || text.trim().length < 3) {
            return { ...FALLBACK };
        }

        const combined = text.trim();

        // Stage 1 — immediate emergency gate
        if (_isEmergency(combined)) {
            const n = normalise(combined);
            const kw = extractKeywords(n, EMERGENCY_KEYWORDS);
            return {
                category:    'Security / Safety',
                priority:    'Emergency',
                urgency:     'Immediate',
                department:  'Emergency Response Team',
                summary:     `⚠️ EMERGENCY: Potentially life-threatening issue detected. Immediate attention required. Keywords: ${kw.join(', ')}.`,
                keywords:    kw,
                isEmergency: true,
                confidence:  100,
            };
        }

        // Stage 2 — rule-based classification
        const result = _ruleBased(combined);
        if (!result) {
            return { ...FALLBACK };
        }
        return result;

    } catch (err) {
        // Stage 3 — safe fallback (log but never throw)
        console.error('[AI Classifier] Classification error (fallback used):', err.message);
        return { ...FALLBACK };
    }
}

module.exports = {
    classifyMaintenance,
    // Exported for unit tests or direct emergency checks
    isEmergencyKeyword: _isEmergency,
};
