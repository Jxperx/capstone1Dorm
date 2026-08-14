const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // Use SSL/TLS
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: {
        rejectUnauthorized: false
    }
});

transporter.verify((error, success) => {
    if (error) {
        console.warn("Warning: Email transporter failed. Check EMAIL_USER and EMAIL_PASS in .env");
        console.error(error); // Log the exact error to help debug
    } else {
        console.log("Email transporter is ready to send OTPs");
    }
});

module.exports = transporter;

