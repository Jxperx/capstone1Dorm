const session = require('express-session');
const { poolPromise, sql } = require('./db');
const logger = require('../utils/logger');

/**
 * Custom express-session Store using mssql/msnodesqlv8
 * Persists sessions to SQL Server to prevent "Not authorized" errors on nodemon restarts.
 */
class SqlServerStore extends session.Store {
    constructor(options = {}) {
        super(options);
        this.tableName = options.tableName || 'sessions';
        this.initializeDatabase();

        // Optional: periodic cleanup of expired sessions
        if (options.clearExpired) {
            this.clearExpiredInterval = setInterval(() => {
                this.cleanupExpiredSessions();
            }, options.checkExpirationInterval || 900000); // default 15 minutes check
        }
    }

    async initializeDatabase() {
        try {
            const pool = await poolPromise;
            // Create table if it doesn't exist
            const createTableScript = `
                IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='${this.tableName}' AND xtype='U')
                BEGIN
                    CREATE TABLE ${this.tableName} (
                        sid NVARCHAR(255) PRIMARY KEY,
                        session NVARCHAR(MAX) NOT NULL,
                        expiresAt DATETIME2 NOT NULL,
                        createdAt DATETIME2 DEFAULT SYSDATETIME(),
                        updatedAt DATETIME2 DEFAULT SYSDATETIME()
                    );
                END
            `;
            await pool.request().query(createTableScript);
            logger.info(`[SessionStore] Table '${this.tableName}' is ready.`);
        } catch (error) {
            logger.error('[SessionStore] Error initializing session table:', error);
        }
    }

    async get(sid, callback) {
        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('sid', sql.NVarChar(255), sid)
                .query(`SELECT session, expiresAt FROM ${this.tableName} WHERE sid = @sid`);

            if (result.recordset.length === 0) {
                return callback(null, null); // Session not found
            }

            const record = result.recordset[0];
            const expiresAt = new Date(record.expiresAt);

            // Check if expired
            if (expiresAt < new Date()) {
                await this.destroy(sid, () => {});
                return callback(null, null);
            }

            const sessionData = JSON.parse(record.session);
            return callback(null, sessionData);
        } catch (error) {
            console.error('[SessionStore] Get Error:', error);
            callback(error);
        }
    }

    async set(sid, sessionData, callback) {
        try {
            const pool = await poolPromise;
            const expiresAt = sessionData.cookie && sessionData.cookie.expires 
                ? new Date(sessionData.cookie.expires) 
                : new Date(Date.now() + 86400000); // 1 day default

            const sessionString = JSON.stringify(sessionData);

            // UPSERT logic for SQL Server
            const query = `
                IF EXISTS (SELECT 1 FROM ${this.tableName} WHERE sid = @sid)
                BEGIN
                    UPDATE ${this.tableName} 
                    SET session = @session, expiresAt = @expiresAt, updatedAt = SYSDATETIME() 
                    WHERE sid = @sid
                END
                ELSE
                BEGIN
                    INSERT INTO ${this.tableName} (sid, session, expiresAt) 
                    VALUES (@sid, @session, @expiresAt)
                END
            `;

            await pool.request()
                .input('sid', sql.NVarChar(255), sid)
                .input('session', sql.NVarChar(sql.MAX), sessionString)
                .input('expiresAt', sql.DateTime2, expiresAt)
                .query(query);

            if (callback) callback(null);
        } catch (error) {
            console.error('[SessionStore] Set Error:', error);
            if (callback) callback(error);
        }
    }

    async destroy(sid, callback) {
        try {
            const pool = await poolPromise;
            await pool.request()
                .input('sid', sql.NVarChar(255), sid)
                .query(`DELETE FROM ${this.tableName} WHERE sid = @sid`);
            if (callback) callback(null);
        } catch (error) {
            console.error('[SessionStore] Destroy Error:', error);
            if (callback) callback(error);
        }
    }

    async touch(sid, sessionData, callback) {
        try {
            const pool = await poolPromise;
            const expiresAt = sessionData.cookie && sessionData.cookie.expires 
                ? new Date(sessionData.cookie.expires) 
                : new Date(Date.now() + 86400000);

            await pool.request()
                .input('sid', sql.NVarChar(255), sid)
                .input('expiresAt', sql.DateTime2, expiresAt)
                .query(`UPDATE ${this.tableName} SET expiresAt = @expiresAt, updatedAt = SYSDATETIME() WHERE sid = @sid`);
            
            if (callback) callback(null);
        } catch (error) {
            console.error('[SessionStore] Touch Error:', error);
            if (callback) callback(error);
        }
    }

    async cleanupExpiredSessions() {
        try {
            const pool = await poolPromise;
            await pool.request()
                .query(`DELETE FROM ${this.tableName} WHERE expiresAt < SYSDATETIME()`);
        } catch (error) {
            console.error('[SessionStore] Cleanup Error:', error);
        }
    }
}

module.exports = SqlServerStore;
