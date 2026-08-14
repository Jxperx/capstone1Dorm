-- ============================================================
-- AI Sentiment Analysis Migration
-- Run this once against boarding_house_db to create tables
-- for tenant feedback and recurring issue alerts.
-- ============================================================

USE boarding_house_db;

-- 1. Create tenant_feedback table
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='tenant_feedback' and xtype='U')
BEGIN
    CREATE TABLE tenant_feedback (
        id INT IDENTITY(1,1) PRIMARY KEY,
        tenant_id INT NOT NULL FOREIGN KEY REFERENCES tenants(id),
        survey_id INT NULL,
        feedback_text NVARCHAR(MAX) NOT NULL,
        
        -- AI Generated Columns
        ai_sentiment NVARCHAR(20) DEFAULT 'Neutral',
        ai_sentiment_score DECIMAL(4,2) DEFAULT 0.00,
        ai_topics NVARCHAR(MAX) NULL,     -- Stored as JSON string
        ai_keywords NVARCHAR(MAX) NULL,   -- Stored as JSON string
        ai_summary NVARCHAR(MAX) NULL,
        ai_needs_attention BIT DEFAULT 0,
        ai_confidence DECIMAL(5,2) DEFAULT 0.00,
        
        created_at DATETIME DEFAULT GETDATE()
    );
END

-- 2. Create feedback_alerts table
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='feedback_alerts' and xtype='U')
BEGIN
    CREATE TABLE feedback_alerts (
        id INT IDENTITY(1,1) PRIMARY KEY,
        issue_topic NVARCHAR(100) NOT NULL,
        negative_count INT DEFAULT 0,
        avg_sentiment_score DECIMAL(4,2) DEFAULT 0.00,
        period_type NVARCHAR(20) NOT NULL,    -- '7_days' or '30_days'
        alert_severity NVARCHAR(20) NOT NULL, -- 'Low', 'Medium', 'High'
        recommended_action NVARCHAR(MAX) NULL,
        is_resolved BIT DEFAULT 0,
        created_at DATETIME DEFAULT GETDATE()
    );
END
