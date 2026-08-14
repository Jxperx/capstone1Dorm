const { poolPromise } = require('./config/db');

async function migrate() {
    const pool = await poolPromise;

    // market_search_results table
    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'market_search_results')
        CREATE TABLE market_search_results (
            id INT IDENTITY(1,1) PRIMARY KEY,
            search_date DATE NOT NULL DEFAULT CAST(GETDATE() AS DATE),
            unit_type NVARCHAR(20),
            property_name NVARCHAR(200),
            location NVARCHAR(100),
            sqm_min INT,
            sqm_max INT,
            monthly_rate DECIMAL(10,2),
            is_fully_furnished BIT DEFAULT 1,
            has_cctv BIT DEFAULT 0,
            has_fiber BIT DEFAULT 0,
            source_url NVARCHAR(500),
            raw_snippet NVARCHAR(MAX),
            created_at DATETIME DEFAULT GETDATE()
        )
    `);
    console.log('[Migration] market_search_results table ready');

    // market_benchmarks table
    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'market_benchmarks')
        CREATE TABLE market_benchmarks (
            id INT IDENTITY(1,1) PRIMARY KEY,
            unit_type NVARCHAR(20) NOT NULL,
            avg_market_rate DECIMAL(10,2) NOT NULL,
            price_low DECIMAL(10,2),
            price_high DECIMAL(10,2),
            area NVARCHAR(100),
            last_updated DATETIME DEFAULT GETDATE()
        )
    `);
    console.log('[Migration] market_benchmarks table ready');

    // Seed default benchmarks if empty
    const seedCheck = await pool.request().query(`SELECT COUNT(*) as cnt FROM market_benchmarks`);
    if (seedCheck.recordset[0].cnt === 0) {
        await pool.request().query(`
            INSERT INTO market_benchmarks (unit_type, avg_market_rate, price_low, price_high, area)
            VALUES
                ('condo', 21000, 14000, 30000, 'Calamba / Nuvali Santa Rosa'),
                ('dorm',   5000,  2000,  8000, 'Calamba / Nuvali Santa Rosa')
        `);
        console.log('[Migration] market_benchmarks seeded with default values');
    }

    // Add applied_by to room_pricing_history if missing
    const colCheck = await pool.request().query(`
        SELECT COUNT(*) as cnt FROM sys.columns
        WHERE object_id = OBJECT_ID('room_pricing_history') AND name = 'applied_by'
    `);
    if (colCheck.recordset[0].cnt === 0) {
        await pool.request().query(`ALTER TABLE room_pricing_history ADD applied_by NVARCHAR(50) DEFAULT 'admin'`);
        console.log('[Migration] applied_by column added to room_pricing_history');
    } else {
        console.log('[Migration] applied_by column already exists');
    }

    console.log('[Migration] All migrations complete!');
    process.exit(0);
}

migrate().catch(e => {
    console.error('[Migration] Error:', e.message);
    process.exit(1);
});
