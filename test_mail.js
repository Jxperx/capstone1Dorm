require('dotenv').config();
const transporter = require('./utils/email');

async function test() {
    try {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: process.env.EMAIL_USER,
            subject: 'Test',
            text: 'Test mail'
        });
        console.log('Success');
    } catch (e) {
        console.error('Mail Error:', e.message);
    }
    process.exit();
}
test();
