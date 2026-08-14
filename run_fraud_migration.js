/**
 * run_fraud_migration.js
 * Executes the fraud detection schema migration against the MSSQL database.
 * Run once with: node run_fraud_migration.js
 */

const { poolPromise, sql } = require('./config/db');
require('dotenv').config();

async function runMigration() {
    console.log('🔒 Starting Fraud Detection Schema Migration...\n');
    
    const pool = await poolPromise;
    
    const steps = [
        {
            name: 'Add gateway_transaction_id to payments',
            sql: `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('payments') AND name = 'gateway_transaction_id')
                  ALTER TABLE payments ADD gateway_transaction_id NVARCHAR(100) NULL`
        },
        {
            name: 'Add gateway_status to payments',
            sql: `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('payments') AND name = 'gateway_status')
                  ALTER TABLE payments ADD gateway_status NVARCHAR(50) NULL`
        },
        {
            name: 'Add expected_amount to payments',
            sql: `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('payments') AND name = 'expected_amount')
                  ALTER TABLE payments ADD expected_amount DECIMAL(10,2) NULL`
        },
        {
            name: 'Add reference_number to payments',
            sql: `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('payments') AND name = 'reference_number')
                  ALTER TABLE payments ADD reference_number NVARCHAR(100) NULL`
        },
        {
            name: 'Add payment_method to payments',
            sql: `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('payments') AND name = 'payment_method')
                  ALTER TABLE payments ADD payment_method NVARCHAR(50) NULL`
        },
        {
            name: 'Add booking_id to payments',
            sql: `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('payments') AND name = 'booking_id')
                  ALTER TABLE payments ADD booking_id NVARCHAR(50) NULL`
        },
        {
            name: 'Create payment_receipts table',
            sql: `IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'payment_receipts')
                  CREATE TABLE payment_receipts (
                      id              INT IDENTITY(1,1) PRIMARY KEY,
                      payment_id      INT NOT NULL,
                      file_path       NVARCHAR(500) NOT NULL,
                      sha256_hash     NVARCHAR(64) NULL,
                      phash_value     NVARCHAR(64) NULL,
                      ocr_raw_text    NVARCHAR(MAX) NULL,
                      ocr_ref_number  NVARCHAR(100) NULL,
                      ocr_amount      DECIMAL(10,2) NULL,
                      ocr_timestamp   NVARCHAR(100) NULL,
                      ocr_payer       NVARCHAR(200) NULL,
                      uploaded_at     DATETIME DEFAULT GETDATE(),
                      FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE
                  )`
        },
        {
            name: 'Create payment_attempt_logs table',
            sql: `IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'payment_attempt_logs')
                  CREATE TABLE payment_attempt_logs (
                      id              INT IDENTITY(1,1) PRIMARY KEY,
                      tenant_id       INT NOT NULL,
                      payment_id      INT NULL,
                      device_hash     NVARCHAR(128) NULL,
                      ip_address      NVARCHAR(45) NULL,
                      user_agent      NVARCHAR(500) NULL,
                      attempt_type    NVARCHAR(50) NULL,
                      attempt_status  NVARCHAR(30) DEFAULT 'pending',
                      attempted_at    DATETIME DEFAULT GETDATE(),
                      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
                  )`
        },
        {
            name: 'Create checkout_otp_logs table',
            sql: `IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'checkout_otp_logs')
                  CREATE TABLE checkout_otp_logs (
                      id              INT IDENTITY(1,1) PRIMARY KEY,
                      tenant_id       INT NOT NULL,
                      event_type      NVARCHAR(50) NOT NULL,
                      device_hash     NVARCHAR(128) NULL,
                      ip_address      NVARCHAR(45) NULL,
                      created_at      DATETIME DEFAULT GETDATE(),
                      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
                  )`
        },
        {
            name: 'Create fraud_flags table',
            sql: `IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'fraud_flags')
                  CREATE TABLE fraud_flags (
                      id              INT IDENTITY(1,1) PRIMARY KEY,
                      payment_id      INT NOT NULL,
                      flag_code       NVARCHAR(80) NOT NULL,
                      flag_description NVARCHAR(300) NULL,
                      created_at      DATETIME DEFAULT GETDATE(),
                      FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE
                  )`
        },
        {
            name: 'Create device_fingerprints table',
            sql: `IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'device_fingerprints')
                  CREATE TABLE device_fingerprints (
                      id              INT IDENTITY(1,1) PRIMARY KEY,
                      tenant_id       INT NOT NULL,
                      device_hash     NVARCHAR(128) NOT NULL,
                      first_seen      DATETIME DEFAULT GETDATE(),
                      last_seen       DATETIME DEFAULT GETDATE(),
                      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
                  )`
        },
        {
            name: 'Create fraud_scores table',
            sql: `IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'fraud_scores')
                  CREATE TABLE fraud_scores (
                      id              INT IDENTITY(1,1) PRIMARY KEY,
                      payment_id      INT NOT NULL UNIQUE,
                      risk_score      INT NOT NULL DEFAULT 0 CHECK (risk_score >= 0 AND risk_score <= 100),
                      risk_level      NVARCHAR(20) NOT NULL DEFAULT 'SAFE'
                                      CHECK (risk_level IN ('SAFE','LOW','MEDIUM','HIGH','CRITICAL')),
                      decision        NVARCHAR(30) NOT NULL DEFAULT 'PENDING_REVIEW'
                                      CHECK (decision IN ('AUTO_APPROVED','PENDING_REVIEW','BLOCKED','MANUAL_APPROVED','MANUAL_BLOCKED')),
                      analyzed_at     DATETIME DEFAULT GETDATE(),
                      reviewed_by     NVARCHAR(100) NULL,
                      admin_note      NVARCHAR(500) NULL,
                      FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE
                  )`
        }
    ];

    let success = 0;
    let errors = 0;

    for (const step of steps) {
        try {
            await pool.request().query(step.sql);
            console.log(`  ✅ ${step.name}`);
            success++;
        } catch (err) {
            console.error(`  ❌ ${step.name}: ${err.message}`);
            errors++;
        }
    }

    console.log(`\n📊 Migration complete: ${success} successes, ${errors} errors.`);
    
    if (errors === 0) {
        console.log('✅ All fraud detection tables created successfully!');
        console.log('🚀 You can now use the Fraud Detection module in the admin dashboard.');
    } else {
        console.log('⚠️  Some migrations failed. Check the errors above.');
    }

    process.exit(errors > 0 ? 1 : 0);
}

runMigration().catch(err => {
    console.error('Fatal migration error:', err);
    process.exit(1);
});
