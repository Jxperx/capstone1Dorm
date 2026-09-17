const { poolPromise } = require('../config/db');
const { sendMailWithFallback } = require('./email');

const RENT_DUE_DAY = parseInt(process.env.RENT_DUE_DAY || '29', 10);
const REMINDER_DAY = 28; // Always send reminders on the 28th of every month

async function sendDormRentReminders() {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT u.email, u.full_name, r.monthly_rate, t.id as tenant_id, r.room_number
            FROM tenants t
            JOIN users u ON t.user_id = u.id
            LEFT JOIN rooms r ON t.room_id = r.id
            WHERE t.status = 'active' AND u.email IS NOT NULL AND TRIM(u.email) != ''
        `);
        const tenants = (result.recordset || []).filter(t => t.email && t.email.includes('@'));
        if (!tenants.length) {
            console.log('[Reminders] No active tenants with valid email addresses found for rent reminders.');
            return {
                success: true,
                total: 0,
                sent: 0,
                failed: 0,
                message: 'No active tenants with registered email addresses found.'
            };
        }

        const now = new Date();
        // Calculate upcoming due date:
        // If today is <= RENT_DUE_DAY (e.g. 17th or 28th and due is 29th), due date is in the current month.
        // If today > RENT_DUE_DAY (e.g. 30th and due is 29th), due date is in the following month.
        let dueMonth = now.getMonth();
        let dueYear = now.getFullYear();
        if (now.getDate() > RENT_DUE_DAY) {
            dueMonth += 1;
            if (dueMonth > 11) {
                dueMonth = 0;
                dueYear += 1;
            }
        }
        const dueDate = new Date(dueYear, dueMonth, RENT_DUE_DAY);
        const dueDateStr = dueDate.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });

        let sentCount = 0;
        let failedCount = 0;
        const errors = [];

        for (const tenant of tenants) {
            const roomLabel = tenant.room_number ? `Room ${tenant.room_number}` : 'your unit';
            const rateFormatted = tenant.monthly_rate ? `₱${Number(tenant.monthly_rate).toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '';
            const subject = `Rent Reminder for ${tenant.room_number ? `${tenant.room_number} – ` : ''}Due ${dueDateStr}`;
            const text = `Hello ${tenant.full_name},\n\nThis is a friendly reminder from EliteStay Management that your monthly rent${rateFormatted ? ` (${rateFormatted})` : ''} for ${roomLabel} is due on ${dueDateStr}.\n\nPlease settle your rent and utilities on or before the due date. You may pay using your usual payment channel and upload proof of payment inside the tenant portal.\n\nThank you,\nEliteStay Management`;
            const html = `
                <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; color: #1a1a1a; border: 1px solid #eaeaea; border-radius: 8px; background-color: #ffffff;">
                    <div style="text-align: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #f0f0f0;">
                        <h1 style="color: #c5a059; font-family: 'Playfair Display', Georgia, serif; margin: 0; font-size: 26px; letter-spacing: 0.5px;">EliteStay</h1>
                        <p style="text-transform: uppercase; letter-spacing: 2px; font-size: 11px; margin-top: 6px; color: #888; font-weight: 600;">Monthly Rent Reminder</p>
                    </div>
                    <p style="margin-top: 0; color: #333; font-size: 15px; line-height: 1.6;">Hello <strong>${tenant.full_name}</strong>,</p>
                    <p style="color: #555; font-size: 14px; line-height: 1.6;">
                        This is a friendly reminder that your monthly rent${tenant.room_number ? ` for <strong>${roomLabel}</strong>` : ''} is due on
                        <strong style="color: #1a1a2e;">${dueDateStr}</strong>.
                    </p>
                    ${rateFormatted ? `
                    <div style="background-color: #f8f9fa; border-left: 4px solid #c5a059; padding: 14px 18px; margin: 20px 0; border-radius: 4px;">
                        <span style="font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #666; display: block;">Amount Due</span>
                        <strong style="font-size: 20px; color: #1a1a2e;">${rateFormatted}</strong>
                    </div>
                    ` : ''}
                    <p style="color: #555; font-size: 14px; line-height: 1.6;">
                        Please settle your rent and utilities on or before the due date to avoid any inconvenience or late penalties.
                    </p>
                    <p style="color: #555; font-size: 14px; line-height: 1.6;">
                        You may submit your payment through your preferred channel and upload your proof of payment inside your <strong>EliteStay Tenant Portal</strong>.
                    </p>
                    <p style="margin-top: 28px; color: #444; font-size: 14px; line-height: 1.6;">
                        Thank you,<br>
                        <strong>EliteStay Management</strong>
                    </p>
                    <div style="margin-top: 28px; font-size: 11px; color: #999; border-top: 1px solid #eee; padding-top: 16px; text-align: center; line-height: 1.5;">
                        This is an automated reminder. If you have already settled your payment or submitted proof of payment, please disregard this notice.
                    </div>
                </div>
            `;

            const mailOptions = {
                from: `"EliteStay Management" <${process.env.EMAIL_USER || 'no-reply@elitestay.com'}>`,
                to: tenant.email,
                replyTo: process.env.EMAIL_USER || undefined,
                subject,
                text,
                html,
                isReminder: true,
                dueDate: dueDateStr,
                roomNumber: tenant.room_number || '',
                amount: rateFormatted,
                templateParams: {
                    due_date: dueDateStr,
                    room_number: tenant.room_number || '',
                    amount: rateFormatted,
                    monthly_rate: rateFormatted,
                    rent_amount: rateFormatted,
                    message: text,
                    to_name: tenant.full_name
                }
            };

            try {
                await sendMailWithFallback(mailOptions);
                sentCount++;
                console.log(`[Reminders] Successfully sent rent reminder to ${tenant.email} (${roomLabel})`);
            } catch (err) {
                failedCount++;
                errors.push(`${tenant.email}: ${err.message}`);
                console.error(`[Reminders] Error sending rent reminder to ${tenant.email}:`, err.message);
            }
        }

        console.log(`[Reminders] Monthly rent reminders completed. Sent: ${sentCount}, Failed: ${failedCount}, Total: ${tenants.length}.`);
        return {
            success: sentCount > 0,
            total: tenants.length,
            sent: sentCount,
            failed: failedCount,
            errors
        };
    } catch (err) {
        console.error('[Reminders] Error running rent reminders:', err);
        return {
            success: false,
            total: 0,
            sent: 0,
            failed: 0,
            error: err.message
        };
    }
}

function scheduleDormRentReminders() {
    console.log(`Rent reminders scheduled to send on the ${REMINDER_DAY}th of every month.`);
    console.log(`Due date shown in emails: day ${RENT_DUE_DAY} of the following month.`);

    // Guard: tracks the last date (YYYY-MM-DD) reminders were sent.
    // If the server restarts on the 28th, this prevents a duplicate send
    // because checkAndSend() is still called once on startup.
    let lastReminderSentDate = null;

    const checkAndSend = () => {
        const today = new Date();
        const day = today.getDate();
        const todayStr = today.toISOString().split('T')[0]; // e.g. '2026-05-28'

        if (day === REMINDER_DAY) {
            // FIX: Only send if we have NOT already sent reminders today.
            // Prevents duplicate emails on crash-restart cycles on the 28th.
            if (lastReminderSentDate === todayStr) {
                console.log(`Rent reminders already sent today (${todayStr}). Skipping.`);
                return;
            }
            console.log(`Today is the ${REMINDER_DAY}th – running monthly dorm rent reminders.`);
            lastReminderSentDate = todayStr; // Mark as sent before async work to prevent race
            sendDormRentReminders();
        }
    };

    // Check immediately on startup — catches the case where the server starts
    // after 8 AM on the 28th. The guard above makes this idempotent.
    checkAndSend();

    // Schedule daily check at 8:00 AM
    const now = new Date();
    const firstRun = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 0, 0, 0);
    let delay = firstRun.getTime() - now.getTime();
    if (delay < 0) delay += 24 * 60 * 60 * 1000; // If 8 AM already passed today, wait until tomorrow

    setTimeout(() => {
        checkAndSend();
        setInterval(checkAndSend, 24 * 60 * 60 * 1000); // Re-check every 24 hours
    }, delay);
}

module.exports = {
    sendDormRentReminders,
    scheduleDormRentReminders
};
