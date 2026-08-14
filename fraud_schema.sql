-- ============================================================
-- Intelligent Fraud Detection Module - Database Schema
-- boarding_house_db (MSSQL Server)
-- ============================================================

USE boarding_house_db;
GO

-- ============================================================
-- 1. Extend payments table with fraud-ready columns
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('payments') AND name = 'gateway_transaction_id')
    ALTER TABLE payments ADD gateway_transaction_id NVARCHAR(100) NULL;
GO
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('payments') AND name = 'gateway_status')
    ALTER TABLE payments ADD gateway_status NVARCHAR(50) NULL;
GO
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('payments') AND name = 'expected_amount')
    ALTER TABLE payments ADD expected_amount DECIMAL(10,2) NULL;
GO
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('payments') AND name = 'reference_number')
    ALTER TABLE payments ADD reference_number NVARCHAR(100) NULL;
GO
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('payments') AND name = 'payment_method')
    ALTER TABLE payments ADD payment_method NVARCHAR(50) NULL;
GO
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('payments') AND name = 'booking_id')
    ALTER TABLE payments ADD booking_id NVARCHAR(50) NULL;
GO

-- ============================================================
-- 2. payment_receipts
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'payment_receipts')
BEGIN
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
    );
END
GO

-- ============================================================
-- 3. payment_attempt_logs
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'payment_attempt_logs')
BEGIN
    CREATE TABLE payment_attempt_logs (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        tenant_id       INT NOT NULL,
        payment_id      INT NULL,
        device_hash     NVARCHAR(128) NULL,
        ip_address      NVARCHAR(45) NULL,
        user_agent      NVARCHAR(500) NULL,
        attempt_type    NVARCHAR(50) NULL,   -- 'upload', 'gcash', 'qrph'
        attempt_status  NVARCHAR(30) DEFAULT 'pending',
        attempted_at    DATETIME DEFAULT GETDATE(),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );
END
GO

-- ============================================================
-- 4. checkout_otp_logs
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'checkout_otp_logs')
BEGIN
    CREATE TABLE checkout_otp_logs (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        tenant_id       INT NOT NULL,
        event_type      NVARCHAR(50) NOT NULL,   -- 'checkout_request', 'otp_request', 'otp_verify'
        device_hash     NVARCHAR(128) NULL,
        ip_address      NVARCHAR(45) NULL,
        created_at      DATETIME DEFAULT GETDATE(),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );
END
GO

-- ============================================================
-- 5. fraud_flags
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'fraud_flags')
BEGIN
    CREATE TABLE fraud_flags (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        payment_id      INT NOT NULL,
        flag_code       NVARCHAR(80) NOT NULL,
        flag_description NVARCHAR(300) NULL,
        created_at      DATETIME DEFAULT GETDATE(),
        FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE
    );
END
GO

-- ============================================================
-- 6. device_fingerprints
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'device_fingerprints')
BEGIN
    CREATE TABLE device_fingerprints (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        tenant_id       INT NOT NULL,
        device_hash     NVARCHAR(128) NOT NULL,
        first_seen      DATETIME DEFAULT GETDATE(),
        last_seen       DATETIME DEFAULT GETDATE(),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );
END
GO

-- ============================================================
-- 7. fraud_scores
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'fraud_scores')
BEGIN
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
    );
END
GO
