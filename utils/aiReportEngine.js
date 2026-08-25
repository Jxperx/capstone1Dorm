'use strict';
const { analyzeFeedback } = require('./aiFeedbackSentimentAnalyzer');
const { classifyMaintenance } = require('./aiMaintenanceClassifier');

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent';

// â”€â”€â”€ Priority scoring weights â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function calcPriority(urgencyW, freqW, impactW, timeW) {
    const score = (urgencyW * 0.4) + (freqW * 0.3) + (impactW * 0.2) + (timeW * 0.1);
    if (score >= 0.85) return { priority: 'Critical', risk: 'High' };
    if (score >= 0.65) return { priority: 'High',     risk: 'High' };
    if (score >= 0.40) return { priority: 'Medium',   risk: 'Medium' };
    return                    { priority: 'Low',       risk: 'Low' };
}

// â”€â”€â”€ Gemini executive summary (falls back to rule-based) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function geminiSummary(prompt) {
    if (!process.env.GEMINI_API_KEY) return null;
    try {
        const res = await fetch(`${GEMINI_API}?key=${process.env.GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 256 } })
        });
        if (!res.ok) return null;
        const j = await res.json();
        return j.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
    } catch { return null; }
}

// â”€â”€â”€ Auto-tags â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function autoTag(type, data) {
    const tags = [type];
    if (data.emergencyCount > 0) tags.push('Emergency');
    if (data.latePayments > 0) tags.push('Late Payment');
    if (data.negativeCount > 0) tags.push('Negative Sentiment');
    if (data.highRisk) tags.push('High Risk');
    return tags.join(',');
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  MAINTENANCE REPORT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function buildMaintenanceReport(rows, filters) {
    const total = rows.length;
    const emergency = rows.filter(r => r.ai_is_emergency);
    const pending   = rows.filter(r => r.status === 'pending');
    const resolved  = rows.filter(r => r.status === 'resolved');

    // Category frequency map
    const catMap = {};
    rows.forEach(r => {
        const c = r.ai_category || 'Uncategorized';
        catMap[c] = (catMap[c] || 0) + 1;
    });

    // Unit-level complaint clustering
    const unitMap = {};
    rows.forEach(r => {
        const u = r.room_number || 'Unknown';
        if (!unitMap[u]) unitMap[u] = [];
        unitMap[u].push(r);
    });
    const hotUnits = Object.entries(unitMap)
        .filter(([, v]) => v.length > 1)
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 5);

    // Missing fields check
    const missingAI = rows.filter(r => !r.ai_category).length;

    // Priority scoring
    const urgencyW = emergency.length > 0 ? 1 : pending.length / Math.max(total, 1);
    const freqW    = Math.min(total / 20, 1);
    const impactW  = emergency.length / Math.max(total, 1);
    const timeW    = pending.length > 5 ? 0.8 : 0.3;
    const { priority, risk } = calcPriority(urgencyW, freqW, impactW, timeW);
    const confidence = Math.round(((total - missingAI) / Math.max(total, 1)) * 100);

    // Top critical items (ranked)
    const ranked = [...rows]
        .sort((a, b) => {
            const order = { Emergency: 0, High: 1, Medium: 2, Routine: 3 };
            return (order[a.ai_priority] ?? 4) - (order[b.ai_priority] ?? 4);
        })
        .slice(0, 5)
        .map((r, i) => ({
            rank: i + 1,
            item: `[${r.ai_priority || 'N/A'}] ${r.title} â€” ${r.full_name || 'Unknown'} (${r.room_number || 'â€”'})`,
            emergency: !!r.ai_is_emergency
        }));

    // Insights
    const insights = [];
    if (emergency.length > 0) insights.push(`âš ï¸ ${emergency.length} emergency request(s) require immediate attention.`);
    if (hotUnits.length > 0) insights.push(`ðŸ” Recurring issues detected in: ${hotUnits.map(([u, v]) => `${u} (${v.length}x)`).join(', ')}.`);
    const topCat = Object.entries(catMap).sort((a, b) => b[1] - a[1])[0];
    if (topCat) insights.push(`ðŸ“Š Most common category: ${topCat[0]} (${topCat[1]} requests).`);
    if (missingAI > 0) insights.push(`â„¹ï¸ ${missingAI} request(s) not yet classified by AI.`);

    const recs = [];
    if (emergency.length > 0) recs.push('Dispatch emergency response team immediately for flagged requests.');
    if (pending.length > 5) recs.push(`Address backlog: ${pending.length} requests still pending.`);
    if (hotUnits.length > 0) recs.push(`Inspect high-frequency units: ${hotUnits.map(([u]) => u).join(', ')}.`);
    recs.push('Schedule weekly maintenance review to prevent escalation.');

    const summaryPrompt = `You are a property manager assistant. Write a 3-sentence executive summary for a maintenance report with: ${total} total requests, ${emergency.length} emergencies, ${pending.length} pending, ${resolved.length} resolved. Top category: ${topCat?.[0] || 'N/A'}. Be concise and professional.`;
    const aiSummary = await geminiSummary(summaryPrompt);
    const summary = aiSummary || `There are ${total} maintenance requests on record, with ${emergency.length} emergency case(s) and ${pending.length} still pending resolution. ${resolved.length} requests have been resolved. Immediate attention is required for high-priority items.`;

    return {
        title: 'Maintenance Report',
        report_type: 'maintenance',
        generatedAt: new Date().toISOString(),
        filters,
        executiveSummary: summary,
        keyInformation: { totalRequests: total, emergencies: emergency.length, pending: pending.length, resolved: resolved.length, categoriesFound: Object.keys(catMap).length },
        detailedFindings: {
            byCategory: catMap,
            byUnit: Object.fromEntries(Object.entries(unitMap).map(([k, v]) => [k, v.length])),
            emergencyDetails: emergency.map(r => ({ id: r.id, title: r.title, tenant: r.full_name, room: r.room_number, reported: r.reported_at }))
        },
        priorityRisk: { priority, risk, confidence },
        insights,
        recommendations: recs,
        topCriticalItems: ranked,
        dataQualityNotes: {
            missingAIClassification: missingAI,
            missingRoomAssignment: rows.filter(r => !r.room_number).length,
            totalRecordsAnalyzed: total
        },
        conclusion: `The maintenance system shows ${priority.toLowerCase()} priority status. ${recs[0] || 'Continue monitoring.'}`
    };
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  FINANCIAL REPORT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function buildFinancialReport(rows, filters) {
    const approved = rows.filter(r => r.status === 'approved');
    const pending  = rows.filter(r => r.status === 'pending');
    const rejected = rows.filter(r => r.status === 'rejected');

    const totalRevenue  = approved.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
    const pendingAmount = pending.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);

    // Anomaly: duplicate amounts from same tenant
    const tenantPayMap = {};
    rows.forEach(r => {
        const k = `${r.tenant_id}-${r.amount}`;
        tenantPayMap[k] = (tenantPayMap[k] || 0) + 1;
    });
    const anomalies = Object.entries(tenantPayMap).filter(([, v]) => v > 1).map(([k]) => k);

    // Late payment detection (pending > 30 days)
    const now = Date.now();
    const latePayments = pending.filter(r => {
        const age = (now - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24);
        return age > 30;
    });

    const urgencyW = latePayments.length > 0 ? 0.8 : 0.2;
    const freqW    = anomalies.length > 0 ? 0.7 : 0.1;
    const impactW  = pendingAmount > 10000 ? 0.9 : 0.3;
    const timeW    = latePayments.length > 3 ? 0.9 : 0.3;
    const { priority, risk } = calcPriority(urgencyW, freqW, impactW, timeW);
    const confidence = Math.round(((rows.length - pending.length * 0.3) / Math.max(rows.length, 1)) * 100);

    const insights = [];
    if (latePayments.length > 0) insights.push(`âš ï¸ ${latePayments.length} payment(s) overdue by more than 30 days.`);
    if (anomalies.length > 0) insights.push(`ðŸ” ${anomalies.length} duplicate payment pattern(s) detected â€” possible anomaly.`);
    insights.push(`ðŸ’° Total approved revenue: â‚±${totalRevenue.toLocaleString('en-PH', { minimumFractionDigits: 2 })}.`);
    if (pendingAmount > 0) insights.push(`â³ â‚±${pendingAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })} awaiting approval.`);

    const recs = [];
    if (latePayments.length > 0) recs.push(`Send reminders to ${latePayments.length} tenant(s) with overdue payments.`);
    if (anomalies.length > 0) recs.push('Review flagged duplicate payment patterns for potential fraud.');
    if (pending.length > 0) recs.push(`Approve or reject ${pending.length} pending payment(s) promptly.`);
    recs.push('Ensure all payments are logged with valid reference numbers.');

    const summaryPrompt = `Write a 3-sentence financial summary: Total revenue â‚±${totalRevenue.toFixed(2)}, ${pending.length} pending payments worth â‚±${pendingAmount.toFixed(2)}, ${latePayments.length} overdue, ${anomalies.length} anomalies detected. Professional tone.`;
    const aiSummary = await geminiSummary(summaryPrompt);
    const summary = aiSummary || `Total approved revenue stands at â‚±${totalRevenue.toLocaleString('en-PH', { minimumFractionDigits: 2 })} from ${approved.length} transactions. There are ${pending.length} payments pending approval worth â‚±${pendingAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}. ${latePayments.length > 0 ? `${latePayments.length} payment(s) are overdue and require immediate follow-up.` : 'No overdue payments detected.'}`;

    const ranked = [...latePayments]
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .slice(0, 5)
        .map((r, i) => ({
            rank: i + 1,
            item: `Late Payment â€” ${r.full_name || 'Unknown'} (Room ${r.room_number || 'â€”'}) â‚±${parseFloat(r.amount).toLocaleString()} â€” ${Math.round((now - new Date(r.created_at)) / 86400000)} days overdue`,
            emergency: false
        }));

    return {
        title: 'Financial Summary Report',
        report_type: 'financial',
        generatedAt: new Date().toISOString(),
        filters,
        executiveSummary: summary,
        keyInformation: { totalTransactions: rows.length, approved: approved.length, pending: pending.length, rejected: rejected.length, totalRevenue, pendingAmount, latePaymentsCount: latePayments.length },
        detailedFindings: { anomalies, latePayments: latePayments.map(r => ({ id: r.id, tenant: r.full_name, amount: r.amount, created: r.created_at })) },
        priorityRisk: { priority, risk, confidence },
        insights,
        recommendations: recs,
        topCriticalItems: ranked,
        dataQualityNotes: { missingAmounts: rows.filter(r => !r.amount).length, totalRecordsAnalyzed: rows.length },
        conclusion: `Financial health is at ${priority.toLowerCase()} priority. ${recs[0] || 'Continue monitoring collections.'}`
    };
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  COMPLAINTS (FEEDBACK) REPORT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function buildComplaintsReport(rows, filters) {
    const negative = rows.filter(r => r.ai_sentiment === 'Negative');
    const positive = rows.filter(r => r.ai_sentiment === 'Positive');
    const needsAttn = rows.filter(r => r.ai_needs_attention);

    // Unit clustering
    const unitMap = {};
    rows.forEach(r => {
        const u = r.room_number || 'Unknown';
        if (!unitMap[u]) unitMap[u] = { negative: 0, total: 0 };
        unitMap[u].total++;
        if (r.ai_sentiment === 'Negative') unitMap[u].negative++;
    });

    const topicMap = {};
    rows.forEach(r => {
        const topics = Array.isArray(r.ai_topics)
            ? r.ai_topics
            : (r.ai_topics || '').split(',').map(t => t.trim()).filter(Boolean);
        topics.forEach(t => { topicMap[t] = (topicMap[t] || 0) + 1; });
    });

    const urgencyW = needsAttn.length / Math.max(rows.length, 1);
    const freqW    = negative.length / Math.max(rows.length, 1);
    const impactW  = Object.values(unitMap).some(u => u.negative > 2) ? 0.8 : 0.3;
    const timeW    = 0.4;
    const { priority, risk } = calcPriority(urgencyW, freqW, impactW, timeW);
    const confidence = Math.round(((rows.length - rows.filter(r => !r.ai_sentiment).length) / Math.max(rows.length, 1)) * 100);

    const topTopic = Object.entries(topicMap).sort((a, b) => b[1] - a[1])[0];
    const insights = [];
    if (negative.length > 0) insights.push(`ðŸ˜Ÿ ${negative.length} negative feedback(s) detected â€” ${Math.round(negative.length / rows.length * 100)}% of total.`);
    if (positive.length > 0) insights.push(`ðŸ˜Š ${positive.length} positive feedback(s) received.`);
    if (topTopic) insights.push(`ðŸ“Œ Most complained topic: "${topTopic[0]}" (${topTopic[1]} mentions).`);
    const hotUnit = Object.entries(unitMap).sort((a, b) => b[1].negative - a[1].negative)[0];
    if (hotUnit && hotUnit[1].negative > 1) insights.push(`ðŸ  Unit ${hotUnit[0]} has the most complaints (${hotUnit[1].negative} negative).`);

    const recs = [];
    if (needsAttn.length > 0) recs.push(`Follow up on ${needsAttn.length} feedback(s) flagged as needing attention.`);
    if (hotUnit && hotUnit[1].negative > 1) recs.push(`Conduct unit inspection for ${hotUnit[0]}.`);
    if (topTopic) recs.push(`Address recurring "${topTopic[0]}" issues proactively.`);
    recs.push('Acknowledge all negative feedback within 24 hours.');

    const summaryPrompt = `Write a 3-sentence tenant complaint report summary: ${rows.length} total feedback, ${negative.length} negative, ${positive.length} positive, top topic: ${topTopic?.[0] || 'N/A'}. Professional tone.`;
    const aiSummary = await geminiSummary(summaryPrompt);
    const summary = aiSummary || `A total of ${rows.length} tenant feedback entries were analyzed, with ${negative.length} classified as negative (${Math.round(negative.length / Math.max(rows.length, 1) * 100)}%). The most prevalent complaint topic is "${topTopic?.[0] || 'N/A'}". ${needsAttn.length} feedback entries have been flagged as requiring immediate attention.`;

    const ranked = [...negative]
        .slice(0, 5)
        .map((r, i) => ({
            rank: i + 1,
            item: `Negative â€” ${r.tenant_name || 'Unknown'} (${r.room_number || 'â€”'}): "${(r.feedback_text || '').slice(0, 80)}..."`,
            emergency: false
        }));

    return {
        title: 'Tenant Complaint Report',
        report_type: 'complaints',
        generatedAt: new Date().toISOString(),
        filters,
        executiveSummary: summary,
        keyInformation: { totalFeedback: rows.length, negative: negative.length, positive: positive.length, needsAttention: needsAttn.length },
        detailedFindings: { topicFrequency: topicMap, unitSummary: unitMap },
        priorityRisk: { priority, risk, confidence },
        insights,
        recommendations: recs,
        topCriticalItems: ranked,
        dataQualityNotes: { missingSentiment: rows.filter(r => !r.ai_sentiment).length, totalRecordsAnalyzed: rows.length },
        conclusion: `Tenant sentiment is at ${priority.toLowerCase()} concern level. ${recs[0] || 'Continue engagement.'}`
    };
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  BOOKING ACTIVITY REPORT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function buildBookingReport(inquiries, tenants, filters) {
    const approved = inquiries.filter(i => i.status === 'approved');
    const flagged  = inquiries.filter(i => i.status === 'flagged');
    const active   = tenants.filter(t => t.status === 'active');
    const convRate = inquiries.length > 0 ? Math.round(approved.length / inquiries.length * 100) : 0;

    const urgencyW = inquiries.length < 3 ? 0.7 : 0.2;
    const freqW    = flagged.length / Math.max(inquiries.length, 1);
    const impactW  = convRate < 20 ? 0.8 : 0.2;
    const timeW    = 0.3;
    const { priority, risk } = calcPriority(urgencyW, freqW, impactW, timeW);
    const confidence = 85;

    const insights = [];
    insights.push(`ðŸ“¬ ${inquiries.length} total inquiries received; ${convRate}% conversion rate.`);
    if (flagged.length > 0) insights.push(`ðŸš© ${flagged.length} inquiry/inquiries flagged as spam or suspicious.`);
    insights.push(`ðŸ  ${active.length} active tenants currently occupying units.`);
    if (convRate < 30) insights.push('âš ï¸ Low inquiry-to-tenant conversion â€” consider marketing improvements.');

    const recs = [];
    if (convRate < 30) recs.push('Launch targeted promotional campaign to boost conversions.');
    if (flagged.length > 0) recs.push(`Review ${flagged.length} flagged inquiry/inquiries for spam patterns.`);
    recs.push('Follow up with approved inquiries within 48 hours to close bookings.');

    const summaryPrompt = `Write a 3-sentence booking activity summary: ${inquiries.length} inquiries, ${approved.length} approved, ${convRate}% conversion, ${active.length} active tenants. Professional tone.`;
    const aiSummary = await geminiSummary(summaryPrompt);
    const summary = aiSummary || `There have been ${inquiries.length} total inquiries with a ${convRate}% conversion rate to approved bookings. Currently ${active.length} tenants are actively occupying units. ${flagged.length > 0 ? `${flagged.length} inquiry/inquiries were flagged for spam or fraud.` : 'No spam inquiries detected.'}`;

    return {
        title: 'Booking Activity Report',
        report_type: 'booking',
        generatedAt: new Date().toISOString(),
        filters,
        executiveSummary: summary,
        keyInformation: { totalInquiries: inquiries.length, approved: approved.length, flagged: flagged.length, conversionRate: `${convRate}%`, activeTenants: active.length },
        detailedFindings: {},
        priorityRisk: { priority, risk, confidence },
        insights,
        recommendations: recs,
        topCriticalItems: flagged.slice(0, 5).map((i, idx) => ({ rank: idx + 1, item: `Flagged Inquiry â€” ${i.full_name || i.name || 'Unknown'} (${i.email || 'â€”'})`, emergency: false })),
        dataQualityNotes: { totalRecordsAnalyzed: inquiries.length + tenants.length },
        conclusion: `Booking activity is at ${priority.toLowerCase()} priority. ${recs[0] || 'Monitor occupancy trends.'}`
    };
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  INCIDENT REPORT  (emergency maintenance only)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function buildIncidentReport(rows, filters) {
    const incidents = rows.filter(r => r.ai_is_emergency || r.ai_priority === 'Emergency');
    const resolved  = incidents.filter(r => r.status === 'resolved');
    const open      = incidents.filter(r => r.status !== 'resolved');

    const urgencyW = open.length > 0 ? 1.0 : 0.1;
    const freqW    = Math.min(incidents.length / 5, 1);
    const impactW  = 1.0;
    const timeW    = open.length > 0 ? 0.9 : 0.2;
    const { priority, risk } = calcPriority(urgencyW, freqW, impactW, timeW);

    const insights = [];
    if (open.length > 0) insights.push(`ðŸš¨ ${open.length} ACTIVE incident(s) not yet resolved â€” immediate action required.`);
    if (resolved.length > 0) insights.push(`âœ… ${resolved.length} incident(s) have been resolved.`);
    if (incidents.length === 0) insights.push('âœ… No emergency incidents detected in the selected period.');

    const recs = [];
    if (open.length > 0) {
        recs.push('Dispatch emergency response team to all open incidents immediately.');
        recs.push('Notify property owner and insurance if structural damage is involved.');
    }
    recs.push('Conduct post-incident review within 48 hours of resolution.');
    recs.push('Update emergency contact list and response protocol.');

    const summaryPrompt = `Write a 3-sentence incident report summary: ${incidents.length} total incidents, ${open.length} unresolved, ${resolved.length} resolved. Professional and urgent tone.`;
    const aiSummary = await geminiSummary(summaryPrompt);
    const summary = aiSummary || `${incidents.length} emergency incident(s) were recorded in the selected period. ${open.length} remain unresolved and require immediate attention. ${resolved.length} incident(s) have been successfully resolved.`;

    return {
        title: 'Emergency Incident Report',
        report_type: 'incident',
        generatedAt: new Date().toISOString(),
        filters,
        executiveSummary: summary,
        keyInformation: { totalIncidents: incidents.length, openIncidents: open.length, resolved: resolved.length },
        detailedFindings: { openIncidents: open.map(r => ({ id: r.id, title: r.title, tenant: r.full_name, room: r.room_number, reported: r.reported_at, category: r.ai_category })) },
        priorityRisk: { priority, risk, confidence: 100 },
        insights,
        recommendations: recs,
        topCriticalItems: open.slice(0, 5).map((r, i) => ({ rank: i + 1, item: `ðŸš¨ ${r.title} â€” ${r.full_name || 'Unknown'} (${r.room_number || 'â€”'})`, emergency: true })),
        dataQualityNotes: { totalRecordsAnalyzed: rows.length, emergencyFlagged: incidents.length },
        conclusion: open.length > 0 ? 'CRITICAL: Unresolved incidents must be addressed immediately.' : 'All incidents resolved. Continue preventive monitoring.'
    };
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  MAIN EXPORT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
module.exports = {
    buildMaintenanceReport,
    buildFinancialReport,
    buildComplaintsReport,
    buildBookingReport,
    buildIncidentReport,
    autoTag
};
