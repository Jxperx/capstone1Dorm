require('dotenv').config();
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const logger = require('../utils/logger');

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
    logger.error('[SessionStore] SUPABASE_DB_URL is missing in environment variables!');
}

const dns = require('dns');
const cachedSupabaseIps = ['52.68.3.1', '35.79.125.133', '54.64.190.72'];

function resilientLookup(hostname, options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }
    if (hostname && hostname.includes('supabase')) {
        const ip = cachedSupabaseIps[Math.floor(Math.random() * cachedSupabaseIps.length)];
        return callback(null, ip, 4);
    }
    dns.lookup(hostname, options, callback);
}

const pgPool = new Pool({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    lookup: resilientLookup
});

pgPool.on('error', (err) => {
    logger.error('[SessionStore] Pool error:', err.message);
});

const store = new pgSession({
    pool: pgPool,
    tableName: 'session',
    createTableIfMissing: true
});

logger.info('[SessionStore] PostgreSQL Session Store connected to Supabase successfully.');

module.exports = store;
