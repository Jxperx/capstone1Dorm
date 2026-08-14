-- ═══════════════════════════════════════════════════════════════════════
--  EliteStay MIS — Report Engine: generated_reports table migration
--  Run this once against your MSSQL database to enable report persistence.
-- ═══════════════════════════════════════════════════════════════════════

IF NOT EXISTS (
    SELECT * FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME = 'generated_reports'
)
BEGIN
    CREATE TABLE generated_reports (
        id                INT IDENTITY(1,1) PRIMARY KEY,
        report_type       NVARCHAR(50)    NOT NULL,         -- 'maintenance' | 'financial' | 'complaints' | 'booking' | 'incident'
        report_title      NVARCHAR(255)   NOT NULL,
        generated_at      DATETIME        NOT NULL DEFAULT GETDATE(),
        generated_by      INT             NULL,              -- FK to users.id (admin who triggered it)
        date_from         DATE            NULL,              -- optional filter range start
        date_to           DATE            NULL,              -- optional filter range end
        priority_level    NVARCHAR(20)    NULL,              -- 'Critical' | 'High' | 'Medium' | 'Low'
        risk_level        NVARCHAR(20)    NULL,              -- 'High' | 'Medium' | 'Low'
        confidence_score  INT             NULL,              -- 0-100
        executive_summary NVARCHAR(MAX)   NULL,              -- AI or rule-based summary text
        report_data       NVARCHAR(MAX)   NOT NULL,          -- Full JSON report payload
        tags              NVARCHAR(500)   NULL,              -- Comma-separated auto-tags
        CONSTRAINT FK_reports_users FOREIGN KEY (generated_by) REFERENCES users(id) ON DELETE SET NULL
    );

    -- Index for quick lookups by type and date
    CREATE INDEX IX_generated_reports_type_date
        ON generated_reports(report_type, generated_at DESC);

    PRINT 'Table generated_reports created successfully.';
END
ELSE
BEGIN
    PRINT 'Table generated_reports already exists — skipping.';
END
