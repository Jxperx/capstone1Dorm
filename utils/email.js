const nodemailer = require('nodemailer');

// Log credential presence at startup (never log actual values)
if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.error('[Email] ❌ EMAIL_USER or EMAIL_PASS is NOT set. OTP emails will fail.');
    console.error('[Email] Set these in your Render dashboard under Environment variables.');
} else {
    console.log(`[Email] Credentials detected for: ${process.env.EMAIL_USER}`);
}

// Primary: port 465 (SSL) — fastest when supported
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: {
        rejectUnauthorized: false
    },
    connectionTimeout: 10000,  // 10s connection timeout
    socketTimeout: 15000       // 15s socket timeout
});

// Fallback: port 587 (STARTTLS) — more compatible with some cloud hosts
const fallbackTransporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: {
        rejectUnauthorized: false
    },
    connectionTimeout: 10000,
    socketTimeout: 15000
});

// Verify primary on startup
transporter.verify((error) => {
    if (error) {
        console.warn('[Email] ⚠️  Primary SMTP (port 465) verify failed:', error.message);
        // Try fallback
        fallbackTransporter.verify((err2) => {
            if (err2) {
                console.error('[Email] ❌ Fallback SMTP (port 587) also failed:', err2.message);
            } else {
                console.log('[Email] ✅ Fallback SMTP (port 587) is ready.');
            }
        });
    } else {
        console.log('[Email] ✅ Primary SMTP (port 465) is ready to send OTPs.');
    }
});

/**
 * Send an email with automatic fallback.
 * Tries port 465 first, falls back to port 587 if it fails.
 */
async function sendMailWithFallback(mailOptions) {
    try {
        return await transporter.sendMail(mailOptions);
    } catch (primaryErr) {
        console.warn('[Email] Primary send failed:', primaryErr.message, '— trying fallback...');
        return await fallbackTransporter.sendMail(mailOptions);
    }
}

module.exports = transporter;
module.exports.sendMailWithFallback = sendMailWithFallback;
