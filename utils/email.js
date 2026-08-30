const nodemailer = require('nodemailer');

// ── Startup diagnostics ──────────────────────────────────────────────────────
const hasEmailJS = !!process.env.EMAILJS_PUBLIC_KEY;
const hasResend  = !!process.env.RESEND_API_KEY;
const hasSmtp    = !!(process.env.EMAIL_USER && process.env.EMAIL_PASS);

if (hasEmailJS) {
    console.log('[Email] ✅ EmailJS credentials detected — will send via EmailJS HTTP API.');
} else if (hasResend) {
    console.log('[Email] ✅ Resend API key detected — will send via Resend HTTP API.');
} else if (hasSmtp) {
    console.log(`[Email] ✅ SMTP credentials detected for: ${process.env.EMAIL_USER}`);
} else {
    console.error('[Email] ❌ No email provider configured. Set EMAILJS_PUBLIC_KEY, RESEND_API_KEY, or EMAIL_USER/EMAIL_PASS.');
}

// ── EmailJS HTTP API sender ──────────────────────────────────────────────────
async function sendViaEmailJS(mailOptions) {
    // Extract 6-digit OTP code if present in subject or text
    const searchString = `${mailOptions.subject || ''} ${mailOptions.text || ''}`;
    const otpMatch = searchString.match(/\b\d{6}\b/);
    const otpCode = otpMatch ? otpMatch[0] : '';

    const payload = {
        service_id: process.env.EMAILJS_SERVICE_ID,
        template_id: process.env.EMAILJS_TEMPLATE_ID,
        user_id: process.env.EMAILJS_PUBLIC_KEY,
        accessToken: process.env.EMAILJS_PRIVATE_KEY,
        template_params: {
            email: mailOptions.to,
            to_email: mailOptions.to,
            otp_code: otpCode,
            otp: otpCode,
            message: mailOptions.text || mailOptions.html || '',
            subject: mailOptions.subject || ''
        }
    };

    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`EmailJS HTTP ${response.status}: ${errText}`);
    }

    console.log('[Email] ✅ Sent via EmailJS API.');
    return { messageId: `emailjs-${Date.now()}` };
}

// ── Resend HTTP API sender ───────────────────────────────────────────────────
async function sendViaResend(mailOptions) {
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

if (hasSmtp && !hasEmailJS && !hasResend) {
    transporter.verify((err) => {
        if (err) console.warn('[Email] ⚠️  SMTP verify failed:', err.message);
        else     console.log('[Email] ✅ SMTP (port 465) is ready.');
    });
}

// ── Unified sender: EmailJS -> Resend -> SMTP fallback ──────────────────────
async function sendMailWithFallback(mailOptions) {
    // 1) Try EmailJS if configured
    if (hasEmailJS) {
        try {
            return await sendViaEmailJS(mailOptions);
        } catch (emailjsErr) {
            console.warn('[Email] EmailJS failed:', emailjsErr.message);
            // On production, SMTP is blocked, so don't fall back to SMTP if it's the only other option
            if (process.env.NODE_ENV === 'production' && !hasResend) {
                throw emailjsErr;
            }
        }
    }

    // 2) Try Resend if configured
    if (hasResend) {
        try {
            return await sendViaResend(mailOptions);
        } catch (resendErr) {
            console.warn('[Email] Resend failed:', resendErr.message);
            if (process.env.NODE_ENV === 'production') {
                throw resendErr;
            }
        }
    }

    // 3) SMTP fallback (works locally, blocked on Render)
    return await transporter.sendMail(mailOptions);
}

module.exports = transporter;
module.exports.sendMailWithFallback = sendMailWithFallback;

