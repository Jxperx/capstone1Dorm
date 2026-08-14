const { poolPromise } = require('../config/db');
const fs = require('fs');
const path = require('path');

async function runMigration() {
    try {
        console.log('Running enhanced maintenance migration...');
        const pool = await poolPromise;
        const sqlScript = fs.readFileSync(path.join(__dirname, 'migrate_enhanced_maintenance.sql'), 'utf8');
        
        await pool.request().query(sqlScript);
        console.log('Migration successfully applied!');

        const res = await pool.request().query("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'maintenance_requests'");
        console.table(res.recordset);
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        process.exit();
    }
}

runMigration();
