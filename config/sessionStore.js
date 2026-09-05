require('dotenv').config();
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const logger = require('../utils/logger');

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
    logger.error('[SessionStore] SUPABASE_DB_URL is missing in environment variables!');
}

const pgPool = new Pool({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
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
