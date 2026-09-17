const nodemailer = require('nodemailer');

// Startup diagnostics
const hasEmailJS = !!process.env.EMAILJS_PUBLIC_KEY;
const hasResend  = !!process.env.RESEND_API_KEY;
const hasSmtp    = !!(process.env.EMAIL_USER && process.env.EMAIL_PASS);
let smtpBlocked  = false; // Set to true if SMTP port is blocked by cloud provider (e.g. Render)

if (hasResend) {
    console.log('[Email] Resend API key detected - supporting direct HTML email delivery.');
}
if (hasEmailJS) {
    console.log('[Email] EmailJS credentials detected - supporting EmailJS HTTP API.');
}
if (hasSmtp) {
    console.log(`[Email] SMTP credentials detected for: ${process.env.EMAIL_USER}`);
}
if (!hasResend && !hasEmailJS && !hasSmtp) {
    console.error('[Email] No email provider configured. Set RESEND_API_KEY, EMAILJS_PUBLIC_KEY, or EMAIL_USER/EMAIL_PASS.');
}

// Resend HTTP API sender (Direct, raw HTML/Text, no templates needed - ideal for cloud hosting)
async function sendViaResend(mailOptions) {
    const fromAddress = process.env.RESEND_FROM || 'EliteStay <onboarding@resend.dev>';
    const payload = {
        from: fromAddress,
        to: Array.isArray(mailOptions.to) ? mailOptions.to : [mailOptions.to],
        subject: mailOptions.subject || 'EliteStay Notification',
        html: mailOptions.html || undefined,
        text: mailOptions.text || undefined
    };
    if (mailOptions.replyTo || process.env.EMAIL_USER) {
        payload.reply_to = mailOptions.replyTo || process.env.EMAIL_USER;
    }

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Resend HTTP ${response.status}: ${errText}`);
    }

    const data = await response.json();
    console.log(`[Email] Successfully sent email to ${mailOptions.to} via Resend API (ID: ${data.id}).`);
    return { messageId: data.id };
}

// EmailJS HTTP API sender
async function sendViaEmailJS(mailOptions) {
    // Extract 6-digit OTP code if present in subject or text
    const searchString = `${mailOptions.subject || ''} ${mailOptions.text || ''}`;
    const otpMatch = searchString.match(/\b\d{6}\b/);
    const otpCode = otpMatch ? otpMatch[0] : '';

    // Extract user name if present (e.g. Hello Jaxper,)
    const nameMatch = searchString.match(/Hello\s+([^,\n\r]+)/i);
    const userName = (mailOptions.to_name || mailOptions.userName || (nameMatch ? nameMatch[1].trim() : 'Valued Resident'));

    // Generate formatted expiry time
    const expiryTime = new Date(Date.now() + 5 * 60 * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const setupLink = mailOptions.setupUrl || mailOptions.link || '';
    const isOtpEmail = !!(mailOptions.isOtp || (mailOptions.subject && /verification code|reset code|login otp/i.test(mailOptions.subject)));

    // Select template
    let templateId = process.env.EMAILJS_TEMPLATE_ID;
    if (mailOptions.templateId) {
        templateId = mailOptions.templateId;
    } else if (mailOptions.isReminder && process.env.EMAILJS_REMINDER_TEMPLATE_ID) {
        templateId = process.env.EMAILJS_REMINDER_TEMPLATE_ID;
    } else if (!isOtpEmail && process.env.EMAILJS_ONBOARDING_TEMPLATE_ID) {
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
            name: userName,
            user_name: userName,
            recipient_name: userName,

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

            // Expiry mappings
            expiry: setupLink ? '48 hours' : expiryTime,
            expires: setupLink ? '48 hours' : expiryTime,
            valid_till: setupLink ? '48 hours' : expiryTime,
            expiration_time: setupLink ? '48 hours' : '5 minutes',
            time: setupLink ? '48 hours' : expiryTime,

            // General fallbacks
            message: mailOptions.text || mailOptions.html || setupLink || '',
            content: mailOptions.text || mailOptions.html || '',
            subject: mailOptions.subject || 'EliteStay Notification',
            title: mailOptions.subject || 'EliteStay Notification',

            // Rent reminder & billing fields
            due_date: mailOptions.dueDate || '',
            due_date_str: mailOptions.dueDate || '',
            room_number: mailOptions.roomNumber || '',
            unit_number: mailOptions.roomNumber || '',
            monthly_rate: mailOptions.amount || '',
            amount: mailOptions.amount || '',
            rent_amount: mailOptions.amount || '',

            // Custom extra parameters
            ...(mailOptions.templateParams || {}),
            ...(mailOptions.template_params || {})
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

    console.log(`[Email] Successfully sent email to ${mailOptions.to} via EmailJS API.`);
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
        if (err) {
            smtpBlocked = true;
            console.warn('[Email] SMTP verify failed (outbound SMTP likely blocked on cloud host):', err.message);
        } else {
            smtpBlocked = false;
            console.log('[Email] SMTP (port 465) is verified and ready.');
        }
    });
}

// Unified sender: Intelligent routing between Resend, EmailJS, and SMTP
async function sendMailWithFallback(mailOptions) {
    const isOtpEmail = !!(mailOptions.isOtp || (mailOptions.subject && /verification code|reset code|login otp/i.test(mailOptions.subject)));

    // 1) Direct HTTP API with Resend (supports full custom HTML, no template setup required)
    if (hasResend) {
        try {
            return await sendViaResend(mailOptions);
        } catch (resendErr) {
            console.warn('[Email] Resend API failed, attempting other providers:', resendErr.message);
        }
    }

    // 2) For OTP emails: prefer EmailJS HTTP API if configured (avoiding SMTP port issues on cloud hosts)
    if (isOtpEmail && hasEmailJS) {
        try {
            return await sendViaEmailJS(mailOptions);
        } catch (emailjsErr) {
            console.warn('[Email] EmailJS OTP failed, attempting SMTP fallback:', emailjsErr.message);
            if (hasSmtp && !smtpBlocked) {
                return await rawSendMail(mailOptions);
            }
            throw emailjsErr;
        }
    }

    // 3) If SMTP is known to be blocked (e.g. Render firewall blocks port 465/587), go directly to EmailJS
    if (smtpBlocked && hasEmailJS) {
        try {
            return await sendViaEmailJS(mailOptions);
        } catch (emailjsErr) {
            console.warn('[Email] EmailJS send failed when SMTP marked blocked, attempting SMTP retry:', emailjsErr.message);
            if (hasSmtp) {
                return await rawSendMail(mailOptions);
            }
            throw emailjsErr;
        }
    }

    // 4) For regular emails: attempt SMTP first if available (local development)
    if (hasSmtp && !smtpBlocked) {
        try {
            const info = await rawSendMail(mailOptions);
            console.log(`[Email] Sent email via SMTP to ${mailOptions.to}`);
            smtpBlocked = false;
            return info;
        } catch (smtpErr) {
            console.warn('[Email] SMTP send failed or blocked, falling back to EmailJS:', smtpErr.message);
            if (/timeout|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/i.test(smtpErr.message || '')) {
                smtpBlocked = true;
            }
            if (hasEmailJS) {
                return await sendViaEmailJS(mailOptions);
            }
            throw smtpErr;
        }
    }

    // 5) If SMTP is not configured or blocked, send via EmailJS
    if (hasEmailJS) {
        return await sendViaEmailJS(mailOptions);
    }

    throw new Error('No working email provider configured.');
}

// Wrap raw transporter.sendMail so any legacy or direct callers automatically get the fallback
const rawSendMail = transporter.sendMail.bind(transporter);
transporter.rawSendMail = rawSendMail;
transporter.sendMail = async function (mailOptions, callback) {
    try {
        const result = await sendMailWithFallback(mailOptions);
        if (typeof callback === 'function') {
            callback(null, result);
        }
        return result;
    } catch (err) {
        if (typeof callback === 'function') {
            callback(err);
        }
        throw err;
    }
};

module.exports = transporter;
module.exports.sendMailWithFallback = sendMailWithFallback;


