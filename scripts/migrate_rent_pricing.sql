-- ============================================================
-- Migration: AI Automated Rent Pricing System
-- ============================================================

USE boarding_house_db;
GO

-- 1. Room Pricing History
-- Tracks every time a price is changed and why
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='room_pricing_history' AND xtype='U')
BEGIN
    CREATE TABLE room_pricing_history (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        room_id         INT NOT NULL,
        old_rate        DECIMAL(10, 2) NOT NULL,
        new_rate        DECIMAL(10, 2) NOT NULL,
        reason          NVARCHAR(500)   NULL,   -- e.g., "AI Suggestion approved"
        applied_by      NVARCHAR(50)    NULL,   -- 'admin' | 'system'
        created_at      DATETIME2       NOT NULL DEFAULT SYSDATETIME(),
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
    );
    PRINT 'Table [room_pricing_history] created.';
END

-- 2. Market Benchmarks
-- Stores the scraped/fetched market data for comparison
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='market_benchmarks' AND xtype='U')
BEGIN
    CREATE TABLE market_benchmarks (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        area            NVARCHAR(100)   NOT NULL, -- 'Calamba, Laguna' | 'Sta. Rosa, Nuvali'
        unit_type       NVARCHAR(50)    NOT NULL, -- 'dorm' | 'condo'
        avg_market_rate DECIMAL(10, 2) NOT NULL,
        source_url      NVARCHAR(500)   NULL,
        fetched_at      DATETIME2       NOT NULL DEFAULT SYSDATETIME()
    );
    PRINT 'Table [market_benchmarks] created.';
END

-- 3. Initial Market Pulse Data (Calamba & Nuvali)
INSERT INTO market_benchmarks (area, unit_type, avg_market_rate, source_url)
VALUES 
('Calamba, Laguna', 'dorm', 5000.00, 'Market Research - May 2026'),
('Sta. Rosa, Nuvali', 'condo', 21000.00, 'Market Research - May 2026');

PRINT 'Migration complete.';
