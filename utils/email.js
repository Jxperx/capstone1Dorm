const nodemailer = require('nodemailer');

// ── Startup diagnostics ──────────────────────────────────────────────────────
const hasEmailJS = !!process.env.EMAILJS_PUBLIC_KEY;
const hasSmtp    = !!(process.env.EMAIL_USER && process.env.EMAIL_PASS);

if (hasEmailJS) {
    console.log('[Email] ✅ EmailJS credentials detected — will send via EmailJS HTTP API.');
} else if (hasSmtp) {
    console.log(`[Email] ✅ SMTP credentials detected for: ${process.env.EMAIL_USER}`);
} else {
    console.error('[Email] ❌ No email provider configured. Set EMAILJS_PUBLIC_KEY or EMAIL_USER/EMAIL_PASS.');
}

// ── EmailJS HTTP API sender ──────────────────────────────────────────────────
async function sendViaEmailJS(mailOptions) {
    // Extract 6-digit OTP code if present in subject or text
    const searchString = `${mailOptions.subject || ''} ${mailOptions.text || ''}`;
    const otpMatch = searchString.match(/\b\d{6}\b/);
    const otpCode = otpMatch ? otpMatch[0] : '';

    // Extract user's name if present (e.g. Hello Jaxper,)
    const nameMatch = searchString.match(/Hello\s+([^,]+)/i);
    const userName = nameMatch ? nameMatch[1].trim() : 'Valued Tenant';

    // Generate formatted expiry time (5 mins from now)
    const expiryTime = new Date(Date.now() + 5 * 60 * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const payload = {
        service_id: process.env.EMAILJS_SERVICE_ID,
        template_id: process.env.EMAILJS_TEMPLATE_ID,
        user_id: process.env.EMAILJS_PUBLIC_KEY,
        accessToken: process.env.EMAILJS_PRIVATE_KEY,
        template_params: {
            // Recipient mappings
            email: mailOptions.to,
            to_email: mailOptions.to,
            to_name: userName,

            // OTP Code mappings (matches {{code}}, {{otp}}, {{otp_code}}, {{passcode}})
            otp_code: otpCode,
            otp: otpCode,
            code: otpCode,
            verification_code: otpCode,
            passcode: otpCode,

            // User name mappings (matches {{user_name}}, {{name}})
            user_name: userName,
            name: userName,

            // Expiry mappings (matches {{expiry}}, {{expires}}, {{valid_till}}, {{time}})
            expiry: expiryTime,
            expires: expiryTime,
            valid_till: expiryTime,
            expiration_time: '5 minutes',
            time: expiryTime,

            // General fallbacks
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

if (hasSmtp && !hasEmailJS) {
    transporter.verify((err) => {
        if (err) console.warn('[Email] ⚠️  SMTP verify failed:', err.message);
        else     console.log('[Email] ✅ SMTP (port 465) is ready.');
    });
}

// ── Unified sender: EmailJS -> SMTP fallback ──────────────────────
async function sendMailWithFallback(mailOptions) {
    // 1) Try EmailJS if configured
    if (hasEmailJS) {
        try {
            return await sendViaEmailJS(mailOptions);
        } catch (emailjsErr) {
            console.warn('[Email] EmailJS failed:', emailjsErr.message);
            // On production (Render), SMTP is blocked, so throw the EmailJS error immediately to avoid timeout
            if (process.env.NODE_ENV === 'production') {
                throw emailjsErr;
            }
        }
    }

    // 2) SMTP fallback (works locally, blocked on Render)
    return await transporter.sendMail(mailOptions);
}

module.exports = transporter;
module.exports.sendMailWithFallback = sendMailWithFallback;

