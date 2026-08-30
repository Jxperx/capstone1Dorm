const nodemailer = require('nodemailer');

// ── Startup diagnostics ──────────────────────────────────────────────────────
const hasResend = !!process.env.RESEND_API_KEY;
const hasSmtp   = !!(process.env.EMAIL_USER && process.env.EMAIL_PASS);

if (hasResend) {
    console.log('[Email] ✅ Resend API key detected — will send via HTTP API.');
} else if (hasSmtp) {
    console.log(`[Email] ✅ SMTP credentials detected for: ${process.env.EMAIL_USER}`);
} else {
    console.error('[Email] ❌ No email provider configured. Set RESEND_API_KEY or EMAIL_USER/EMAIL_PASS.');
}

// ── Resend HTTP API sender ───────────────────────────────────────────────────
async function sendViaResend(mailOptions) {
    // Resend requires domain verification to send from custom domains (like gmail.com).
    // If they haven't verified a domain, we default to onboarding@resend.dev so it works out of the box.
    const fromEmail = process.env.RESEND_FROM || 'onboarding@resend.dev';
    const fromName = typeof mailOptions.from === 'string' && mailOptions.from.includes('<')
        ? mailOptions.from.replace(/<.*>/, '').replace(/"/g, '').trim()
        : 'EliteStay Manager';

    const body = {
        from: `${fromName} <${fromEmail}>`,
        to: [mailOptions.to],
        subject: mailOptions.subject
    };

    if (mailOptions.html) body.html = mailOptions.html;
    if (mailOptions.text) body.text = mailOptions.text;
    if (!body.html && !body.text) body.text = ' ';

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errData = await response.text();
        throw new Error(`Resend HTTP ${response.status}: ${errData}`);
    }

    const result = await response.json();
    console.log('[Email] ✅ Sent via Resend API. ID:', result.id);
    return { messageId: result.id };
}

// ── Nodemailer SMTP sender (local dev fallback) ──────────────────────────────
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 10000,
    socketTimeout: 15000
});

if (hasSmtp && !hasResend) {
    transporter.verify((err) => {
        if (err) console.warn('[Email] ⚠️  SMTP verify failed:', err.message);
        else     console.log('[Email] ✅ SMTP (port 465) is ready.');
    });
}

// ── Unified sender: Resend first → SMTP fallback ────────────────────────────
async function sendMailWithFallback(mailOptions) {
    // 1) Try Resend if configured
    if (hasResend) {
        try {
            return await sendViaResend(mailOptions);
        } catch (resendErr) {
            console.warn('[Email] Resend failed:', resendErr.message);
            // On production (Render), SMTP is blocked, so throw the Resend error immediately to avoid timeout
            if (process.env.NODE_ENV === 'production') {
                throw resendErr;
            }
            if (!hasSmtp) throw resendErr;
            console.warn('[Email] Falling back to SMTP...');
        }
    }

    // 2) SMTP fallback (works locally, blocked on Render)
    return await transporter.sendMail(mailOptions);
}

module.exports = transporter;
module.exports.sendMailWithFallback = sendMailWithFallback;

