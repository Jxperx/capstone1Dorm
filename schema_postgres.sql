-- ============================================================
-- Supabase / PostgreSQL Schema Migration Script
-- Boarding House Management & Digital Billing System
-- ============================================================

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'tenant' CHECK (role IN ('admin', 'tenant')),
    phone_number VARCHAR(20),
    profile_image_url VARCHAR(255) NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Rooms Table
CREATE TABLE IF NOT EXISTS rooms (
    id SERIAL PRIMARY KEY,
    room_number VARCHAR(20) NOT NULL UNIQUE,
    capacity INT NOT NULL DEFAULT 1,
    monthly_rate DECIMAL(10, 2) NOT NULL,
    description TEXT,
    room_type VARCHAR(20) NOT NULL DEFAULT 'dorm',
    sqm DECIMAL(5, 2) NULL,
    has_balcony BOOLEAN NOT NULL DEFAULT FALSE,
    is_fully_furnished BOOLEAN NOT NULL DEFAULT TRUE,
    has_ac BOOLEAN NOT NULL DEFAULT TRUE,
    has_wifi BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Tenants Table
CREATE TABLE IF NOT EXISTS tenants (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    room_id INT REFERENCES rooms(id) ON DELETE SET NULL,
    lease_start_date DATE NOT NULL,
    lease_end_date DATE,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'past')),
    guardian_name VARCHAR(100) NULL,
    guardian_address VARCHAR(255) NULL,
    guardian_contact VARCHAR(50) NULL
);

-- 4. Payments Table
CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    amount DECIMAL(10, 2) NOT NULL,
    payment_date DATE NOT NULL,
    payment_method VARCHAR(50),
    proof_image_url VARCHAR(255),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    gateway_transaction_id VARCHAR(100),
    gateway_status VARCHAR(50),
    expected_amount DECIMAL(10,2),
    reference_number VARCHAR(100),
    booking_id VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Utility Expenses Table
CREATE TABLE IF NOT EXISTS utility_expenses (
    id SERIAL PRIMARY KEY,
    expense_type VARCHAR(50) NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    expense_date DATE NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. Maintenance Requests Table
CREATE TABLE IF NOT EXISTS maintenance_requests (
    id SERIAL PRIMARY KEY,
    tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'resolved')),
    reported_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE NULL,
    ai_category VARCHAR(60) NULL,
    ai_priority VARCHAR(20) NULL,
    ai_urgency VARCHAR(40) NULL,
    ai_department VARCHAR(60) NULL,
    ai_summary TEXT NULL,
    ai_keywords TEXT NULL,
    ai_confidence DECIMAL(5,2) NULL,
    ai_is_emergency BOOLEAN NULL,
    urgency_level VARCHAR(20) DEFAULT 'normal',
    preferred_schedule VARCHAR(100) NULL,
    rating INT NULL,
    feedback_comment TEXT NULL,
    image_url VARCHAR(255) NULL,
    photo_url VARCHAR(255) NULL
);

-- 7. Payment Receipts Table
CREATE TABLE IF NOT EXISTS payment_receipts (
    id SERIAL PRIMARY KEY,
    payment_id INT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    file_path VARCHAR(500) NOT NULL,
    sha256_hash VARCHAR(64) NULL,
    phash_value VARCHAR(64) NULL,
    ocr_raw_text TEXT NULL,
    ocr_ref_number VARCHAR(100) NULL,
    ocr_amount DECIMAL(10,2) NULL,
    ocr_timestamp VARCHAR(100) NULL,
    ocr_payer VARCHAR(200) NULL,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. Payment Attempt Logs Table
CREATE TABLE IF NOT EXISTS payment_attempt_logs (
    id SERIAL PRIMARY KEY,
    tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    payment_id INT NULL,
    device_hash VARCHAR(128) NULL,
    ip_address VARCHAR(45) NULL,
    user_agent VARCHAR(500) NULL,
    attempt_type VARCHAR(50) NULL,
    attempt_status VARCHAR(30) DEFAULT 'pending',
    attempted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 9. Checkout OTP Logs Table
CREATE TABLE IF NOT EXISTS checkout_otp_logs (
    id SERIAL PRIMARY KEY,
    tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    device_hash VARCHAR(128) NULL,
    ip_address VARCHAR(45) NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 10. Fraud Flags Table
CREATE TABLE IF NOT EXISTS fraud_flags (
    id SERIAL PRIMARY KEY,
    payment_id INT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    flag_code VARCHAR(80) NOT NULL,
    flag_description VARCHAR(300) NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 11. Device Fingerprints Table
CREATE TABLE IF NOT EXISTS device_fingerprints (
    id SERIAL PRIMARY KEY,
    tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    device_hash VARCHAR(128) NOT NULL,
    first_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 12. Fraud Scores Table
CREATE TABLE IF NOT EXISTS fraud_scores (
    id SERIAL PRIMARY KEY,
    payment_id INT NOT NULL UNIQUE REFERENCES payments(id) ON DELETE CASCADE,
    risk_score INT NOT NULL DEFAULT 0 CHECK (risk_score >= 0 AND risk_score <= 100),
    risk_level VARCHAR(20) NOT NULL DEFAULT 'SAFE' CHECK (risk_level IN ('SAFE','LOW','MEDIUM','HIGH','CRITICAL')),
    decision VARCHAR(30) NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (decision IN ('AUTO_APPROVED','PENDING_REVIEW','BLOCKED','MANUAL_APPROVED','MANUAL_BLOCKED')),
    analyzed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    reviewed_by VARCHAR(100) NULL,
    admin_note VARCHAR(500) NULL
);

-- 13. Generated Reports Table
CREATE TABLE IF NOT EXISTS generated_reports (
    id SERIAL PRIMARY KEY,
    report_type VARCHAR(50) NOT NULL,
    report_title VARCHAR(255) NOT NULL,
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    generated_by INT REFERENCES users(id) ON DELETE SET NULL,
    date_from DATE NULL,
    date_to DATE NULL,
    priority_level VARCHAR(20) NULL,
    risk_level VARCHAR(20) NULL,
    confidence_score INT NULL,
    executive_summary TEXT NULL,
    report_data TEXT NOT NULL,
    tags VARCHAR(500) NULL
);

-- 14. Inquiries Table
CREATE TABLE IF NOT EXISTS inquiries (
    id SERIAL PRIMARY KEY,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(30) NOT NULL,
    preferred_unit VARCHAR(50) NULL,
    message TEXT NULL,
    message_hash VARCHAR(64) NULL,
    user_hash VARCHAR(64) NULL,
    device_id VARCHAR(255) NULL,
    ip_address VARCHAR(45) NULL,
    user_agent VARCHAR(500) NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'approved',
    ai_result VARCHAR(10) NULL,
    ai_confidence INT NULL,
    ai_reasoning VARCHAR(500) NULL,
    admin_note VARCHAR(500) NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    room_quiz TEXT NULL,
    quiz_score INT NULL,
    osint_result TEXT NULL,
    school_id_path VARCHAR(255) NULL,
    govt_id_path VARCHAR(255) NULL,
    guardian_phone VARCHAR(50) NULL,
    id_analysis TEXT NULL,
    id_verify_status VARCHAR(50) NULL,
    type VARCHAR(30) NOT NULL DEFAULT 'inquiry',
    move_in_date DATE NULL,
    intended_stay_months INT NULL,
    source VARCHAR(50) NULL
);

-- 15. Inquiry Blocked IPs Table
CREATE TABLE IF NOT EXISTS inquiry_blocked_ips (
    id SERIAL PRIMARY KEY,
    ip_address VARCHAR(45) NOT NULL UNIQUE,
    reason VARCHAR(255) NULL,
    blocked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    blocked_by VARCHAR(50) NOT NULL DEFAULT 'system'
);

-- 16. Live Chat Messages Table
CREATE TABLE IF NOT EXISTS live_chat_messages (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(100) NOT NULL,
    tenant_id INT REFERENCES users(id) ON DELETE CASCADE,
    sender VARCHAR(10) NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 17. Room Pricing History Table
CREATE TABLE IF NOT EXISTS room_pricing_history (
    id SERIAL PRIMARY KEY,
    room_id INT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    old_rate DECIMAL(10, 2) NOT NULL,
    new_rate DECIMAL(10, 2) NOT NULL,
    reason VARCHAR(500) NULL,
    applied_by VARCHAR(50) NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 18. Market Benchmarks Table
CREATE TABLE IF NOT EXISTS market_benchmarks (
    id SERIAL PRIMARY KEY,
    area VARCHAR(100) NOT NULL,
    unit_type VARCHAR(50) NOT NULL,
    avg_market_rate DECIMAL(10, 2) NOT NULL,
    source_url VARCHAR(500) NULL,
    fetched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    price_low DECIMAL(10, 2) NULL,
    price_high DECIMAL(10, 2) NULL,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 19. Tenant Feedback Table
CREATE TABLE IF NOT EXISTS tenant_feedback (
    id SERIAL PRIMARY KEY,
    tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    survey_id INT NULL,
    feedback_text TEXT NOT NULL,
    ai_sentiment VARCHAR(20) DEFAULT 'Neutral',
    ai_sentiment_score DECIMAL(4,2) DEFAULT 0.00,
    ai_topics TEXT NULL,
    ai_keywords TEXT NULL,
    ai_summary TEXT NULL,
    ai_needs_attention BOOLEAN DEFAULT FALSE,
    ai_confidence DECIMAL(5,2) DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 20. Feedback Alerts Table
CREATE TABLE IF NOT EXISTS feedback_alerts (
    id SERIAL PRIMARY KEY,
    issue_topic VARCHAR(100) NOT NULL,
    negative_count INT DEFAULT 0,
    avg_sentiment_score DECIMAL(4,2) DEFAULT 0.00,
    period_type VARCHAR(20) NOT NULL,
    alert_severity VARCHAR(20) NOT NULL,
    recommended_action TEXT NULL,
    is_resolved BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE NULL
);

-- 21. Site Visit Requests Table
CREATE TABLE IF NOT EXISTS site_visit_requests (
    id SERIAL PRIMARY KEY,
    unit_id INT NOT NULL,
    visit_date DATE NOT NULL,
    time_slot VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(30),
    notes VARCHAR(500),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 22. Property Media Table
CREATE TABLE IF NOT EXISTS property_media (
    id SERIAL PRIMARY KEY,
    type VARCHAR(20) NOT NULL UNIQUE,
    image_url VARCHAR(255) NULL,
    video_url VARCHAR(255) NULL,
    map_embed_url TEXT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 23. Password Reset Tokens Table
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    otp_code VARCHAR(6) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed Default Market Benchmarks if empty
INSERT INTO market_benchmarks (area, unit_type, avg_market_rate, source_url)
SELECT 'Calamba, Laguna', 'dorm', 5000.00, 'Market Research - May 2026'
WHERE NOT EXISTS (SELECT 1 FROM market_benchmarks WHERE area = 'Calamba, Laguna');

INSERT INTO market_benchmarks (area, unit_type, avg_market_rate, source_url)
SELECT 'Sta. Rosa, Nuvali', 'condo', 21000.00, 'Market Research - May 2026'
WHERE NOT EXISTS (SELECT 1 FROM market_benchmarks WHERE area = 'Sta. Rosa, Nuvali');
