'use strict';
/**
 * scripts/migrate_visits_applications.js
 * Run once: node scripts/migrate_visits_applications.js
 *
 * Creates:
 *   - site_visit_requests table
 *   - Adds type, move_in_date, intended_stay_months, source columns to inquiries (if missing)
 */

require('dotenv').config();
const { poolPromise, sql } = require('../config/db');

async function run() {
    const pool = await poolPromise;

    // ── 1. Create site_visit_requests ─────────────────────────────────────────
    await pool.request().query(`
        IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'site_visit_requests')
        CREATE TABLE site_visit_requests (
            id           INT IDENTITY(1,1) PRIMARY KEY,
            unit_id      INT NOT NULL,
            visit_date   DATE NOT NULL,
            time_slot    NVARCHAR(20) NOT NULL,   -- 'morning','afternoon','late_afternoon'
            name         NVARCHAR(100) NOT NULL,
            email        NVARCHAR(255),
            phone        NVARCHAR(30),
            notes        NVARCHAR(500),
            status       NVARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending/confirmed/cancelled
            created_at   DATETIME2    NOT NULL DEFAULT SYSDATETIME()
        )
    `);
    console.log('[Migration] site_visit_requests table OK');

    // ── 2. Add columns to inquiries (idempotent) ──────────────────────────────
    const colChecks = [
        { col: 'type',                  def: `NVARCHAR(30) NOT NULL DEFAULT 'inquiry'` },
        { col: 'move_in_date',          def: `DATE NULL` },
        { col: 'intended_stay_months',  def: `INT NULL` },
        { col: 'source',                def: `NVARCHAR(50) NULL` },
    ];

    for (const { col, def } of colChecks) {
        await pool.request().query(`
            IF NOT EXISTS (
                SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME = 'inquiries' AND COLUMN_NAME = '${col}'
            )
            ALTER TABLE inquiries ADD ${col} ${def}
        `);
        console.log(`[Migration] inquiries.${col} column OK`);
    }

    console.log('[Migration] Done!');
    process.exit(0);
}

run().catch(err => {
    console.error('[Migration] Error:', err);
    process.exit(1);
});
