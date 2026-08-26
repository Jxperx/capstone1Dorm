require('dotenv').config();
const logger = require('../utils/logger');

// ── Driver & Config Setup ────────────────────────────────────────────────────
const dbUser = process.env.DB_USER && process.env.DB_USER.trim();
const dbPass = process.env.DB_PASSWORD || process.env.DB_PASS;

let sql;
let config;

if (dbUser) {
    // SQL Server Authentication (Cross-platform pure JS tedious driver)
    sql = require('mssql');
    config = {
        server: process.env.DB_SERVER,
        database: process.env.DB_DATABASE,
        user: dbUser,
        password: dbPass,
        port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 1433,
        options: {
            encrypt: process.env.DB_ENCRYPT === 'true',
            trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== 'false',
            enableArithAbort: true
        },
        // ── Cold-start resilience for Azure SQL Serverless ──
        connectionTimeout: 120000,   // 120s — Azure SQL can take 60s+ to resume from auto-pause
        requestTimeout: 30000,       // 30s per query
        pool: {
            max: 10,
            min: 0,
            idleTimeoutMillis: 60000  // Close idle connections after 60s
        }
    };
    logger.info(`[DB] Initializing SQL Server Authentication for host '${process.env.DB_SERVER}', database '${process.env.DB_DATABASE}'.`);
} else {
    // Windows Authentication Fallback (Local Windows Dev Environment)
    sql = require('mssql/msnodesqlv8');
    const driver = process.env.DB_ODBC_DRIVER || 'ODBC Driver 17 for SQL Server';
    config = {
        connectionString: `Driver={${driver}};Server=${process.env.DB_SERVER};Database=${process.env.DB_DATABASE};Trusted_Connection=yes;`,
        options: {
            trustedConnection: true,
            enableArithAbort: true
        }
    };
    logger.info(`[DB] Initializing Windows Authentication (msnodesqlv8) for server '${process.env.DB_SERVER}'.`);
}

// ── Self-Healing Connection Pool ─────────────────────────────────────────────
// Instead of connecting once and permanently caching success/failure,
// getPool() returns a live pool or reconnects automatically on every call.
// This prevents the "permanent death" problem on cold starts.

let _pool = null;
let _connecting = null;   // Deduplicates concurrent connect attempts

async function getPool() {
    // Fast path: pool exists and is connected
    if (_pool && _pool.connected) {
        return _pool;
    }

    // If another caller is already connecting, wait for that attempt
    if (_connecting) {
        return _connecting;
    }

    // Connect with retry logic
    _connecting = (async () => {
        const MAX_RETRIES = 3;
        const BASE_DELAY = 2000; // 2 seconds

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                // Close the old broken pool if it exists
                if (_pool) {
                    try { await _pool.close(); } catch (_) { /* ignore */ }
                    _pool = null;
                }

                logger.info(`[DB] Connection attempt ${attempt}/${MAX_RETRIES}...`);
                _pool = await new sql.ConnectionPool(config).connect();
                logger.info('[DB] Connected to MSSQL Server successfully!');

                // Listen for unexpected close events so we can reconnect next call
                _pool.on('error', (err) => {
                    logger.error('[DB] Pool error (will reconnect on next request):', err.message);
                    _pool = null;
                });

                return _pool;
            } catch (err) {
                logger.error(`[DB] Connection attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);

                if (attempt < MAX_RETRIES) {
                    const delay = BASE_DELAY * Math.pow(2, attempt - 1); // 2s, 4s, 8s
                    logger.info(`[DB] Retrying in ${delay / 1000}s...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    logger.error('[DB] All connection attempts failed. Will retry on next request.');
                    throw err;
                }
            }
        }
    })().finally(() => {
        _connecting = null;  // Release the lock so future calls can retry
    });

    return _connecting;
}

// ── Backward-Compatible Export ────────────────────────────────────────────────
// All existing route files use `const pool = await poolPromise;`
// By making poolPromise a getter, every access calls getPool() fresh,
// so a failed boot never permanently poisons the app.

module.exports = {
    sql,
    get poolPromise() {
        return getPool();
    },
    config,
    getPool   // Also export directly for explicit usage
};
