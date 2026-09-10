'use strict';
const { analyzeFeedback } = require('./aiFeedbackSentimentAnalyzer');
const { classifyMaintenance } = require('./aiMaintenanceClassifier');

const GROQ_BASE = 'https://api.groq.com/openai/v1/chat/completions';
const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent';

// Priority scoring weights
function calcPriority(urgencyW, freqW, impactW, timeW) {
    const score = (urgencyW * 0.4) + (freqW * 0.3) + (impactW * 0.2) + (timeW * 0.1);
    if (score >= 0.85) return { priority: 'Critical', risk: 'High' };
    if (score >= 0.65) return { priority: 'High',     risk: 'High' };
    if (score >= 0.40) return { priority: 'Medium',   risk: 'Medium' };
    return                    { priority: 'Low',       risk: 'Low' };
}

// Executive summary generator: Groq first -> Gemini backup -> null (triggers rule-based)
async function generateExecutiveSummary(prompt) {
    // 1. Try Groq (Qwen / Compound)
    if (process.env.GROQ_API_KEY) {
        const groqModels = ['qwen/qwen3.8-27b', 'qwen/qwen3.6-27b', 'groq/compound-mini'];
        for (const model of groqModels) {
            try {
                const res = await fetch(GROQ_BASE, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model,
                        messages: [
                            {
                                role: 'system',
                                content: 'You are an executive property management operations analyst for EliteStay. Write 2-3 concise, professional, data-driven summary sentences. Do not use markdown headers, lists, or emojis.'
                            },
                            { role: 'user', content: prompt }
                        ],
                        temperature: 0.3,
                        max_tokens: 220
                    }),
                    signal: AbortSignal.timeout(6000)
                });
                if (res.ok) {
                    const data = await res.json();
                    const text = data.choices?.[0]?.message?.content?.trim();
                    if (text) return text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');
                }
            } catch (err) {
                // Try next model
            }
        }
    }

    // 2. Try Gemini backup
    if (process.env.GEMINI_API_KEY) {
        try {
            const res = await fetch(`${GEMINI_API}?key=${process.env.GEMINI_API_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: `You are an executive property management analyst. Write 2-3 concise, professional sentences summarizing this data without any emojis: ${prompt}` }] }],
                    generationConfig: { temperature: 0.3, maxOutputTokens: 256 }
                }),
                signal: AbortSignal.timeout(6000)
            });
            if (res.ok) {
                const j = await res.json();
                const text = j.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
                if (text) return text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');
            }
        } catch {
            // Fall through to null
        }
    }

    return null;
}

// Auto-tags
function autoTag(type, data) {
    const tags = [type];
    if (data.emergencyCount > 0) tags.push('Emergency');
    if (data.latePayments > 0) tags.push('Late Payment');
    if (data.negativeCount > 0) tags.push('Negative Sentiment');
    if (data.highRisk) tags.push('High Risk');
    return tags.join(',');
}

// -----------------------------------------------------------------------------
//  MAINTENANCE REPORT
// -----------------------------------------------------------------------------
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
            item: `[${r.ai_priority || 'Standard'}] ${r.title} - ${r.full_name || 'Resident'} (${r.room_number ? 'Room ' + r.room_number : 'Unassigned'})`,
            emergency: !!r.ai_is_emergency
        }));

    // Insights (pure text, zero emojis)
    const insights = [];
    if (emergency.length > 0) insights.push(`${emergency.length} emergency request(s) require immediate dispatch.`);
    if (hotUnits.length > 0) insights.push(`Recurring issues detected in units: ${hotUnits.map(([u, v]) => `${u} (${v.length} requests)`).join(', ')}.`);
    const topCat = Object.entries(catMap).sort((a, b) => b[1] - a[1])[0];
    if (topCat) insights.push(`Most common maintenance category: ${topCat[0]} (${topCat[1]} requests).`);
    if (missingAI > 0) insights.push(`${missingAI} request(s) awaiting automated AI classification.`);

    const recs = [];
    if (emergency.length > 0) recs.push('Dispatch emergency response team immediately for flagged high-priority requests.');
    if (pending.length > 5) recs.push(`Address pending maintenance queue: ${pending.length} requests require action.`);
    if (hotUnits.length > 0) recs.push(`Conduct scheduled on-site inspection for repeat issue units: ${hotUnits.map(([u]) => u).join(', ')}.`);
    recs.push('Conduct weekly facility review to prevent recurring maintenance escalations.');

    const summaryPrompt = `Maintenance report metrics: ${total} total requests, ${emergency.length} emergencies, ${pending.length} pending, ${resolved.length} resolved. Leading category: ${topCat?.[0] || 'General Maintenance'}.`;
    const aiSummary = await generateExecutiveSummary(summaryPrompt);
    const summary = aiSummary || `There are ${total} maintenance requests on record, with ${emergency.length} emergency case(s) and ${pending.length} currently awaiting resolution. A total of ${resolved.length} requests have been successfully completed. High-priority items require immediate dispatch.`;

    return {
        title: 'Maintenance Operations & Facility Report',
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
        conclusion: `The maintenance portfolio exhibits a ${priority.toLowerCase()} priority rating. ${recs[0] || 'Continue scheduled maintenance operations.'}`
    };
}

// -----------------------------------------------------------------------------
//  FINANCIAL REPORT
// -----------------------------------------------------------------------------
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
    if (latePayments.length > 0) insights.push(`${latePayments.length} payment(s) are overdue by more than 30 days.`);
    if (anomalies.length > 0) insights.push(`${anomalies.length} duplicate payment pattern(s) identified for verification.`);
    insights.push(`Total verified revenue: PHP ${totalRevenue.toLocaleString('en-PH', { minimumFractionDigits: 2 })}.`);
    if (pendingAmount > 0) insights.push(`PHP ${pendingAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })} currently in pending verification.`);

    const recs = [];
    if (latePayments.length > 0) recs.push(`Issue payment reminders to ${latePayments.length} tenant(s) with overdue balances.`);
    if (anomalies.length > 0) recs.push('Review duplicate transaction records for potential clerical or reference errors.');
    if (pending.length > 0) recs.push(`Process and verify ${pending.length} pending transaction(s) to maintain ledger accuracy.`);
    recs.push('Ensure all submitted receipts have matching bank or GCash reference logs.');

    const summaryPrompt = `Financial summary metrics: Total approved revenue PHP ${totalRevenue.toFixed(2)}, ${pending.length} pending payments worth PHP ${pendingAmount.toFixed(2)}, ${latePayments.length} overdue accounts, ${anomalies.length} duplicate entries.`;
    const aiSummary = await generateExecutiveSummary(summaryPrompt);
    const summary = aiSummary || `Total verified revenue stands at PHP ${totalRevenue.toLocaleString('en-PH', { minimumFractionDigits: 2 })} from ${approved.length} approved transactions. There are ${pending.length} payments pending verification totaling PHP ${pendingAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}. ${latePayments.length > 0 ? `${latePayments.length} transaction(s) exceed the 30-day pending window.` : 'All accounts remain in good standing.'}`;

    const ranked = [...latePayments]
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .slice(0, 5)
        .map((r, i) => ({
            rank: i + 1,
            item: `Late Payment - ${r.full_name || 'Resident'} (Room ${r.room_number || 'N/A'}) PHP ${parseFloat(r.amount).toLocaleString()} - ${Math.round((now - new Date(r.created_at)) / 86400000)} days overdue`,
            emergency: false
        }));

    return {
        title: 'Financial Revenue & Collections Summary',
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
        conclusion: `Financial operational health is at ${priority.toLowerCase()} priority. ${recs[0] || 'Continue monitoring monthly collections.'}`
    };
}

// -----------------------------------------------------------------------------
//  COMPLAINTS (FEEDBACK) REPORT
// -----------------------------------------------------------------------------
async function buildComplaintsReport(rows, filters) {
    const negative = rows.filter(r => r.ai_sentiment === 'Negative');
    const positive = rows.filter(r => r.ai_sentiment === 'Positive');
    const needsAttn = rows.filter(r => r.ai_needs_attention && !r.is_resolved);
    const resolved = rows.filter(r => r.is_resolved).length;
    const pendingNegative = rows.filter(r => !r.is_resolved && r.ai_sentiment === 'Negative').length;

    // Unit clustering
    const unitMap = {};
    rows.forEach(r => {
        const u = r.room_number || 'Unknown';
        if (!unitMap[u]) unitMap[u] = { negative: 0, total: 0, resolved: 0 };
        unitMap[u].total++;
        if (r.ai_sentiment === 'Negative') unitMap[u].negative++;
        if (r.is_resolved) unitMap[u].resolved++;
    });

    const topicMap = {};
    rows.forEach(r => {
        const topics = Array.isArray(r.ai_topics)
            ? r.ai_topics
            : (r.ai_topics || '').split(',').map(t => t.trim()).filter(Boolean);
        topics.forEach(t => { topicMap[t] = (topicMap[t] || 0) + 1; });
    });

    const urgencyW = needsAttn.length / Math.max(rows.length, 1);
    const freqW    = pendingNegative / Math.max(rows.length, 1);
    const impactW  = Object.values(unitMap).some(u => u.negative > 2) ? 0.8 : 0.3;
    const timeW    = 0.4;
    const { priority, risk } = calcPriority(urgencyW, freqW, impactW, timeW);
    const confidence = Math.round(((rows.length - rows.filter(r => !r.ai_sentiment).length) / Math.max(rows.length, 1)) * 100);

    const topTopic = Object.entries(topicMap).sort((a, b) => b[1] - a[1])[0];
    const insights = [];
    if (negative.length > 0) insights.push(`${negative.length} negative feedback record(s) logged (${Math.round(negative.length / Math.max(rows.length, 1) * 100)}% of total).`);
    if (resolved > 0) insights.push(`${resolved} complaint(s) resolved successfully (${Math.round(resolved / Math.max(negative.length, 1) * 100)}% resolution rate).`);
    if (positive.length > 0) insights.push(`${positive.length} positive feedback entry/entries recorded.`);
    if (topTopic) insights.push(`Most prominent concern topic: "${topTopic[0]}" (${topTopic[1]} mentions).`);
    const hotUnit = Object.entries(unitMap).sort((a, b) => b[1].negative - a[1].negative)[0];
    if (hotUnit && hotUnit[1].negative > 1) insights.push(`Unit ${hotUnit[0]} logged the highest feedback frequency (${hotUnit[1].negative} negative, ${hotUnit[1].resolved || 0} resolved).`);

    const recs = [];
    if (pendingNegative > 0) recs.push(`Address the remaining ${pendingNegative} active resident concern(s).`);
    if (resolved > 0) recs.push(`Follow up with residents on ${resolved} resolved cases to verify satisfaction.`);
    if (hotUnit && hotUnit[1].negative > 1) recs.push(`Schedule inspection for unit ${hotUnit[0]} regarding repeated concerns.`);
    if (topTopic) recs.push(`Deploy targeted measures for recurring "${topTopic[0]}" topics.`);
    recs.push('Maintain 24-hour response standard for tenant inquiries and feedback.');

    const summaryPrompt = `Tenant complaint metrics: ${rows.length} total feedback, ${negative.length} negative (${resolved} resolved, ${pendingNegative} active), ${positive.length} positive. Leading topic: ${topTopic?.[0] || 'General Living'}.`;
    const aiSummary = await generateExecutiveSummary(summaryPrompt);
    const summary = aiSummary || `A total of ${rows.length} tenant feedback records were evaluated, including ${negative.length} negative concerns. Management has resolved ${resolved} issues, with ${pendingNegative} active items currently in review. The primary focus area is "${topTopic?.[0] || 'General Inquiries'}".`;

    const ranked = [...rows]
        .filter(r => r.ai_sentiment === 'Negative' || r.ai_needs_attention)
        .slice(0, 8)
        .map((r, i) => ({
            rank: i + 1,
            item: `[${r.is_resolved ? 'RESOLVED' : 'ACTIVE'}] ${r.tenant_name || 'Resident'} (Unit ${r.room_number || 'N/A'}): "${(r.feedback_text || '').slice(0, 80)}..."`,
            emergency: !r.is_resolved && r.ai_needs_attention
        }));

    return {
        title: 'Tenant Complaint & Feedback Sentiment Report',
        report_type: 'complaints',
        generatedAt: new Date().toISOString(),
        filters,
        executiveSummary: summary,
        keyInformation: {
            totalFeedback: rows.length,
            negativeComplaints: negative.length,
            resolvedComplaints: resolved,
            activeActionNeeded: pendingNegative,
            positiveReports: positive.length
        },
        detailedFindings: { topicFrequency: topicMap, unitSummary: unitMap },
        priorityRisk: { priority, risk, confidence },
        insights,
        recommendations: recs,
        topCriticalItems: ranked,
        dataQualityNotes: { missingSentiment: rows.filter(r => !r.ai_sentiment).length, totalRecordsAnalyzed: rows.length },
        conclusion: `Resident feedback indicates ${resolved} resolved issues and ${pendingNegative} active items. Concern priority is rated at ${priority.toLowerCase()}.`
    };
}

// -----------------------------------------------------------------------------
//  BOOKING ACTIVITY REPORT
// -----------------------------------------------------------------------------
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
    const confidence = 88;

    const insights = [];
    insights.push(`${inquiries.length} total inquiries received with a ${convRate}% conversion rate to approved bookings.`);
    if (flagged.length > 0) insights.push(`${flagged.length} inquiry/inquiries flagged for spam or validation anomalies.`);
    insights.push(`${active.length} active tenants currently occupying managed units.`);
    if (convRate < 30) insights.push('Inquiry conversion rate is below 30% - marketing and follow-up adjustments recommended.');

    const recs = [];
    if (convRate < 30) recs.push('Implement faster initial inquiry outreach to increase booking conversions.');
    if (flagged.length > 0) recs.push(`Review ${flagged.length} flagged inquiries for spam patterns or incomplete contact info.`);
    recs.push('Engage approved inquiry applicants within 24 hours to secure lease deposits.');

    const summaryPrompt = `Booking activity metrics: ${inquiries.length} inquiries, ${approved.length} approved, ${convRate}% conversion rate, ${active.length} active tenants.`;
    const aiSummary = await generateExecutiveSummary(summaryPrompt);
    const summary = aiSummary || `A total of ${inquiries.length} inquiries were recorded, resulting in ${approved.length} approved bookings for a ${convRate}% conversion rate. Currently ${active.length} tenants are actively leasing units across the property portfolio.`;

    return {
        title: 'Booking & Inquiry Conversion Activity Report',
        report_type: 'booking',
        generatedAt: new Date().toISOString(),
        filters,
        executiveSummary: summary,
        keyInformation: { totalInquiries: inquiries.length, approved: approved.length, flagged: flagged.length, conversionRate: `${convRate}%`, activeTenants: active.length },
        detailedFindings: {},
        priorityRisk: { priority, risk, confidence },
        insights,
        recommendations: recs,
        topCriticalItems: flagged.slice(0, 5).map((i, idx) => ({ rank: idx + 1, item: `Flagged Inquiry - ${i.full_name || i.name || 'Applicant'} (${i.email || 'No email'})`, emergency: false })),
        dataQualityNotes: { totalRecordsAnalyzed: inquiries.length + tenants.length },
        conclusion: `Booking performance is evaluated at ${priority.toLowerCase()} priority. ${recs[0] || 'Continue monitoring occupancy metrics.'}`
    };
}

// -----------------------------------------------------------------------------
//  INCIDENT REPORT (Emergency maintenance only)
// -----------------------------------------------------------------------------
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
    if (open.length > 0) insights.push(`${open.length} active emergency incident(s) require immediate on-site response.`);
    if (resolved.length > 0) insights.push(`${resolved.length} incident(s) have been successfully mitigated and closed.`);
    if (incidents.length === 0) insights.push('No emergency incidents were reported during the selected period.');

    const recs = [];
    if (open.length > 0) {
        recs.push('Dispatch maintenance contractor to open incident locations immediately.');
        recs.push('Issue status update to affected tenants within 2 hours.');
    }
    recs.push('Conduct post-incident review within 48 hours of resolution.');
    recs.push('Review emergency isolation procedures for water and power systems.');

    const summaryPrompt = `Emergency incident metrics: ${incidents.length} total incidents, ${open.length} unresolved, ${resolved.length} resolved.`;
    const aiSummary = await generateExecutiveSummary(summaryPrompt);
    const summary = aiSummary || `${incidents.length} emergency incident(s) were logged during this period. ${open.length} incident(s) currently remain active and require immediate dispatch. ${resolved.length} cases have been resolved.`;

    return {
        title: 'Emergency & Incident Escalation Report',
        report_type: 'incident',
        generatedAt: new Date().toISOString(),
        filters,
        executiveSummary: summary,
        keyInformation: { totalIncidents: incidents.length, openIncidents: open.length, resolved: resolved.length },
        detailedFindings: { openIncidents: open.map(r => ({ id: r.id, title: r.title, tenant: r.full_name, room: r.room_number, reported: r.reported_at, category: r.ai_category })) },
        priorityRisk: { priority, risk, confidence: 100 },
        insights,
        recommendations: recs,
        topCriticalItems: open.slice(0, 5).map((r, i) => ({ rank: i + 1, item: `[EMERGENCY] ${r.title} - ${r.full_name || 'Resident'} (${r.room_number ? 'Room ' + r.room_number : 'Facility'})`, emergency: true })),
        dataQualityNotes: { totalRecordsAnalyzed: rows.length, emergencyFlagged: incidents.length },
        conclusion: open.length > 0 ? 'CRITICAL: Open emergency incidents require immediate intervention.' : 'All incidents resolved. Preventive facility monitoring active.'
    };
}

module.exports = {
    buildMaintenanceReport,
    buildFinancialReport,
    buildComplaintsReport,
    buildBookingReport,
    buildIncidentReport,
    autoTag
};
