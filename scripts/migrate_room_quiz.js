'use strict';
/**
 * scripts/migrate_room_quiz.js
 * Adds room_quiz (NVARCHAR MAX) and quiz_score (INT) columns to inquiries table.
 * Run once:  node scripts/migrate_room_quiz.js
 */

const { poolPromise } = require('../config/db');

async function migrate() {
    console.log('[RoomQuizMigration] Connecting to database...');
    const pool = await poolPromise;

    await pool.request().query(`
        IF NOT EXISTS (
            SELECT 1 FROM sys.columns
            WHERE object_id = OBJECT_ID('inquiries') AND name = 'room_quiz'
        )
        BEGIN
            ALTER TABLE inquiries ADD room_quiz NVARCHAR(MAX) NULL;
            PRINT 'Column room_quiz added.';
        END
        ELSE PRINT 'Column room_quiz already exists.';
    `);

    await pool.request().query(`
        IF NOT EXISTS (
            SELECT 1 FROM sys.columns
            WHERE object_id = OBJECT_ID('inquiries') AND name = 'quiz_score'
        )
        BEGIN
            ALTER TABLE inquiries ADD quiz_score INT NULL;
            PRINT 'Column quiz_score added.';
        END
        ELSE PRINT 'Column quiz_score already exists.';
    `);

    console.log('[RoomQuizMigration] Migration complete.');
    process.exit(0);
}

migrate().catch(err => {
    console.error('[RoomQuizMigration] Error:', err.message);
    process.exit(1);
});
