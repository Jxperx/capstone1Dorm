const nodemailer = require('nodemailer');

// Startup diagnostics
const hasEmailJS = !!process.env.EMAILJS_PUBLIC_KEY;
const hasSmtp    = !!(process.env.EMAIL_USER && process.env.EMAIL_PASS);

if (hasEmailJS) {
    console.log('[Email] EmailJS credentials detected - supporting EmailJS HTTP API.');
} else if (hasSmtp) {
    console.log(`[Email] SMTP credentials detected for: ${process.env.EMAIL_USER}`);
} else {
    console.error('[Email] No email provider configured. Set EMAILJS_PUBLIC_KEY or EMAIL_USER/EMAIL_PASS.');
}

// EmailJS HTTP API sender
async function sendViaEmailJS(mailOptions) {
    // Extract 6-digit OTP code if present in subject or text
    const searchString = `${mailOptions.subject || ''} ${mailOptions.text || ''}`;
    const otpMatch = searchString.match(/\b\d{6}\b/);
    const otpCode = otpMatch ? otpMatch[0] : '';

    // Extract user name if present (e.g. Hello Jaxper,)
    const nameMatch = searchString.match(/Hello\s+([^,]+)/i);
    const userName = nameMatch ? nameMatch[1].trim() : 'Valued Tenant';

    // Generate formatted expiry time
    const expiryTime = new Date(Date.now() + 5 * 60 * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const setupLink = mailOptions.setupUrl || mailOptions.link || '';
    const isOtpEmail = !!(mailOptions.isOtp || (mailOptions.subject && /verification code|reset code|login otp/i.test(mailOptions.subject)));

    // Select template: Use EMAILJS_ONBOARDING_TEMPLATE_ID if available and this is not an OTP email
    let templateId = process.env.EMAILJS_TEMPLATE_ID;
    if (!isOtpEmail && process.env.EMAILJS_ONBOARDING_TEMPLATE_ID) {
        templateId = process.env.EMAILJS_ONBOARDING_TEMPLATE_ID;
    }

    // Code fallback: If setupLink is present and no 6-digit OTP exists, pass setupLink as code/passcode
    // so templates designed for {{code}} or {{passcode}} display the link instead of blank.
    const effectiveCode = otpCode || setupLink || '';

    const payload = {
        service_id: process.env.EMAILJS_SERVICE_ID,
        template_id: templateId,
        user_id: process.env.EMAILJS_PUBLIC_KEY,
        accessToken: process.env.EMAILJS_PRIVATE_KEY,
        template_params: {
            // Recipient mappings
            email: mailOptions.to,
            to_email: mailOptions.to,
            to_name: userName,

            // Setup Link mappings
            setup_url: setupLink,
            setup_link: setupLink,
            link: setupLink,
            url: setupLink,
            action_url: setupLink,
            reset_link: setupLink,
            password_link: setupLink,

            // OTP Code mappings (matches {{code}}, {{otp}}, {{otp_code}}, {{passcode}})
            otp_code: effectiveCode,
            otp: effectiveCode,
            code: effectiveCode,
            verification_code: effectiveCode,
            passcode: effectiveCode,

            // User name mappings
            user_name: userName,
            name: userName,

            // Expiry mappings
            expiry: setupLink ? '48 hours' : expiryTime,
            expires: setupLink ? '48 hours' : expiryTime,
            valid_till: setupLink ? '48 hours' : expiryTime,
            expiration_time: setupLink ? '48 hours' : '5 minutes',
            time: setupLink ? '48 hours' : expiryTime,

            // General fallbacks
            message: mailOptions.text || mailOptions.html || setupLink || '',
            subject: mailOptions.subject || 'EliteStay Notification'
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

    console.log('[Email] Sent via EmailJS API.');
    return { messageId: `emailjs-${Date.now()}` };
}

// Nodemailer SMTP sender
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 5000,
    socketTimeout: 8000
});

if (hasSmtp) {
    transporter.verify((err) => {
        if (err) console.warn('[Email] SMTP verify failed:', err.message);
        else     console.log('[Email] SMTP (port 465) is ready.');
    });
}

// Unified sender: Intelligent routing between SMTP and EmailJS
async function sendMailWithFallback(mailOptions) {
    const isOtpEmail = !!(mailOptions.isOtp || (mailOptions.subject && /verification code|reset code|login otp/i.test(mailOptions.subject)));

    // 1) For OTP emails: prefer EmailJS HTTP API if configured (avoiding SMTP port issues on cloud hosts)
    if (isOtpEmail && hasEmailJS) {
        try {
            return await sendViaEmailJS(mailOptions);
        } catch (emailjsErr) {
            console.warn('[Email] EmailJS OTP failed, attempting SMTP fallback:', emailjsErr.message);
            if (hasSmtp) {
                return await transporter.sendMail(mailOptions);
            }
            throw emailjsErr;
        }
    }

    // 2) For rich HTML / Onboarding / Notification emails:
    // Attempt SMTP first so recipients receive the full branded HTML email template
    if (hasSmtp) {
        try {
            const info = await transporter.sendMail(mailOptions);
            console.log(`[Email] Sent email via SMTP to ${mailOptions.to}`);
            return info;
        } catch (smtpErr) {
            console.warn('[Email] SMTP send failed or blocked, falling back to EmailJS:', smtpErr.message);
            if (hasEmailJS) {
                return await sendViaEmailJS(mailOptions);
            }
            throw smtpErr;
        }
    }

    // 3) If SMTP is not configured, send via EmailJS
    if (hasEmailJS) {
        return await sendViaEmailJS(mailOptions);
    }

    throw new Error('No working email provider configured.');
}

module.exports = transporter;
module.exports.sendMailWithFallback = sendMailWithFallback;


