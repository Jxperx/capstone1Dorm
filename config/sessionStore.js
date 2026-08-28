const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const logger = require('../utils/logger');

const pgPool = new Pool({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false }
});

const store = new pgSession({
    pool: pgPool,
    tableName: 'session',
    createTableIfMissing: true
});

logger.info('[SessionStore] PostgreSQL Session Store initialized successfully.');

module.exports = store;
