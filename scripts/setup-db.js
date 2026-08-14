const fs = require('fs');
const path = require('path');
const sql = require('mssql/msnodesqlv8');
require('dotenv').config();

async function setupDatabase() {
    try {
        console.log('Connecting to master database...');
        
        // Connect to master first
        const masterConfig = {
            connectionString: `Driver={ODBC Driver 17 for SQL Server};Server=${process.env.DB_SERVER};Database=master;Trusted_Connection=yes;`,
            options: {
                trustedConnection: true
            }
        };

        const pool = await new sql.ConnectionPool(masterConfig).connect();
        console.log('Connected to master.');

        const sqlContent = fs.readFileSync(path.join(__dirname, '../database.sql'), 'utf8');
        const batches = sqlContent.split(/\bGO\b/i).map(b => b.trim()).filter(b => b.length > 0);

        for (const batch of batches) {
            try {
                await pool.request().query(batch);
                console.log('Executed batch.');
            } catch (err) {
                 if (err.number === 2714 || err.number === 1801) {
                    console.log('Object exists, skipping...');
                } else {
                    console.error('Error executing batch:', err.message);
                }
            }
        }

        console.log('Database setup completed!');
        pool.close();
        process.exit(0);
    } catch (err) {
        console.error('Setup failed:', err);
        process.exit(1);
    }
}

setupDatabase();
