require('dotenv').config();
const { Pool } = require('pg');
const logger = require('../utils/logger');

const connectionString = process.env.SUPABASE_DB_URL;

if (!connectionString) {
    logger.error('[DB] SUPABASE_DB_URL is missing in environment configuration!');
}

const pgPool = new Pool({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false },
    max: 15,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
});

pgPool.on('error', (err) => {
    logger.error('[DB] Postgres Pool error:', err.message);
});

class PostgresRequest {
    constructor(pool) {
        this.pool = pool;
        this.params = {};
    }

    input(name, type, value) {
        if (value === undefined) {
            value = type;
        }
        this.params[name] = value;
        return this;
    }

    async query(sqlText) {
        let queryStr = sqlText;
        const values = [];
        const paramMap = new Map();

        // Convert @paramName to $1, $2, etc. (preserving multiple occurrences)
        queryStr = queryStr.replace(/@([a-zA-Z0-9_]+)/g, (match, paramName) => {
            if (Object.prototype.hasOwnProperty.call(this.params, paramName)) {
                if (!paramMap.has(paramName)) {
                    values.push(this.params[paramName]);
                    paramMap.set(paramName, values.length);
                }
                return `$${paramMap.get(paramName)}`;
            }
            return match;
        });

        // Translate MSSQL function dialects to PostgreSQL
        queryStr = queryStr
            .replace(/\bSYSDATETIME\(\)/gi, 'NOW()')
            .replace(/\bGETDATE\(\)/gi, 'NOW()')
            .replace(/\bISNULL\(/gi, 'COALESCE(');

        try {
            const res = await this.pool.query(queryStr, values);
            const recordset = res.rows || [];
            return {
                recordset: recordset,
                recordsets: [recordset],
                rowsAffected: [res.rowCount || 0],
                output: {}
            };
        } catch (err) {
            logger.error(`[DB] Query Error: ${err.message} | Query: ${queryStr}`);
            throw err;
        }
    }
}

class PostgresPoolWrapper {
    constructor(pool) {
        this.pool = pool;
    }

    request() {
        return new PostgresRequest(this.pool);
    }

    async query(sqlText, params) {
        const req = this.request();
        if (params && typeof params === 'object') {
            for (const [k, v] of Object.entries(params)) {
                req.input(k, v);
            }
        }
        return req.query(sqlText);
    }
}

const poolWrapper = new PostgresPoolWrapper(pgPool);

// Dummy MSSQL type proxy for backwards compatibility (e.g. sql.NVarChar, sql.Int)
const dummySql = new Proxy({}, {
    get: (target, prop) => {
        const fn = (val) => val;
        fn.type = prop;
        return fn;
    }
});

logger.info(`[DB] PostgreSQL adapter initialized for host '${process.env.DB_SERVER}', database '${process.env.DB_DATABASE}'.`);

module.exports = {
    sql: dummySql,
    get poolPromise() {
        return Promise.resolve(poolWrapper);
    },
    getPool: () => Promise.resolve(poolWrapper),
    config: {
        server: process.env.DB_SERVER,
        database: process.env.DB_DATABASE
    }
};
