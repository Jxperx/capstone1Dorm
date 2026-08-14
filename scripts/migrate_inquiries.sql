-- ============================================================
-- Migration: Inquiry Submission System
-- Run once against boarding_house_db
-- ============================================================

-- 1. Inquiries table
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='inquiries' AND xtype='U')
BEGIN
    CREATE TABLE inquiries (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        first_name      NVARCHAR(100)   NOT NULL,
        last_name       NVARCHAR(100)   NOT NULL,
        email           NVARCHAR(255)   NOT NULL,
        phone           NVARCHAR(30)    NOT NULL,
        preferred_unit  NVARCHAR(50)    NULL,
        message         NVARCHAR(MAX)   NULL,
        message_hash    NVARCHAR(64)    NULL,       -- SHA-256 of message
        user_hash       NVARCHAR(64)    NULL,       -- SHA-256 of email+phone
        device_id       NVARCHAR(255)   NULL,       -- FingerprintJS visitorId
        ip_address      NVARCHAR(45)    NULL,
        user_agent      NVARCHAR(500)   NULL,
        status          NVARCHAR(20)    NOT NULL DEFAULT 'approved',  -- approved | flagged | duplicate | suspicious
        ai_result       NVARCHAR(10)    NULL,       -- REAL | SPAM
        ai_confidence   INT             NULL,       -- 0-100
        ai_reasoning    NVARCHAR(500)   NULL,
        admin_note      NVARCHAR(500)   NULL,
        created_at      DATETIME2       NOT NULL DEFAULT SYSDATETIME()
    );
    PRINT 'Table [inquiries] created.';
END
ELSE
    PRINT 'Table [inquiries] already exists — skipped.';

-- 2. Blocked IPs table
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='inquiry_blocked_ips' AND xtype='U')
BEGIN
    CREATE TABLE inquiry_blocked_ips (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        ip_address  NVARCHAR(45)    NOT NULL UNIQUE,
        reason      NVARCHAR(255)   NULL,
        blocked_at  DATETIME2       NOT NULL DEFAULT SYSDATETIME(),
        blocked_by  NVARCHAR(50)    NOT NULL DEFAULT 'system'  -- 'system' | 'admin'
    );
    PRINT 'Table [inquiry_blocked_ips] created.';
END
ELSE
    PRINT 'Table [inquiry_blocked_ips] already exists — skipped.';

-- 3. Indexes for performance
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='IX_inquiries_email' AND object_id = OBJECT_ID('inquiries'))
    CREATE INDEX IX_inquiries_email       ON inquiries(email);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='IX_inquiries_message_hash' AND object_id = OBJECT_ID('inquiries'))
    CREATE INDEX IX_inquiries_message_hash ON inquiries(message_hash);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='IX_inquiries_user_hash' AND object_id = OBJECT_ID('inquiries'))
    CREATE INDEX IX_inquiries_user_hash   ON inquiries(user_hash);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='IX_inquiries_device_id' AND object_id = OBJECT_ID('inquiries'))
    CREATE INDEX IX_inquiries_device_id   ON inquiries(device_id);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='IX_inquiries_ip_address' AND object_id = OBJECT_ID('inquiries'))
    CREATE INDEX IX_inquiries_ip_address  ON inquiries(ip_address);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='IX_inquiries_status' AND object_id = OBJECT_ID('inquiries'))
    CREATE INDEX IX_inquiries_status      ON inquiries(status);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='IX_inquiries_created_at' AND object_id = OBJECT_ID('inquiries'))
    CREATE INDEX IX_inquiries_created_at  ON inquiries(created_at DESC);

PRINT 'Migration complete.';
