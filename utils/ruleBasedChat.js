'use strict';
/**
 * utils/ruleBasedChat.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Offline rule-based chatbot — used as a fallback ONLY when Gemini AI is
 * completely unavailable (no API key, network down, API quota exceeded).
 *
 * Covers 12 boarding house topic categories.
 * All responses match the actual system (dashboard links, real policies).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const RESPONSES = {

    greeting: `👋 Hi there! I'm **Dorm AI**, your boarding house assistant.\n\nI'm currently running in **Offline Mode** (the AI service is temporarily unavailable), but I can still help with common questions about:\n- 🏠 House rules\n- 💳 Payments & rent\n- ⚡ Utility bills\n- 🔧 Maintenance requests\n- 📶 WiFi & internet\n- 🚨 Emergencies\n\nWhat do you need help with?`,

    rules: `📋 **House Rules:**\n\n1. **Quiet hours:** 10:00 PM – 6:00 AM (no loud noise, music, or parties)\n2. **No smoking** anywhere inside the building\n3. **Visitors** are allowed until 9:00 PM only — no overnight guests\n4. Keep **common areas** (kitchen, hallway, bathroom) clean at all times\n5. No cooking of strong-smelling food inside rooms\n6. **Lights out** in common areas at 11:00 PM\n\nViolations may result in a warning or penalties. Contact admin for clarification.`,

    payment: `💳 **Paying Your Rent:**\n\n1. Go to the **Payments** section in your tenant dashboard\n2. Choose your payment method:\n   - **GCash** — scan the QR code or enter the number\n   - **QRPH** — via PayMongo\n3. Rent is due on the **28th of each month**\n4. After paying, upload your receipt/proof of payment in the dashboard\n\n⚠️ Late payments may incur a penalty. Contact admin if you have concerns.`,

    bills: `⚡ **Utility Bills (Electricity & Water):**\n\n- Bills are calculated **monthly** based on your room's sub-meter reading\n- You can view your current bill in the **Payments tab** of your tenant dashboard\n- Bills are usually posted by the **1st week of each month**\n- Payment is included with your monthly rent or billed separately — check your dashboard for details\n\nFor questions about your specific bill amount, please message the admin.`,

    maintenance: `🔧 **Requesting Maintenance:**\n\n1. Click the **"Report Issue"** button in your tenant dashboard\n2. Describe the problem and attach a photo if possible\n3. Our maintenance team usually responds within **24–48 hours** on weekdays\n\nFor **urgent issues** (flooding, total power loss, gas leak):\n- Contact admin directly through this chat\n- Visit the admin office on the ground floor\n- Alert the security guard at the gate`,

    contact: `📞 **Contacting Admin:**\n\n- **Admin office:** Ground floor, open **9 AM – 5 PM** (weekdays)\n- **In-app chat:** Use the Live Chat button (switch to Live mode) to message admin directly\n- **Emergency number:** Check the notice board on the ground floor for the posted contact number\n\n💡 For fastest response, use the **Live Chat** feature in this app during office hours.`,

    internet: `📶 **WiFi & Internet:**\n\n- The WiFi password is **updated monthly** for security\n- Check the **notice board** on the ground floor for the current password\n- You can also ask admin via the Live Chat feature\n\n**Connection issues?**\n- Try restarting your device first\n- The common area router can be restarted — ask admin or security\n- If the problem persists for more than a day, report it as a maintenance issue`,

    emergency: `🚨 **Emergency Procedures:**\n\n- **Fire / Medical / Police:** Call **911** immediately\n- **Building security issue:** Alert the **security guard at the gate**\n- **Gas leak / flooding:** Evacuate first, then call admin\n- **Medical emergency:** Go to the nearest hospital or call 911\n\n⚠️ Do NOT use this chat for life-threatening emergencies — call 911 directly.`,

    curfew: `🕙 **Curfew & Access Hours:**\n\n- **Quiet hours:** 10:00 PM – 6:00 AM daily\n- **Visitor curfew:** All visitors must leave by **9:00 PM**\n- **Main gate:** May have specific lock-up hours — check with admin or security\n\nIf you are locked out late, contact the security guard at the gate.`,

    laundry: `🧺 **Laundry:**\n\n- Check with admin for available laundry facilities (coin laundry or shared washing area)\n- Laundry schedules may be posted on the notice board\n- Please remove your clothes promptly after washing to be considerate of other tenants\n\nFor specific laundry facility questions, contact admin.`,

    checkout: `🚪 **Move-Out / Check-Out:**\n\n- Notify admin at least **30 days in advance** before moving out\n- Return all keys and access cards on your last day\n- Your room will be inspected — any damages beyond normal wear may be deducted from your deposit\n- Request your deposit refund through admin after the inspection\n\nFor the full move-out procedure, please speak with admin directly.`,

    parking: `🚗 **Parking:**\n\n- Parking availability depends on the building — check with admin\n- Motorcycles and bicycles may have a designated parking area\n- Parking slots (if available) may require a separate agreement or fee\n\nContact admin for parking availability and current rates.`,

};

const KEYWORD_MAP = [
    { keywords: ['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening', 'sup', 'yo'], response: RESPONSES.greeting },
    { keywords: ['rule', 'policy', 'regulation', 'quiet', 'smoke', 'smoking', 'visitor', 'guest', 'overnight', 'lights'], response: RESPONSES.rules },
    { keywords: ['pay', 'payment', 'rent', 'money', 'gcash', 'qrph', 'paymongo', 'fee', 'due', 'receipt', 'transaction'], response: RESPONSES.payment },
    { keywords: ['bill', 'electric', 'electricity', 'water', 'utility', 'meter', 'kwh', 'consumption'], response: RESPONSES.bills },
    { keywords: ['fix', 'repair', 'broken', 'maintenance', 'issue', 'not working', 'damage', 'report', 'problem', 'leaking', 'flooding', 'busted'], response: RESPONSES.maintenance },
    { keywords: ['contact', 'admin', 'number', 'phone', 'office', 'reach', 'call', 'message', 'talk to'], response: RESPONSES.contact },
    { keywords: ['wifi', 'wi-fi', 'internet', 'connection', 'password', 'slow', 'network', 'router', 'signal'], response: RESPONSES.internet },
    { keywords: ['emergency', 'fire', 'danger', 'safe', 'police', 'medical', 'ambulance', '911', 'gas', 'flood'], response: RESPONSES.emergency },
    { keywords: ['curfew', 'gate', 'locked out', 'lock', 'access', 'late night', 'after hours'], response: RESPONSES.curfew },
    { keywords: ['laundry', 'washing', 'washer', 'dryer', 'clothes', 'machine'], response: RESPONSES.laundry },
    { keywords: ['move out', 'checkout', 'check out', 'leaving', 'deposit', 'refund', 'vacate', 'terminate'], response: RESPONSES.checkout },
    { keywords: ['parking', 'park', 'motorcycle', 'bike', 'bicycle', 'vehicle', 'car'], response: RESPONSES.parking },
];

function getRuleBasedReply(userMessage) {
    const msg = (userMessage || '').toLowerCase().trim();

    // Find the first matching category
    for (const entry of KEYWORD_MAP) {
        if (entry.keywords.some(kw => msg.includes(kw))) {
            return entry.response;
        }
    }

    // Default response — friendly offline message
    return `🤖 **Offline Mode**\n\nI'm currently running without my AI connection, so I can only answer common boarding house questions.\n\nFor your question, please:\n- Check your **tenant dashboard** for account-specific info\n- Use the **Live Chat** (switch to Live mode) to reach admin directly\n- Visit the **admin office** on the ground floor (9 AM – 5 PM)\n\nThe AI assistant should be back shortly!`;
}

module.exports = { getRuleBasedReply };
