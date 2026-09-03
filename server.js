const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const sessionStore = require('./config/sessionStore');
const bodyParser = require('body-parser');
const path = require('path');
const session = require('express-session');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
const logger = require('./utils/logger');

// DB (needed by socket.io handlers too)
const { poolPromise, sql } = require('./config/db');

// Note: Uploads are now stored on Cloudinary — no local upload directory needed.

// App Initialization
const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// FIX 2 — CORS allowlist (env-configurable)
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : ['http://localhost:3000', 'http://localhost:3001'];

// Trust first reverse proxy (Nginx, Cloudflare, AWS ALB) in production
// so req.ip returns the real client IP and req.protocol reports 'https'
if (isProduction) {
    app.set('trust proxy', 1);
}

// SESSION_SECRET validation
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    console.warn('[Security Warning] SESSION_SECRET is missing or too short (minimum 32 characters).');
    console.warn('[Security Warning] Generate one with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
    if (isProduction) {
        console.error('[Security Error] Refusing to start in production without a strong SESSION_SECRET.');
        process.exit(1);
    }
}

// FIX 3 — Helmet with full CSP
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc:    ["'self'"],
            scriptSrc:     ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com', 'https://fonts.googleapis.com', 'https://fpnpmcdn.net', 'https://challenges.cloudflare.com'],
            scriptSrcAttr: ["'unsafe-inline'"],   // FIX: allow onclick="..." event handler attributes
            styleSrc:      ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com', 'https://fonts.googleapis.com'],
            fontSrc:       ["'self'", 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
            imgSrc:        ["'self'", 'data:', 'https:', 'blob:'],
            mediaSrc:      ["'self'", 'data:', 'blob:'],
            connectSrc:    ["'self'", 'wss:', 'ws:', 'https://api.paymongo.com'],
            frameSrc:      ["'self'", 'https://www.google.com', 'https://challenges.cloudflare.com'],
            workerSrc:     ["'self'", 'blob:'],   // FIX: allow Marzipano WebGL 360 texture workers
            childSrc:      ["'self'", 'blob:'],
            objectSrc:     ["'none'"],
        }
    },
    crossOriginEmbedderPolicy: false,
    hsts: isProduction ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false
}));

// FIX 2 — Strict CORS with origin allowlist
app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
        logger.warn('[CORS] Blocked origin:', origin);
        callback(new Error('Not allowed by CORS policy'));
    },
    credentials: true
}));

// Rate limiter for inquiry submissions: 5 per 15 min per IP
const inquiryLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { success: false, message: 'Too many submissions. Please wait 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false
});

// FIX 4 — Rate limiters for visits and applications
const visitLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { success: false, message: 'Too many visit scheduling attempts. Please try again later.' },
    standardHeaders: true, legacyHeaders: false
});

const applicationLimiter = rateLimit({
    windowMs: 24 * 60 * 60 * 1000,
    max: 3,
    message: { success: false, message: 'Too many rental applications submitted. Please try again tomorrow.' },
    standardHeaders: true, legacyHeaders: false
});

app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));
app.use(express.urlencoded({ extended: true }));

// Serve uploaded images (e.g. payment receipts, room photos)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'change-this-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 7 * 24 * 60 * 60 * 1000,
        httpOnly: true,
        secure: isProduction,
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
const visitsRoutes        = require('./routes/visits');
const applicationsRoutes  = require('./routes/applications');

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
const adminVisitsRoutes      = require('./routes/admin/visits');
const adminApplicationsRoutes = require('./routes/admin/applications');
const adminMeterReadingsRoutes = require('./routes/admin/meter-readings');



// Mount Routes - Public & Tenant
app.use('/api', authRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/paymongo', paymongoRoutes);
app.use('/api/feedback', feedbackRoutes);
app.post('/api/inquiries/submit', inquiryLimiter);
app.use('/api/inquiries', inquiriesRoutes);
app.use('/api/live-chat', liveChatRoutes);
// FIX 4 — Apply rate limiters before the route handler
app.post('/api/visits/schedule', visitLimiter);
app.use('/api/visits', visitsRoutes);
app.post('/api/applications/submit', applicationLimiter);
app.use('/api/applications', applicationsRoutes);

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
app.use('/api/admin/visits', adminVisitsRoutes);
app.use('/api/admin/applications', adminApplicationsRoutes);
app.use('/api/admin/meter-readings', adminMeterReadingsRoutes);



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

// Health check — used by keep-alive pings, uptime monitors, and load balancers
// Also warms up the database connection to prevent Azure SQL auto-pause
app.get('/health', async (req, res) => {
    let dbStatus = 'unknown';
    try {
        const pool = await poolPromise;
        await pool.request().query('SELECT 1');
        dbStatus = 'connected';
    } catch (err) {
        dbStatus = 'reconnecting';
        logger.warn('[Health] DB ping failed (will auto-reconnect):', err.message);
    }
    res.status(200).json({
        status: 'ok',
        db: dbStatus,
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        env: process.env.NODE_ENV || 'development'
    });
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
// Global Error Handler — catches unhandled errors from all routes
// Returns a safe JSON response without leaking internal details
// ─────────────────────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
    // Log the full error server-side for debugging
    logger.error(`[Global Error Handler] ${req.method} ${req.originalUrl}:`, err.message);
    if (!isProduction) logger.error(err.stack);

    // Send a safe response — never expose err.message in production
    const statusCode = err.status || err.statusCode || 500;
    res.status(statusCode).json({
        error: isProduction
            ? 'An internal server error occurred. Please try again later.'
            : err.message
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Socket.io — Admin status tracker (module-level so it survives across sockets)
// ─────────────────────────────────────────────────────────────────────────────
let adminOnline = false;

function setupSocketIO(io) {
    io.on('connection', (socket) => {
        logger.debug('[Socket.io] Connected:', socket.id);

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
        // FIX 1 — Verify session role before granting admin-room access
        socket.on('admin:join', () => {
            const sessionUser = socket.request?.session?.user;
            if (!sessionUser || sessionUser.role !== 'admin') {
                logger.warn('[Socket.io] Rejected admin:join — not authenticated as admin. Socket:', socket.id);
                socket.emit('admin:join:rejected', { error: 'Unauthorized' });
                return;
            }
            socket.join('admin-room');
            socket.isAdmin = true;
            adminOnline = true;
            io.emit('admin:status', { online: true });
            logger.debug('[Socket.io] Admin connected:', sessionUser.name);
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
            logger.debug(`[Socket.io] Admin status → ${online ? 'ONLINE' : 'BUSY'}`);
        });

        // ── Disconnect ───────────────────────────────────────────────────────
        socket.on('disconnect', () => {
            if (socket.isAdmin) {
                const adminRoom = io.sockets.adapter.rooms.get('admin-room');
                if (!adminRoom || adminRoom.size === 0) {
                    adminOnline = false;
                    io.emit('admin:status', { online: false });
                    logger.debug('[Socket.io] Admin disconnected — status OFFLINE');
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
    // FIX 2 — Lock down Socket.io CORS to ALLOWED_ORIGINS
    const io = new Server(httpServer, {
        cors: { origin: ALLOWED_ORIGINS, credentials: true }
    });

    // FIX 1 — Share Express session with Socket.io so we can authenticate socket connections
    const sessionMiddlewareForSocket = session({
        store: sessionStore,
        secret: process.env.SESSION_SECRET || 'change-this-session-secret',
        resave: false,
        saveUninitialized: false,
        cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true, secure: isProduction, sameSite: isProduction ? 'strict' : 'lax' }
    });
    io.use((socket, next) => sessionMiddlewareForSocket(socket.request, socket.request.res || {}, next));

    setupSocketIO(io);

    httpServer.listen(port, () => {
        logger.info(`Server running on http://localhost:${port}`);
        logger.info(`Login: http://localhost:${port}/login`);
        logger.info(`Admin Dashboard: http://localhost:${port}/admin`);
        logger.info('Socket.io: Real-time Live Chat enabled.');
        logger.info('Scheduling automatic monthly rent reminders (sent on the 28th).');
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

// ─────────────────────────────────────────────────────────────────────────────
// Global Error Safety Nets (last-resort crash handlers for production)
// ─────────────────────────────────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
    logger.error('[FATAL] Uncaught Exception:', err.message);
    logger.error(err.stack);
    // Let PM2 detect the exit and auto-restart
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('[FATAL] Unhandled Promise Rejection:', reason);
    // Let PM2 detect the exit and auto-restart
    process.exit(1);
});
