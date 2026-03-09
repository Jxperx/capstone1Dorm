const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { poolPromise, sql } = require('./config/db');
const bcrypt = require('bcrypt');
const session = require('express-session');
const multer = require('multer'); // For image uploads
const axios = require('axios'); // For PayMongo
const nodemailer = require('nodemailer'); // Direct & Free Email Sending
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configure Nodemailer (Free SMTP)
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // Use SSL/TLS
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: {
        rejectUnauthorized: false // Helps with some network environments
    }
});

// Verify mailer connection
transporter.verify((error, success) => {
    if (error) {
        console.warn("Warning: Email transporter failed. Check EMAIL_USER and EMAIL_PASS in .env");
        console.error(error);
    } else {
        console.log("Email transporter is ready to send OTPs");
    }
});

// Configure Multer for File Uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// Ensure upload directory exists
const fs = require('fs');
if (!fs.existsSync('public/uploads')){
    fs.mkdirSync('public/uploads', { recursive: true });
}

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'secret-key', // Change this in production
    resave: false,
    saveUninitialized: true
}));

const chatRoutes = require('./routes/chat');

// Routes
app.use('/api/chat', chatRoutes);

// Serve Pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/admin', (req, res) => {
    // Basic protection
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login');
    res.sendFile(path.join(__dirname, 'public', 'admin-dashboard.html'));
});

app.get('/tenant', (req, res) => {
    // Basic protection
    if (!req.session.user) return res.redirect('/login');
    res.sendFile(path.join(__dirname, 'public', 'tenant-dashboard.html'));
});

// API: Register
app.post('/api/register', async (req, res) => {
    const { fullName, email, password, phone } = req.body;
    
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const pool = await poolPromise;
        
        await pool.request()
            .input('full_name', sql.NVarChar, fullName)
            .input('email', sql.NVarChar, email)
            .input('password_hash', sql.NVarChar, hashedPassword)
            .input('role', sql.NVarChar, 'tenant')
            .input('phone_number', sql.NVarChar, phone)
            .query('INSERT INTO users (full_name, email, password_hash, role, phone_number) VALUES (@full_name, @email, @password_hash, @role, @phone_number)');
            
        res.status(201).json({ message: 'User registered successfully' });
    } catch (err) {
        console.error('Registration Error:', err);
        res.status(500).json({ error: 'Database error or Email already exists' });
    }
});

// API: Login
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('email', sql.NVarChar, email)
            .query('SELECT * FROM users WHERE email = @email');

        if (result.recordset.length === 0) {
             return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = result.recordset[0];
        const match = await bcrypt.compare(password, user.password_hash);

        if (match) {
            // Check if user is a tenant
            if (user.role === 'tenant') {
                // Generate OTP
                const otp = Math.floor(100000 + Math.random() * 900000).toString();
                
                // Store in session temporarily
                req.session.otp = {
                    code: otp,
                    userId: user.id,
                    email: user.email,
                    expires: Date.now() + 5 * 60 * 1000 // 5 minutes
                };

                // Send Email via Nodemailer (Free)
                const mailOptions = {
                    from: `"EliteStay Manager" <${process.env.EMAIL_USER}>`,
                    to: user.email,
                    replyTo: process.env.EMAIL_USER,
                    subject: `${otp} is your EliteStay verification code`,
                    text: `Hello ${user.full_name}, your verification code for EliteStay is: ${otp}. This code will expire in 5 minutes.`,
                    html: `
                        <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px; color: #1a1a1a; border: 1px solid #f0f0f0;">
                            <div style="text-align: center; margin-bottom: 30px;">
                                <h1 style="color: #c5a059; font-family: 'Playfair Display', serif; margin: 0; font-size: 28px;">EliteStay</h1>
                                <p style="text-transform: uppercase; letter-spacing: 2px; font-size: 10px; margin-top: 5px; color: #666;">Premium Student Living</p>
                            </div>
                            <div style="background-color: #f9f9f9; padding: 30px; border-radius: 4px; text-align: center;">
                                <p style="margin-top: 0; color: #444;">Hello <strong>${user.full_name}</strong>,</p>
                                <p style="color: #444;">Your one-time verification code is:</p>
                                <div style="font-size: 38px; font-weight: bold; letter-spacing: 8px; margin: 25px 0; color: #1a1a1a; font-family: monospace;">${otp}</div>
                                <p style="font-size: 13px; color: #888; margin-bottom: 0;">This code is valid for 5 minutes.</p>
                            </div>
                            <div style="margin-top: 30px; font-size: 12px; color: #999; line-height: 1.6; text-align: center;">
                                <p>If you did not request this code, please ignore this email or contact support if you have concerns about your account security.</p>
                                <p style="margin-top: 20px; border-top: 1px solid #eee; padding-top: 20px;">© 2024 EliteStay Management. All rights reserved.</p>
                            </div>
                        </div>
                    `,
                    headers: {
                        'X-Priority': '1 (Highest)',
                        'X-MSMail-Priority': 'High',
                        'Importance': 'high'
                    }
                };

                try {
                    await transporter.sendMail(mailOptions);
                    console.log(`✅ OTP sent successfully to ${user.email}`);
                } catch (mailError) {
                    console.error('❌ Nodemailer Error details:', {
                        message: mailError.message,
                        code: mailError.code,
                        command: mailError.command,
                        response: mailError.response
                    });
                    return res.status(500).json({ 
                        error: 'Failed to send OTP email.', 
                        details: mailError.message 
                    });
                }

                return res.json({ 
                    otpRequired: true, 
                    message: 'Please enter the verification code sent to your email.' 
                });
            }

            // Admin Login (No OTP for now)
            req.session.user = { id: user.id, role: user.role, name: user.full_name };
            res.json({ role: user.role });
        } else {
            res.status(401).json({ error: 'Invalid credentials' });
        }
    } catch (err) {
        console.error('Login Error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// API: Verify OTP
app.post('/api/verify-otp', async (req, res) => {
    const { otp } = req.body;

    if (!req.session.otp) {
        return res.status(400).json({ error: 'No OTP request found. Please login again.' });
    }

    const { code, userId, expires } = req.session.otp;

    if (Date.now() > expires) {
        delete req.session.otp;
        return res.status(400).json({ error: 'OTP expired. Please login again.' });
    }

    if (otp !== code) {
        return res.status(400).json({ error: 'Invalid OTP.' });
    }

    // OTP Verified - Complete Login
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('id', sql.Int, userId)
            .query('SELECT * FROM users WHERE id = @id');
        
        if (result.recordset.length === 0) {
            return res.status(500).json({ error: 'User not found.' });
        }

        const user = result.recordset[0];
        req.session.user = { id: user.id, role: user.role, name: user.full_name };

        // Load Tenant Details
        const tenantRes = await pool.request()
            .input('user_id', sql.Int, user.id)
            .query('SELECT id, room_id FROM tenants WHERE user_id = @user_id');
            
        if (tenantRes.recordset.length > 0) {
            req.session.user.tenant_id = tenantRes.recordset[0].id;
            req.session.user.room_id = tenantRes.recordset[0].room_id;
        } else {
             // Create a dummy tenant record (Same logic as before)
             try {
                 const insertTenant = await pool.request()
                    .input('user_id', sql.Int, user.id)
                    .input('lease_start', sql.Date, new Date())
                    .query('INSERT INTO tenants (user_id, lease_start_date) OUTPUT INSERTED.id VALUES (@user_id, @lease_start)');
                 
                 req.session.user.tenant_id = insertTenant.recordset[0].id;
                 req.session.user.room_id = null;
             } catch (insertErr) {
                 console.error('Error creating tenant record:', insertErr);
             }
        }

        // Clear OTP from session
        delete req.session.otp;

        res.json({ success: true, role: 'tenant' });

    } catch (err) {
        console.error('OTP Verification Error:', err);
        res.status(500).json({ error: 'Server error during verification.' });
    }
});

// API: Logout
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// ----------------------------------------------------------------
//  TENANT APIS (Buttons)
// ----------------------------------------------------------------

// 1. Upload Payment Proof
app.post('/api/payments/upload', (req, res, next) => {
    console.log('Upload Request Received');
    upload.single('proof')(req, res, (err) => {
        if (err) {
            console.error('Multer Upload Error:', err);
            return res.status(400).json({ error: 'File upload failed: ' + err.message });
        }
        console.log('File Uploaded:', req.file);
        console.log('Body:', req.body);
        next();
    });
}, async (req, res) => {
    console.log('Processing Payment Logic');
    console.log('Session User:', req.session.user);

    if (!req.session.user || !req.session.user.tenant_id) {
        console.error('Unauthorized: No tenant_id in session');
        return res.status(403).json({ error: 'Not authorized. Please relogin.' });
    }
    
    const { amount, paymentDate, referenceNumber } = req.body;
    const proofUrl = req.file ? '/uploads/' + req.file.filename : null;
    const tenantId = req.session.user.tenant_id;

    if (!proofUrl) {
        return res.status(400).json({ error: 'No file uploaded.' });
    }

    try {
        const pool = await poolPromise;
        const reqInsert = pool.request()
            .input('tenant_id', sql.Int, tenantId)
            .input('amount', sql.Decimal(10, 2), amount || 0)
            .input('payment_date', sql.Date, paymentDate || new Date())
            .input('proof_image_url', sql.NVarChar, proofUrl)
        if (referenceNumber) {
            reqInsert.input('reference_number', sql.NVarChar, referenceNumber);
        }
        const insertQuery = referenceNumber
            ? `INSERT INTO payments (tenant_id, amount, payment_date, proof_image_url, reference_number, status) 
               VALUES (@tenant_id, @amount, @payment_date, @proof_image_url, @reference_number, 'pending')`
            : `INSERT INTO payments (tenant_id, amount, payment_date, proof_image_url, status) 
               VALUES (@tenant_id, @amount, @payment_date, @proof_image_url, 'pending')`;
        await reqInsert.query(insertQuery);
        
        console.log('Payment saved to DB');
        res.json({ message: 'Payment proof uploaded successfully!' });
    } catch (err) {
        console.error('Database Insert Error:', err);
        res.status(500).json({ error: 'Database error: ' + err.message });
    }
});

// 2. Report Maintenance Issue (with Image Upload)
app.post('/api/maintenance/report', upload.single('image'), async (req, res) => {
    if (!req.session.user || !req.session.user.tenant_id) {
        return res.status(403).json({ error: 'Not authorized' });
    }

    const { title, description } = req.body;
    const tenantId = req.session.user.tenant_id;
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;

    try {
        const pool = await poolPromise;
        await pool.request()
            .input('tenant_id', sql.Int, tenantId)
            .input('title', sql.NVarChar, title)
            .input('description', sql.NVarChar, description)
            .input('image_url', sql.NVarChar, imageUrl)
            .query(`INSERT INTO maintenance_requests (tenant_id, title, description, status, image_url) 
                    VALUES (@tenant_id, @title, @description, 'pending', @image_url)`);

        res.json({ message: 'Issue reported successfully!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// 3. Get Payment History (History Button)
app.get('/api/payments/history', async (req, res) => {
    if (!req.session.user || !req.session.user.tenant_id) {
        return res.status(403).json({ error: 'Not authorized' });
    }

    const tenantId = req.session.user.tenant_id;

    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('tenant_id', sql.Int, tenantId)
            .query('SELECT * FROM payments WHERE tenant_id = @tenant_id ORDER BY created_at DESC');
        
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ----------------------------------------------------------------
//  ADMIN APIS (Buttons)
// ----------------------------------------------------------------

// API: Admin/Public - Get all rooms
app.get('/api/rooms', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query('SELECT * FROM rooms');
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// API: Admin/Public - Get single room with media
app.get('/api/rooms/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
        return res.status(400).json({ error: 'Invalid room id' });
    }
    try {
        const pool = await poolPromise;
        const roomResult = await pool.request()
            .input('id', sql.Int, id)
            .query('SELECT TOP 1 * FROM rooms WHERE id = @id');

        if (roomResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Room not found' });
        }

        const room = roomResult.recordset[0];

        let media = null;
        if (room.room_type) {
            const mediaResult = await pool.request()
                .input('type', sql.NVarChar, room.room_type)
                .query('SELECT TOP 1 image_url, video_url, map_embed_url FROM property_media WHERE type = @type');
            if (mediaResult.recordset.length > 0) {
                media = mediaResult.recordset[0];
            }
        }

        res.json({ room, media });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// API: Admin - Add Room
app.post('/api/admin/rooms', async (req, res) => {
    const { room_number, capacity, monthly_rate, room_type } = req.body;
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('room_number', sql.NVarChar, room_number)
            .input('capacity', sql.Int, capacity)
            .input('monthly_rate', sql.Decimal(10, 2), monthly_rate)
            .input('room_type', sql.NVarChar, room_type)
            .query('INSERT INTO rooms (room_number, capacity, monthly_rate, room_type) VALUES (@room_number, @capacity, @monthly_rate, @room_type)');
        res.json({ message: 'Room added successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// API: Admin - Update Room
app.put('/api/admin/rooms/:id', async (req, res) => {
    const { room_number, capacity, monthly_rate, room_type } = req.body;
    const id = req.params.id;
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('id', sql.Int, id)
            .input('room_number', sql.NVarChar, room_number)
            .input('capacity', sql.Int, capacity)
            .input('monthly_rate', sql.Decimal(10, 2), monthly_rate)
            .input('room_type', sql.NVarChar, room_type)
            .query('UPDATE rooms SET room_number = @room_number, capacity = @capacity, monthly_rate = @monthly_rate, room_type = @room_type WHERE id = @id');
        res.json({ message: 'Room updated successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// API: Admin - Delete Room
app.delete('/api/admin/rooms/:id', async (req, res) => {
    const id = req.params.id;
    try {
        const pool = await poolPromise;
        // Check if room has tenants
        const check = await pool.request()
            .input('id', sql.Int, id)
            .query('SELECT COUNT(*) as count FROM tenants WHERE room_id = @id AND status = \'active\'');
        
        if (check.recordset[0].count > 0) {
            return res.status(400).json({ error: 'Cannot delete room with active tenants' });
        }

        await pool.request()
            .input('id', sql.Int, id)
            .query('DELETE FROM rooms WHERE id = @id');
        res.json({ message: 'Room deleted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/property-media', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query('SELECT type, image_url, video_url, map_embed_url FROM property_media');
        const data = {};
        result.recordset.forEach(row => {
            data[row.type] = {
                image_url: row.image_url,
                video_url: row.video_url,
                map_embed_url: row.map_embed_url
            };
        });
        res.json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/admin/property-media/:type', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'video', maxCount: 1 }]), async (req, res) => {
    const type = req.params.type;
    if (type !== 'condo' && type !== 'dorm') {
        return res.status(400).json({ error: 'Invalid type' });
    }

    const mapEmbed = req.body.mapEmbed || null;
    const imageFile = req.files && req.files.image && req.files.image[0];
    const videoFile = req.files && req.files.video && req.files.video[0];
    const imageUrl = imageFile ? '/uploads/' + imageFile.filename : null;
    const videoUrl = videoFile ? '/uploads/' + videoFile.filename : null;

    try {
        const pool = await poolPromise;
        await pool.request()
            .input('type', sql.NVarChar, type)
            .input('image_url', sql.NVarChar, imageUrl)
            .input('video_url', sql.NVarChar, videoUrl)
            .input('map_embed_url', sql.NVarChar, mapEmbed)
            .query(`
                IF EXISTS (SELECT 1 FROM property_media WHERE type = @type)
                BEGIN
                    UPDATE property_media
                    SET image_url = COALESCE(@image_url, image_url),
                        video_url = COALESCE(@video_url, video_url),
                        map_embed_url = @map_embed_url
                    WHERE type = @type
                END
                ELSE
                BEGIN
                    INSERT INTO property_media (type, image_url, video_url, map_embed_url)
                    VALUES (@type, @image_url, @video_url, @map_embed_url)
                END
            `);

        const updated = await pool.request()
            .input('type', sql.NVarChar, type)
            .query('SELECT type, image_url, video_url, map_embed_url FROM property_media WHERE type = @type');

        res.json({ message: 'Media saved successfully', media: updated.recordset[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// API: Admin - Get All Payments (with Tenant Info)
app.get('/api/admin/payments', async (req, res) => {
    try {
        const pool = await poolPromise;
        const query = `
            SELECT p.*, u.full_name, r.room_number 
            FROM payments p
            JOIN tenants t ON p.tenant_id = t.id
            JOIN users u ON t.user_id = u.id
            LEFT JOIN rooms r ON t.room_id = r.id
            ORDER BY p.created_at DESC
        `;
        const result = await pool.request().query(query);
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// API: Admin - Get All Maintenance Requests (with Tenant Info)
app.get('/api/admin/maintenance', async (req, res) => {
    try {
        const pool = await poolPromise;
        const query = `
            SELECT m.*, u.full_name, r.room_number 
            FROM maintenance_requests m
            JOIN tenants t ON m.tenant_id = t.id
            JOIN users u ON t.user_id = u.id
            LEFT JOIN rooms r ON t.room_id = r.id
            ORDER BY m.reported_at DESC
        `;
        const result = await pool.request().query(query);
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// API: Admin - Get Stats
app.get('/api/admin/stats', async (req, res) => {
    try {
        const pool = await poolPromise;
        
        // Total Revenue (Sum of approved payments)
        const revenueRes = await pool.request().query("SELECT SUM(amount) as total FROM payments WHERE status = 'approved'");
        const revenue = revenueRes.recordset[0].total || 0;

        // Pending Payments Count
        const pendingRes = await pool.request().query("SELECT COUNT(*) as count FROM payments WHERE status = 'pending'");
        const pending = pendingRes.recordset[0].count;

        // Open Issues Count
        const issuesRes = await pool.request().query("SELECT COUNT(*) as count FROM maintenance_requests WHERE status != 'resolved'");
        const issues = issuesRes.recordset[0].count;

        // Occupancy (Tenants with active status)
        const tenantsRes = await pool.request().query("SELECT COUNT(*) as count FROM tenants WHERE status = 'active'");
        const tenants = tenantsRes.recordset[0].count;

        // Total Capacity
        const capacityRes = await pool.request().query("SELECT SUM(capacity) as total FROM rooms");
        const capacity = capacityRes.recordset[0].total || 0;

        res.json({
            revenue,
            pending,
            issues,
            occupancy: `${tenants}/${capacity}`
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// API: Admin - Create Tenant Account (Enhanced)
app.post('/api/admin/create-account', async (req, res) => {
    const { full_name, email, password, phone, room_id, lease_start } = req.body;

    if (!full_name || !email || !password) {
        return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const pool = await poolPromise;
        const transaction = new sql.Transaction(pool);
        
        await transaction.begin();

        try {
            // 1. Create User
            const userResult = await transaction.request()
                .input('full_name', sql.NVarChar, full_name)
                .input('email', sql.NVarChar, email)
                .input('phone', sql.NVarChar, phone || null)
                .input('password_hash', sql.NVarChar, hashedPassword)
                .input('role', sql.NVarChar, 'tenant')
                .query(`
                    INSERT INTO users (full_name, email, phone_number, password_hash, role)
                    OUTPUT INSERTED.id
                    VALUES (@full_name, @email, @phone, @password_hash, @role)
                `);
            
            const userId = userResult.recordset[0].id;

            // 2. Create Tenant Profile with Room and Lease
            const tenantReq = transaction.request()
                .input('user_id', sql.Int, userId)
                .input('lease_start', sql.Date, lease_start || new Date());

            let tenantQuery = `INSERT INTO tenants (user_id, status, lease_start_date`;
            let tenantValues = `VALUES (@user_id, 'active', @lease_start`;

            if (room_id) {
                tenantReq.input('room_id', sql.Int, room_id);
                tenantQuery += `, room_id`;
                tenantValues += `, @room_id`;
            }

            tenantQuery += `) ${tenantValues})`;

            await tenantReq.query(tenantQuery);

            await transaction.commit();
            res.status(201).json({ message: 'Tenant added successfully' });

        } catch (err) {
            console.error('Transaction failed, rolling back:', err);
            await transaction.rollback();
            throw err;
        }

    } catch (err) {
        console.error('Error creating tenant:', err);
        if (err.number === 2627) { // Unique constraint violation
            return res.status(400).json({ error: 'Email already exists' });
        }
        res.status(500).json({ error: 'Server error: ' + err.message });
    }
});

// API: Approve Payment
app.post('/api/payments/:id/approve', async (req, res) => {
    const paymentId = req.params.id;
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('id', sql.Int, paymentId)
            .query("UPDATE payments SET status = 'approved' WHERE id = @id");
            
        // Trigger Email Logic Here (Placeholder)
        
        res.json({ message: `Payment ${paymentId} approved.` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// API: Reject Payment
app.post('/api/payments/:id/reject', async (req, res) => {
    const paymentId = req.params.id;
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('id', sql.Int, paymentId)
            .query("UPDATE payments SET status = 'rejected' WHERE id = @id");
        res.json({ message: `Payment ${paymentId} rejected.` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// API: Update Maintenance Status
app.post('/api/maintenance/:id/update', async (req, res) => {
    const { status } = req.body;
    const id = req.params.id;
    
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('id', sql.Int, id)
            .input('status', sql.NVarChar, status)
            .query('UPDATE maintenance_requests SET status = @status WHERE id = @id');
        res.json({ message: 'Status updated' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ----------------------------------------------------------------
//  PROFILE APIS (Common)
// ----------------------------------------------------------------

// API: Get Current User Profile
app.get('/api/profile/me', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not authorized' });

    const userId = req.session.user.id;
    const role = req.session.user.role;

    try {
        const pool = await poolPromise;
        let query = '';
        
        if (role === 'tenant') {
            query = `
                SELECT u.full_name, u.email, u.phone_number, u.profile_image_url, 
                       t.guardian_name, t.guardian_address, t.guardian_contact,
                       r.room_number, r.id as room_id, r.room_type, r.capacity, r.monthly_rate,
                       t.id as tenant_id
                FROM users u
                LEFT JOIN tenants t ON u.id = t.user_id
                LEFT JOIN rooms r ON t.room_id = r.id
                WHERE u.id = @userId
            `;
        } else {
            // Admin
            query = `
                SELECT full_name, email, phone_number, profile_image_url, role
                FROM users
                WHERE id = @userId
            `;
        }

        const result = await pool.request()
            .input('userId', sql.Int, userId)
            .query(query);

        if (result.recordset.length > 0) {
            res.json(result.recordset[0]);
        } else {
            res.status(404).json({ error: 'User not found' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// API: Update Profile (Self)
app.post('/api/profile/update', upload.single('profileImage'), async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not authorized' });

    const userId = req.session.user.id;
    const role = req.session.user.role;
    const { fullName, phone, guardianName, guardianAddress, guardianContact } = req.body;
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : undefined;

    try {
        const pool = await poolPromise;
        
        // 1. Update User Table (Common)
        let userQuery = `UPDATE users SET full_name = @fullName, phone_number = @phone`;
        if (imageUrl) {
            userQuery += `, profile_image_url = @imageUrl`;
        }
        userQuery += ` WHERE id = @userId`;

        const req1 = pool.request()
            .input('fullName', sql.NVarChar, fullName)
            .input('phone', sql.NVarChar, phone)
            .input('userId', sql.Int, userId);
        
        if (imageUrl) req1.input('imageUrl', sql.NVarChar, imageUrl);
        
        await req1.query(userQuery);

        // 2. Update Tenant Table (If Tenant)
        if (role === 'tenant') {
            await pool.request()
                .input('userId', sql.Int, userId)
                .input('gName', sql.NVarChar, guardianName)
                .input('gAddress', sql.NVarChar, guardianAddress)
                .input('gContact', sql.NVarChar, guardianContact)
                .query(`
                    UPDATE tenants 
                    SET guardian_name = @gName, 
                        guardian_address = @gAddress, 
                        guardian_contact = @gContact 
                    WHERE user_id = @userId
                `);
        }

        // Update session name if changed
        req.session.user.name = fullName;

        res.json({ message: 'Profile updated successfully' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// API: Admin - Get All Tenants (For Management)
app.get('/api/admin/tenants', async (req, res) => {
    try {
        const pool = await poolPromise;
        const query = `
            SELECT t.id, t.user_id, u.full_name, u.email, u.phone_number, u.profile_image_url,
                   t.guardian_name, t.guardian_address, t.guardian_contact,
                   r.room_number, r.id as room_id,
                   t.status
            FROM tenants t
            JOIN users u ON t.user_id = u.id
            LEFT JOIN rooms r ON t.room_id = r.id
            ORDER BY u.full_name ASC
        `;
        const result = await pool.request().query(query);
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// API: Admin - Update Tenant (Including Room)
app.post('/api/admin/tenants/:id/update', upload.single('profileImage'), async (req, res) => {
    const tenantId = req.params.id;
    const { fullName, phone, roomId, guardianName, guardianAddress, guardianContact } = req.body;
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : undefined;

    try {
        const pool = await poolPromise;
        
        // Get User ID from Tenant ID
        const tRes = await pool.request()
            .input('tid', sql.Int, tenantId)
            .query('SELECT user_id FROM tenants WHERE id = @tid');
            
        if (tRes.recordset.length === 0) return res.status(404).json({ error: 'Tenant not found' });
        const userId = tRes.recordset[0].user_id;

        // 1. Update User Info
        let userQuery = `UPDATE users SET full_name = @fullName, phone_number = @phone`;
        if (imageUrl) userQuery += `, profile_image_url = @imageUrl`;
        userQuery += ` WHERE id = @userId`;

        const req1 = pool.request()
            .input('fullName', sql.NVarChar, fullName)
            .input('phone', sql.NVarChar, phone)
            .input('userId', sql.Int, userId);
        if (imageUrl) req1.input('imageUrl', sql.NVarChar, imageUrl);
        await req1.query(userQuery);

        // 2. Update Tenant Info (Room & Guardian)
        const roomIdVal = (roomId && roomId !== 'null' && roomId !== '') ? parseInt(roomId) : null;

        await pool.request()
            .input('tid', sql.Int, tenantId)
            .input('roomId', sql.Int, roomIdVal)
            .input('gName', sql.NVarChar, guardianName)
            .input('gAddress', sql.NVarChar, guardianAddress)
            .input('gContact', sql.NVarChar, guardianContact)
            .query(`
                UPDATE tenants 
                SET room_id = @roomId,
                    guardian_name = @gName, 
                    guardian_address = @gAddress, 
                    guardian_contact = @gContact 
                WHERE id = @tid
            `);

        res.json({ message: 'Tenant updated successfully' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// API: Admin - End Tenant Lease (Archive)
app.post('/api/admin/tenants/:id/end-lease', async (req, res) => {
    const tenantId = req.params.id;
    try {
        const pool = await poolPromise;
        // Mark tenant as inactive/moved_out and unassign room
        await pool.request()
            .input('id', sql.Int, tenantId)
            .query(`
                UPDATE tenants 
                SET status = 'moved_out', 
                    room_id = NULL 
                WHERE id = @id
            `);
        res.json({ message: 'Tenant lease ended successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// API: Admin - Delete Tenant (Completely remove from DB)
app.delete('/api/admin/tenants/:id', async (req, res) => {
    const tenantId = req.params.id;
    try {
        const pool = await poolPromise;
        
        // 1. Get user_id first so we can delete the user record
        const tenantResult = await pool.request()
            .input('id', sql.Int, tenantId)
            .query('SELECT user_id FROM tenants WHERE id = @id');
            
        if (tenantResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Tenant not found' });
        }
        
        const userId = tenantResult.recordset[0].user_id;

        // 2. Delete the user record. 
        // Due to ON DELETE CASCADE in the database schema:
        // - Deleting the user will delete the tenant record.
        // - Deleting the tenant record will delete payments and maintenance history.
        await pool.request()
            .input('userId', sql.Int, userId)
            .query('DELETE FROM users WHERE id = @userId');

        res.json({ message: 'Tenant and all associated history removed successfully' });
    } catch (err) {
        console.error('Error deleting tenant:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// API: PayMongo GCash Payment
app.post('/api/paymongo/gcash', async (req, res) => {
    const { amount, description, name, email, phone, bill_id } = req.body;

    // IMPORTANT: Use your SECRET key here. The public key is for the frontend.
    const secretKey = process.env.PAYMONGO_SECRET_KEY;
    
    if (!secretKey || !secretKey.startsWith('sk_test_')) {
        console.error('PayMongo secret key is missing or invalid. Please check your .env file.');
        return res.status(500).json({ error: 'Payment gateway is not configured correctly.' });
    }

    const options = {
        method: 'POST',
        url: 'https://api.paymongo.com/v1/sources',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${Buffer.from(secretKey).toString('base64')}`
        },
        data: {
            data: {
                attributes: {
                    amount: amount * 100, // PayMongo expects amount in centavos
                    redirect: {
                        success: `${req.protocol}://${req.get('host')}/payment-success.html`,
                        failed: `${req.protocol}://${req.get('host')}/payment-failed.html`
                    },
                    billing: {
                        name: name,
                        email: email,
                        phone: phone
                    },
                    type: 'gcash',
                    currency: 'PHP',
                    metadata: { bill_id: bill_id }
                }
            }
        }
    };

    try {
        const response = await axios.request(options);
        const source = response.data.data;
        res.json({ checkout_url: source.attributes.redirect.checkout_url });
    } catch (error) {
        console.error('PayMongo API Error:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Failed to create GCash payment source.' });
    }
});

// PayMongo Success Redirect Handler
app.get('/payment-success', async (req, res) => {
    const sourceId = req.query.id;
    if (!sourceId) {
        return res.status(400).send('Missing payment source ID.');
    }

    try {
        // 1. Retrieve the Source from PayMongo to get metadata
        const sourceRes = await axios.get(`https://api.paymongo.com/v1/sources/${sourceId}`, {
            headers: { 'Authorization': `Basic ${Buffer.from(process.env.PAYMONGO_SECRET_KEY).toString('base64')}` }
        });

        const source = sourceRes.data.data;
        const billId = source.attributes.metadata.bill_id;

        if (!billId) {
            return res.status(400).send('Missing bill_id in payment metadata.');
        }

        // 2. Update the bill status in the database
        const pool = await poolPromise;
        await pool.request()
            .input('billId', sql.Int, billId)
            .query('UPDATE bills SET status = \'Paid\' WHERE id = @billId');

        // 3. Redirect to a user-friendly success page
        res.redirect('/payment-success.html');

    } catch (error) {
        console.error('PayMongo Success Handler Error:', error.response ? error.response.data : error.message);
        res.status(500).redirect('/payment-failed.html');
    }
});

// ----------------------------------------------------------------
//  METER READING APIS (REMOVED)
// ----------------------------------------------------------------

app.post('/api/create-checkout-session', async (req, res) => {
    const { amount, description } = req.body;

    if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Invalid amount' });
    }

    try {
        const payload = {
            data: {
                attributes: {
                    line_items: [
                        {
                            currency: 'PHP',
                            amount: Math.round(amount * 100), // Convert to centavos
                            description: description || 'Boarding House Payment',
                            name: 'Rent/Utility Payment',
                            quantity: 1
                        }
                    ],
                    payment_method_types: ['gcash', 'card', 'paymaya'], // Added more options for flexibility
                    send_email_receipt: true,
                    show_description: true,
                    show_line_items: true,
                    success_url: `http://localhost:${PORT}/tenant?payment_success=true`,
                    cancel_url: `http://localhost:${PORT}/tenant?payment_cancelled=true`
                }
            }
        };

        const response = await axios.post('https://api.paymongo.com/v1/checkout_sessions', payload, {
            headers: {
                'Authorization': `Basic ${Buffer.from(process.env.PAYMONGO_SECRET_KEY || '').toString('base64')}`,
                'Content-Type': 'application/json'
            }
        });

        res.json({ checkoutUrl: response.data.data.attributes.checkout_url });

    } catch (error) {
        console.error('PayMongo Error:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Failed to create checkout session. Check API Key.' });
    }
});

const RENT_DUE_DAY = parseInt(process.env.RENT_DUE_DAY || '10', 10);

async function sendDormRentReminders() {
    try {
        const pool = await poolPromise;
        // For testing/manual trigger, we include all active tenants with an assigned room (or all active if room doesn't matter)
        // Reverting to more inclusive query for testing
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
        const dueDate = new Date(now.getFullYear(), now.getMonth(), RENT_DUE_DAY);
        const dueDateStr = dueDate.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });

        for (const tenant of tenants) {
            const subject = `Rent reminder for Room ${tenant.room_number || ''} – due ${dueDateStr}`;
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
                        This is an automated reminder. If you have already paid, you can ignore this email.
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
    } catch (err) {
        console.error('Error running dorm rent reminders:', err);
    }
}

// API: Admin - Trigger Rent Reminders Manually
app.post('/api/admin/trigger-reminders', async (req, res) => {
    // Basic protection (optional, but good practice)
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(401).json({ error: 'Not authorized' });
    }

    try {
        await sendDormRentReminders();
        res.json({ message: 'Rent reminders sent successfully to all active dorm tenants.' });
    } catch (err) {
        console.error('Manual Reminder Trigger Error:', err);
        res.status(500).json({ error: 'Failed to send reminders' });
    }
});

function scheduleDormRentReminders() {
    if (!RENT_DUE_DAY || Number.isNaN(RENT_DUE_DAY) || RENT_DUE_DAY < 1 || RENT_DUE_DAY > 28) {
        console.warn('RENT_DUE_DAY must be between 1 and 28. Current value:', RENT_DUE_DAY);
        return;
    }

    const checkAndSend = () => {
        const today = new Date();
        const day = today.getDate();
        if (day === RENT_DUE_DAY - 5) {
            console.log('Running monthly dorm rent reminders job.');
            sendDormRentReminders();
        }
    };

    checkAndSend();

    const now = new Date();
    const firstRun = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 2, 0, 0, 0);
    let delay = firstRun.getTime() - now.getTime();
    if (delay < 0) {
        delay += 24 * 60 * 60 * 1000;
    }

    setTimeout(() => {
        checkAndSend();
        setInterval(checkAndSend, 24 * 60 * 60 * 1000);
    }, delay);
}

function startServer(port, attempt = 1) {
    const server = app.listen(port, () => {
        console.log(`Server running on http://localhost:${port}`);
        console.log(`Login: http://localhost:${port}/login`);
        console.log(`Admin Dashboard: http://localhost:${port}/admin`);
        console.log('Scheduling monthly dorm rent reminders (5 days before due date).');
        scheduleDormRentReminders();
    });

    server.on('error', (err) => {
        if (err && err.code === 'EADDRINUSE' && attempt === 1) {
            const nextPort = port + 1;
            console.error(`Port ${port} is in use. Trying ${nextPort} instead...`);
            startServer(nextPort, attempt + 1);
        } else {
            console.error('Failed to start server:', err);
        }
    });
}

startServer(PORT);
