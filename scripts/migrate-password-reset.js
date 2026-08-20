/**
 * scripts/migrate-password-reset.js
 * Creates the password_reset_tokens table used by the Forgot Password flow.
 * Safe to run multiple times (idempotent).
 */
const { poolPromise } = require('../config/db');

async function migrate() {
    try {
        const pool = await poolPromise;

        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'password_reset_tokens')
            BEGIN
                CREATE TABLE password_reset_tokens (
                    id         INT IDENTITY(1,1) PRIMARY KEY,
                    user_id    INT NOT NULL,
                    otp_code   NVARCHAR(6) NOT NULL,
                    expires_at DATETIME NOT NULL,
                    used       BIT DEFAULT 0,
                    created_at DATETIME DEFAULT GETDATE(),
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                );
                PRINT 'Table password_reset_tokens created.';
            END
            ELSE
            BEGIN
                PRINT 'Table password_reset_tokens already exists. Skipping.';
            END
        `);

        console.log('Migration complete: password_reset_tokens is ready.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err.message);
        process.exit(1);
    }
}

migrate();
