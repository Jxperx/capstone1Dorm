const { poolPromise } = require('../config/db');
const transporter = require('./email');

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
            WHERE t.status = 'active'
        `);
        const tenants = result.recordset || [];
        if (!tenants.length) {
            console.log('No active dorm tenants found for rent reminders.');
            return;
        }

        const now = new Date();
        // Due date is RENT_DUE_DAY of the next month (since reminder goes out on the 28th)
        const dueMonth = now.getMonth() + 1; // next month (0-indexed, so +1 moves forward)
        const dueYear = dueMonth > 11 ? now.getFullYear() + 1 : now.getFullYear();
        const dueDate = new Date(dueYear, dueMonth > 11 ? 0 : dueMonth, RENT_DUE_DAY);
        const dueDateStr = dueDate.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });

        for (const tenant of tenants) {
            const subject = `Rent Reminder for Room ${tenant.room_number || ''} – Due ${dueDateStr}`;
            const text = `Hello ${tenant.full_name}, this is a friendly reminder that your dorm rent is due on ${dueDateStr}. Please make sure to settle your monthly rent and utilities on or before the due date.`;
            const html = `
                <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; color: #1a1a1a; border: 1px solid #f0f0f0;">
                    <div style="text-align: center; margin-bottom: 24px;">
                        <h1 style="color: #c5a059; font-family: 'Playfair Display', serif; margin: 0; font-size: 26px;">EliteStay</h1>
                        <p style="text-transform: uppercase; letter-spacing: 2px; font-size: 11px; margin-top: 4px; color: #666;">Monthly Rent Reminder</p>
                    </div>
                    <p style="margin-top: 0; color: #444;">Hello <strong>${tenant.full_name}</strong>,</p>
                    <p style="color: #444;">
                        This is a friendly reminder that your monthly dorm rent${tenant.room_number ? ` for Room ${tenant.room_number}` : ''} is due on
                        <strong>${dueDateStr}</strong>.
                    </p>
                    <p style="color: #444;">
                        Please settle your rent and utilities on or before the due date to avoid any inconvenience.
                    </p>
                    <p style="color: #444;">
                        You may pay using your usual payment channel and upload your proof of payment inside the tenant portal.
                    </p>
                    <p style="margin-top: 24px; color: #444;">
                        Thank you,<br>
                        <strong>EliteStay Management</strong>
                    </p>
                    <div style="margin-top: 24px; font-size: 11px; color: #999; border-top: 1px solid #eee; padding-top: 16px; text-align: center;">
                        This is an automated reminder sent every 28th of the month. If you have already paid, you can ignore this email.
                    </div>
                </div>
            `;

            const mailOptions = {
                from: `"EliteStay Manager" <${process.env.EMAIL_USER}>`,
                to: tenant.email,
                replyTo: process.env.EMAIL_USER,
                subject,
                text,
                html
            };

            try {
                await transporter.sendMail(mailOptions);
                console.log(`Rent reminder sent to ${tenant.email}`);
            } catch (err) {
                console.error('Error sending rent reminder to', tenant.email, err.message);
            }
        }

        console.log(`Monthly rent reminders completed. ${tenants.length} tenant(s) notified.`);
    } catch (err) {
        console.error('Error running dorm rent reminders:', err);
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
