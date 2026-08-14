-- Migration for Enhanced Tenant Maintenance Features
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('maintenance_requests') AND name = 'urgency_level')
BEGIN
    ALTER TABLE maintenance_requests ADD urgency_level NVARCHAR(20) NULL DEFAULT 'normal';
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('maintenance_requests') AND name = 'preferred_schedule')
BEGIN
    ALTER TABLE maintenance_requests ADD preferred_schedule NVARCHAR(100) NULL;
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('maintenance_requests') AND name = 'rating')
BEGIN
    ALTER TABLE maintenance_requests ADD rating INT NULL;
END

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('maintenance_requests') AND name = 'feedback_comment')
BEGIN
    ALTER TABLE maintenance_requests ADD feedback_comment NVARCHAR(MAX) NULL;
END
