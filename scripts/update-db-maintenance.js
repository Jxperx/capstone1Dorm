const { poolPromise, sql } = require('../config/db');

async function addMaintenanceImageColumn() {
    try {
        const pool = await poolPromise;
        
        // Check if column exists first to avoid error
        const checkQuery = `
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'maintenance_requests' AND COLUMN_NAME = 'image_url'
        `;
        
        const result = await pool.request().query(checkQuery);
        
        if (result.recordset.length === 0) {
            console.log('Adding image_url column to maintenance_requests table...');
            await pool.request().query(`
                ALTER TABLE maintenance_requests
                ADD image_url NVARCHAR(255) NULL
            `);
            console.log('Column added successfully.');
        } else {
            console.log('Column image_url already exists.');
        }
        
    } catch (err) {
        console.error('Error updating database:', err);
    } finally {
        // process.exit(0); // Optional: explicitly exit
    }
}
    
addMaintenanceImageColumn();
