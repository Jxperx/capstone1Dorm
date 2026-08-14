-- ============================================================
-- AI Maintenance Triage Migration
-- Run this once against boarding_house_db to add AI columns
-- to the maintenance_requests table.
-- All columns are nullable so existing rows are unaffected.
-- ============================================================

USE boarding_house_db;

ALTER TABLE maintenance_requests
  ADD ai_category      NVARCHAR(60)   NULL,
      ai_priority      NVARCHAR(20)   NULL,   -- Emergency | High | Medium | Routine
      ai_urgency       NVARCHAR(40)   NULL,   -- Immediate | Within 24 hours | Within 2-3 days | This week
      ai_department    NVARCHAR(60)   NULL,
      ai_summary       NVARCHAR(MAX)  NULL,
      ai_keywords      NVARCHAR(MAX)  NULL,   -- JSON-encoded array e.g. ["leak","sink"]
      ai_confidence    DECIMAL(5,2)   NULL,   -- 0-100
      ai_is_emergency  BIT            NULL;   -- 0 or 1

-- Optional index for sorted admin queue
CREATE INDEX idx_ai_priority_reported
  ON maintenance_requests (ai_priority, reported_at ASC);
