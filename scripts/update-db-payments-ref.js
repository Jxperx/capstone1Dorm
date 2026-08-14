const { poolPromise } = require('../config/db');

async function addPaymentsReferenceColumn() {
    try {
        const pool = await poolPromise;
        const checkQuery = `
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'payments' AND COLUMN_NAME = 'reference_number'
        `;
        const result = await pool.request().query(checkQuery);
        if (result.recordset.length === 0) {
            await pool.request().query(`
                ALTER TABLE payments
                ADD reference_number NVARCHAR(100) NULL
            `);
            console.log('Added reference_number to payments table');
        } else {
            console.log('reference_number already exists in payments table');
        }
        process.exit(0);
    } catch (err) {
        console.error('Error updating payments table:', err);
        process.exit(1);
    }
}

addPaymentsReferenceColumn();
