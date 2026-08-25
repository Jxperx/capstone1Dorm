const { poolPromise } = require('../config/db');

(async () => {
    try {
        const pool = await poolPromise;

        const alterQueries = [
            `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('rooms') AND name = 'sqm')
             ALTER TABLE rooms ADD sqm DECIMAL(5, 2) NULL;`,
            
            `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('rooms') AND name = 'has_balcony')
             ALTER TABLE rooms ADD has_balcony BIT NOT NULL DEFAULT 0;`,
            
            `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('rooms') AND name = 'is_fully_furnished')
             ALTER TABLE rooms ADD is_fully_furnished BIT NOT NULL DEFAULT 1;`,
            
            `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('rooms') AND name = 'has_ac')
             ALTER TABLE rooms ADD has_ac BIT NOT NULL DEFAULT 1;`,
            
            `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('rooms') AND name = 'has_wifi')
             ALTER TABLE rooms ADD has_wifi BIT NOT NULL DEFAULT 1;`
        ];

        for (const q of alterQueries) {
            await pool.request().query(q);
        }
        console.log('Columns verified/added successfully!');

        const updates = [
            `UPDATE rooms SET sqm = 30.00, has_balcony = 1, is_fully_furnished = 1, has_ac = 1, has_wifi = 1 WHERE room_number = 'CONDO-01'`,
            `UPDATE rooms SET sqm = 28.50, has_balcony = 0, is_fully_furnished = 1, has_ac = 1, has_wifi = 1 WHERE room_number = 'CONDO-02'`,
            `UPDATE rooms SET sqm = 35.00, has_balcony = 0, is_fully_furnished = 1, has_ac = 1, has_wifi = 1 WHERE room_number = 'CONDO-03'`,
            `UPDATE rooms SET sqm = 35.00, has_balcony = 0, is_fully_furnished = 1, has_ac = 1, has_wifi = 1 WHERE room_number = 'CONDO-04'`,
            `UPDATE rooms SET sqm = 32.00, has_balcony = 0, is_fully_furnished = 1, has_ac = 1, has_wifi = 1 WHERE room_number = 'CONDO-05'`,
            `UPDATE rooms SET sqm = 32.00, has_balcony = 1, is_fully_furnished = 1, has_ac = 1, has_wifi = 1 WHERE room_number = 'CONDO-06'`,
            `UPDATE rooms SET sqm = NULL, has_balcony = 0, is_fully_furnished = 1, has_ac = 1, has_wifi = 1 WHERE room_number IN ('DormA1', 'DormA2')`
        ];

        for (const u of updates) {
            await pool.request().query(u);
        }
        console.log('Specs populated successfully!');

        const check = await pool.request().query('SELECT room_number, sqm, has_balcony, is_fully_furnished, has_ac, has_wifi FROM rooms');
        console.log('Verification output:');
        console.table(check.recordset);

    } catch (err) {
        console.error('Migration failed:', err);
    }
    process.exit(0);
})();
