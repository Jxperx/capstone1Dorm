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

        // ── Strip MSSQL-only wrapper blocks that PostgreSQL doesn't support ──
        // Remove IF NOT EXISTS (...) BEGIN ... END blocks (table/column creation guards)
        queryStr = queryStr.replace(/IF\s+NOT\s+EXISTS\s*\([^)]*\)\s*(BEGIN\s+)?([\s\S]*?)(END\s*;?\s*)?$/gim, (match, begin, body) => {
            if (body && body.trim()) return body.trim();
            return '';
        });
        // Remove IF EXISTS (...) BEGIN ... END ELSE BEGIN ... END blocks
        queryStr = queryStr.replace(/IF\s+EXISTS\s*\([^)]*\)\s*BEGIN([\s\S]*?)END\s*ELSE\s*BEGIN([\s\S]*?)END/gim, '$1');
        // Remove simple IF EXISTS (...) BEGIN ... END
        queryStr = queryStr.replace(/IF\s+EXISTS\s*\([^)]*\)\s*BEGIN([\s\S]*?)END/gim, '$1');

        // ── MSSQL DDL to PostgreSQL DDL ──
        queryStr = queryStr.replace(/INT\s+IDENTITY\s*\(\s*\d+\s*,\s*\d+\s*\)/gi, 'SERIAL');
        queryStr = queryStr.replace(/\bNVARCHAR\s*\(\s*MAX\s*\)/gi, 'TEXT');
        queryStr = queryStr.replace(/\bNVARCHAR/gi, 'VARCHAR');
        queryStr = queryStr.replace(/\bDATETIME2?\b/gi, 'TIMESTAMPTZ');
        queryStr = queryStr.replace(/\bBIT\b/gi, 'BOOLEAN');

        // ── Convert @paramName to $1, $2, etc. (preserving multiple occurrences) ──
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

        // ── Translate MSSQL functions to PostgreSQL ──
        queryStr = queryStr
            .replace(/\bSYSDATETIME\(\)/gi, 'NOW()')
            .replace(/\bGETDATE\(\)/gi, 'NOW()')
            .replace(/\bISNULL\(/gi, 'COALESCE(');

        // ── SELECT TOP N → LIMIT N ──
        queryStr = queryStr.replace(/SELECT\s+TOP\s+(\d+)\b/gi, (match, n) => `SELECT`);
        const topMatch = sqlText.match(/SELECT\s+TOP\s+(\d+)/i);
        if (topMatch) {
            // Add LIMIT at the end if not already present
            queryStr = queryStr.replace(/;?\s*$/, ` LIMIT ${topMatch[1]}`);
        }

        // ── DATEDIFF(day, date1, date2) → EXTRACT(EPOCH FROM (date2 - date1)) / 86400 ──
        queryStr = queryStr.replace(/DATEDIFF\s*\(\s*day\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)/gi,
            (match, date1, date2) => `EXTRACT(EPOCH FROM (${date2.trim()} - ${date1.trim()})) / 86400`
        );

        // ── CAST(x AS FLOAT) → CAST(x AS DOUBLE PRECISION) ──
        queryStr = queryStr.replace(/CAST\s*\(([^)]+)\s+AS\s+FLOAT\s*\)/gi, 'CAST($1 AS DOUBLE PRECISION)');

        // ── MONTH(col) → EXTRACT(MONTH FROM col) ──
        queryStr = queryStr.replace(/\bMONTH\s*\(\s*([^)]+)\s*\)/gi, 'EXTRACT(MONTH FROM $1)');
        // ── YEAR(col) → EXTRACT(YEAR FROM col) ──
        queryStr = queryStr.replace(/\bYEAR\s*\(\s*([^)]+)\s*\)/gi, 'EXTRACT(YEAR FROM $1)');

        // ── Remove PRINT statements ──
        queryStr = queryStr.replace(/^\s*PRINT\s+'.+';?\s*$/gim, '');

        // ── Remove GO statements ──
        queryStr = queryStr.replace(/^\s*GO\s*$/gim, '');

        // ── Remove USE dbname; ──
        queryStr = queryStr.replace(/^\s*USE\s+\w+\s*;?\s*$/gim, '');

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
