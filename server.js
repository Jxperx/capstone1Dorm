const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const SqlServerStore = require('./config/sessionStore');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// DB (needed by socket.io handlers too)
const { poolPromise, sql } = require('./config/db');

// Ensure upload directory exists
if (!fs.existsSync('public/uploads')) {
    fs.mkdirSync('public/uploads', { recursive: true });
}

// App Initialization
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));

// Rate limiter for inquiry submissions: 5 per 15 min per IP
const inquiryLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { success: false, message: 'Too many submissions. Please wait 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    store: new SqlServerStore({ clearExpired: true, checkExpirationInterval: 900000 }),
    secret: process.env.SESSION_SECRET || 'change-this-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 7 * 24 * 60 * 60 * 1000,
        httpOnly: true,
        secure: false,
        sameSite: 'lax'
    }
}));


// Route Imports
const authRoutes          = require('./routes/auth');
const chatRoutes          = require('./routes/chat');
const paymentsRoutes      = require('./routes/payments');
const maintenanceRoutes   = require('./routes/maintenance');
const profileRoutes       = require('./routes/profile');
const paymongoRoutes      = require('./routes/paymongo');
const feedbackRoutes      = require('./routes/feedback');
const fraudRoutes         = require('./routes/fraud');
const fraudCheckRoutes    = require('./routes/fraud-check');
const inquiriesRoutes     = require('./routes/inquiries');
const liveChatRoutes      = require('./routes/liveChat');

// Admin Route Imports
const adminRoomsRoutes       = require('./routes/admin/rooms');
const adminTenantsRoutes     = require('./routes/admin/tenants');
const adminPaymentsRoutes    = require('./routes/admin/payments');
const adminMaintenanceRoutes = require('./routes/admin/maintenance');
const adminStatsRoutes       = require('./routes/admin/stats');
const adminFeedbackRoutes    = require('./routes/admin/feedback');
const adminInquiriesRoutes   = require('./routes/admin/inquiries');
const adminReportsRoutes     = require('./routes/admin/reports');
const adminRentPricingRoutes = require('./routes/admin/rent-pricing');
const adminLiveChatRoutes    = require('./routes/admin/liveChat');
const adminInquiryDocsRoutes = require('./routes/admin/inquiryDocs');



// Mount Routes - Public & Tenant
app.use('/api', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/paymongo', paymongoRoutes);
app.use('/api/feedback', feedbackRoutes);
app.post('/api/inquiries/submit', inquiryLimiter);
app.use('/api/inquiries', inquiriesRoutes);
app.use('/api/live-chat', liveChatRoutes);

// Mount Routes - Admin
app.use('/api/rooms', adminRoomsRoutes);
app.use('/api/admin/rooms', adminRoomsRoutes);
app.use('/api/property-media', adminRoomsRoutes);
app.use('/api/admin/property-media', adminRoomsRoutes);
app.use('/api/admin/tenants', adminTenantsRoutes);
app.use('/api/admin/payments', adminPaymentsRoutes);
app.use('/api/admin/maintenance', adminMaintenanceRoutes);
app.use('/api/admin/stats', adminStatsRoutes);
app.use('/api/admin/feedback', adminFeedbackRoutes);
app.use('/api/admin/fraud', fraudRoutes);
app.use('/api/fraud', fraudCheckRoutes);
app.use('/api/admin/inquiries', adminInquiriesRoutes);
app.use('/api/admin/reports', adminReportsRoutes);
app.use('/api/admin/rent-pricing', adminRentPricingRoutes);
app.use('/api/admin/live-chat', adminLiveChatRoutes);
app.use('/api/admin/inquiry-docs', adminInquiryDocsRoutes);



// View Routes (HTML pages)
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));

app.get('/admin', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login');
    res.sendFile(path.join(__dirname, 'public', 'admin-dashboard.html'));
});

app.get('/tenant', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    res.sendFile(path.join(__dirname, 'public', 'tenant-dashboard.html'));
});

// PayMongo Success Redirect Handler
const axios = require('axios');
app.get('/payment-success', async (req, res) => {
    const sourceId = req.query.id;
    if (!sourceId) return res.status(400).send('Missing payment source ID.');

    try {
        const sourceRes = await axios.get(`https://api.paymongo.com/v1/sources/${sourceId}`, {
            headers: { 'Authorization': `Basic ${Buffer.from(process.env.PAYMONGO_SECRET_KEY).toString('base64')}` }
        });

        const source = sourceRes.data.data;
        const billId = source.attributes.metadata.bill_id;

        if (!billId) return res.status(400).send('Missing bill_id in payment metadata.');

        const pool = await poolPromise;
        await pool.request()
            .input('billId', sql.Int, billId)
            // FIX: A GCash source redirect only means the user returned from the payment page —
            // it does NOT confirm that the charge was captured by PayMongo.
            // The payment.paid webhook (routes/paymongo.js) is the authoritative event
            // that sets status = 'approved' when funds are actually received.
            // Setting 'pending_gcash' here flags that the tenant initiated GCash payment
            // and the system is awaiting webhook confirmation.
            .query("UPDATE payments SET status = 'pending_gcash' WHERE id = @billId AND status = 'pending'");

        res.redirect('/payment-success.html');
    } catch (error) {
        console.error('PayMongo Success Handler Error:', error.response ? error.response.data : error.message);
        res.status(500).redirect('/payment-failed.html');
    }
});


// ─────────────────────────────────────────────────────────────────────────────
// Socket.io — Admin status tracker (module-level so it survives across sockets)
// ─────────────────────────────────────────────────────────────────────────────
let adminOnline = false;

function setupSocketIO(io) {
    io.on('connection', (socket) => {
        console.log('[Socket.io] Connected:', socket.id);

        // ── Tenant joins their private room ──────────────────────────────────
        socket.on('tenant:join', ({ tenantId, tenantName, roomNumber }) => {
            const sessionId = `tenant-${tenantId}`;
            socket.join(sessionId);
            socket.tenantId   = tenantId;
            socket.tenantName = tenantName;
            socket.roomNumber = roomNumber;
            socket.isAdmin    = false;
            // Tell tenant current admin status
            socket.emit('admin:status', { online: adminOnline });
            // Notify admin panel of this tenant's session
            io.to('admin-room').emit('tenant:connected', { tenantId, tenantName, roomNumber, sessionId });
        });

        // ── Admin joins admin room ────────────────────────────────────────────
        socket.on('admin:join', () => {
            socket.join('admin-room');
            socket.isAdmin = true;
            adminOnline = true;
            io.emit('admin:status', { online: true });
            console.log('[Socket.io] Admin connected');
        });

        // ── Tenant sends message ─────────────────────────────────────────────
        socket.on('tenant:message', async ({ tenantId, message, sessionId }) => {
            // Persist to DB
            try {
                const pool = await poolPromise;
                await pool.request()
                    .input('session_id', sql.NVarChar, sessionId)
                    .input('tenant_id',  sql.Int,      tenantId)
                    .input('sender',     sql.NVarChar, 'tenant')
                    .input('message',    sql.NVarChar, message)
                    .query(`INSERT INTO live_chat_messages (session_id, tenant_id, sender, message)
                            VALUES (@session_id, @tenant_id, @sender, @message)`);
            } catch (e) {
                console.error('[Socket.io] DB save (tenant msg) error:', e.message);
            }
            // Forward to admin
            io.to('admin-room').emit('admin:new-message', {
                sessionId,
                tenantId,
                tenantName: socket.tenantName,
                roomNumber: socket.roomNumber,
                message,
                timestamp: new Date().toISOString()
            });
        });

        // ── Admin sends message ──────────────────────────────────────────────
        socket.on('admin:message', async ({ tenantId, message, sessionId }) => {
            // Persist to DB
            try {
                const pool = await poolPromise;
                await pool.request()
                    .input('session_id', sql.NVarChar, sessionId)
                    .input('tenant_id',  sql.Int,      tenantId)
                    .input('sender',     sql.NVarChar, 'admin')
                    .input('message',    sql.NVarChar, message)
                    .query(`INSERT INTO live_chat_messages (session_id, tenant_id, sender, message)
                            VALUES (@session_id, @tenant_id, @sender, @message)`);
            } catch (e) {
                console.error('[Socket.io] DB save (admin msg) error:', e.message);
            }
            // Forward to tenant
            io.to(`tenant-${tenantId}`).emit('tenant:new-message', {
                message,
                timestamp: new Date().toISOString()
            });
        });

        // ── Admin toggles availability ───────────────────────────────────────
        socket.on('admin:set-status', ({ online }) => {
            adminOnline = online;
            io.emit('admin:status', { online });
            console.log(`[Socket.io] Admin status → ${online ? 'ONLINE' : 'BUSY'}`);
        });

        // ── Disconnect ───────────────────────────────────────────────────────
        socket.on('disconnect', () => {
            if (socket.isAdmin) {
                const adminRoom = io.sockets.adapter.rooms.get('admin-room');
                if (!adminRoom || adminRoom.size === 0) {
                    adminOnline = false;
                    io.emit('admin:status', { online: false });
                    console.log('[Socket.io] Admin disconnected — status OFFLINE');
                }
            }
        });
    });
}


// ─────────────────────────────────────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────────────────────────────────────
const { scheduleDormRentReminders }   = require('./utils/reminders');
const { scheduleMonthlyMarketSearch } = require('./utils/monthlyMarketCron');

function startServer(port, attempt = 1) {
    const httpServer = http.createServer(app);
    const io = new Server(httpServer, {
        cors: { origin: true, credentials: true }
    });

    setupSocketIO(io);

    httpServer.listen(port, () => {
        console.log(`Server running on http://localhost:${port}`);
        console.log(`Login: http://localhost:${port}/login`);
        console.log(`Admin Dashboard: http://localhost:${port}/admin`);
        console.log('Socket.io: Real-time Live Chat enabled.');
        console.log('Scheduling automatic monthly rent reminders (sent on the 28th).');
        scheduleDormRentReminders();
        scheduleMonthlyMarketSearch();
    });

    httpServer.on('error', (err) => {
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
