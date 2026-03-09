const { poolPromise, sql } = require('../config/db');

async function addCondoModule() {
    try {
        const pool = await poolPromise;

        // 1. Add 'type' column to rooms table if not exists
        const checkColumn = `
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'rooms' AND COLUMN_NAME = 'room_type'
        `;
        const colRes = await pool.request().query(checkColumn);
        
        if (colRes.recordset.length === 0) {
            console.log('Adding room_type column to rooms table...');
            await pool.request().query(`
                ALTER TABLE rooms
                ADD room_type NVARCHAR(20) NOT NULL DEFAULT 'dorm'
            `);
        } else {
            console.log('room_type column already exists.');
        }

        // 2. Insert 2 Condo Units
        const checkCondos = `SELECT * FROM rooms WHERE room_type = 'condo'`;
        const condoRes = await pool.request().query(checkCondos);

        if (condoRes.recordset.length === 0) {
            console.log('Inserting 2 Condo Units...');
            
            // Condo 1
            await pool.request()
                .input('num', sql.NVarChar, 'CONDO-01')
                .input('cap', sql.Int, 4) // Family size?
                .input('rate', sql.Decimal(10, 2), 15000.00)
                .input('desc', sql.NVarChar, 'Premium 1-Bedroom Condo Unit')
                .query(`
                    INSERT INTO rooms (room_number, capacity, monthly_rate, description, room_type)
                    VALUES (@num, @cap, @rate, @desc, 'condo')
                `);

            // Condo 2
            await pool.request()
                .input('num', sql.NVarChar, 'CONDO-02')
                .input('cap', sql.Int, 4)
                .input('rate', sql.Decimal(10, 2), 15000.00)
                .input('desc', sql.NVarChar, 'Premium 1-Bedroom Condo Unit')
                .query(`
                    INSERT INTO rooms (room_number, capacity, monthly_rate, description, room_type)
                    VALUES (@num, @cap, @rate, @desc, 'condo')
                `);
                
            console.log('Condo units added successfully.');
        } else {
            console.log('Condo units already exist.');
        }

        const checkMediaTable = `
            SELECT TABLE_NAME 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_NAME = 'property_media'
        `;
        const mediaTableRes = await pool.request().query(checkMediaTable);

        if (mediaTableRes.recordset.length === 0) {
            console.log('Creating property_media table...');
            await pool.request().query(`
                CREATE TABLE property_media (
                    id INT IDENTITY(1,1) PRIMARY KEY,
                    type NVARCHAR(20) NOT NULL UNIQUE,
                    image_url NVARCHAR(255) NULL,
                    video_url NVARCHAR(255) NULL,
                    map_embed_url NVARCHAR(MAX) NULL,
                    created_at DATETIME2 NOT NULL DEFAULT GETDATE()
                )
            `);

            await pool.request()
                .input('type', sql.NVarChar, 'condo')
                .query(`INSERT INTO property_media (type) VALUES (@type)`);

            await pool.request()
                .input('type', sql.NVarChar, 'dorm')
                .query(`INSERT INTO property_media (type) VALUES (@type)`);

            console.log('property_media table created with default rows.');
        } else {
            console.log('property_media table already exists.');
        }

        process.exit(0);

    } catch (err) {
        console.error('Error adding condo module:', err);
        process.exit(1);
    }
}

addCondoModule();
