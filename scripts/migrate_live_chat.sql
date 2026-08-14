-- ============================================================
-- Migration: Live Chat Messaging System
-- Run once against boarding_house_db
-- ============================================================

IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='live_chat_messages' AND xtype='U')
BEGIN
    CREATE TABLE live_chat_messages (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        session_id  NVARCHAR(100)   NOT NULL,           -- 'tenant-{userId}'
        tenant_id   INT             NULL,               -- FK to users.id
        sender      NVARCHAR(10)    NOT NULL,           -- 'tenant' | 'admin'
        message     NVARCHAR(MAX)   NOT NULL,
        is_read     BIT             NOT NULL DEFAULT 0,
        created_at  DATETIME2       NOT NULL DEFAULT SYSDATETIME()
    );
    PRINT 'Table [live_chat_messages] created.';
END
ELSE
    PRINT 'Table [live_chat_messages] already exists — skipped.';

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='IX_lcm_session_id' AND object_id = OBJECT_ID('live_chat_messages'))
    CREATE INDEX IX_lcm_session_id ON live_chat_messages(session_id);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='IX_lcm_created_at' AND object_id = OBJECT_ID('live_chat_messages'))
    CREATE INDEX IX_lcm_created_at ON live_chat_messages(created_at DESC);

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name='IX_lcm_tenant_id' AND object_id = OBJECT_ID('live_chat_messages'))
    CREATE INDEX IX_lcm_tenant_id ON live_chat_messages(tenant_id);

PRINT 'Live Chat migration complete.';
