const { poolPromise, sql } = require('../config/db');

async function addProfileColumns() {
    try {
        const pool = await poolPromise;
        
        // 1. Add profile_image_url to users
        const checkUserCol = `
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'users' AND COLUMN_NAME = 'profile_image_url'
        `;
        const userRes = await pool.request().query(checkUserCol);
        if (userRes.recordset.length === 0) {
            console.log('Adding profile_image_url to users table...');
            await pool.request().query(`
                ALTER TABLE users
                ADD profile_image_url NVARCHAR(255) NULL
            `);
        } else {
            console.log('Column profile_image_url already exists in users.');
        }

        // 2. Add guardian columns to tenants
        const checkTenantCol = `
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'tenants' AND COLUMN_NAME = 'guardian_name'
        `;
        const tenantRes = await pool.request().query(checkTenantCol);
        if (tenantRes.recordset.length === 0) {
            console.log('Adding guardian columns to tenants table...');
            await pool.request().query(`
                ALTER TABLE tenants
                ADD guardian_name NVARCHAR(100) NULL,
                    guardian_address NVARCHAR(255) NULL,
                    guardian_contact NVARCHAR(50) NULL
            `);
        } else {
            console.log('Guardian columns already exist in tenants.');
        }

        console.log('Database schema updated successfully.');
        process.exit(0);

    } catch (err) {
        console.error('Error updating database:', err);
        process.exit(1);
    }
}

addProfileColumns();
