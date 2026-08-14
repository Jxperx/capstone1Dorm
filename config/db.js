require('dotenv').config();

const dbUser = process.env.DB_USER && process.env.DB_USER.trim();
const dbPass = process.env.DB_PASSWORD || process.env.DB_PASS;

let sql;
let config;

if (dbUser) {
    // SQL Server Authentication (Cross-platform pure JS tedious driver for Linux, Cloud, Docker, Azure, AWS)
    sql = require('mssql');
    config = {
        server: process.env.DB_SERVER,
        database: process.env.DB_DATABASE,
        user: dbUser,
        password: dbPass,
        port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 1433,
        options: {
            encrypt: process.env.DB_ENCRYPT === 'true',
            trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== 'false',
            enableArithAbort: true
        }
    };
    console.log(`[DB] Initializing SQL Server Authentication for host '${process.env.DB_SERVER}', database '${process.env.DB_DATABASE}'.`);
} else {
    // Windows Authentication Fallback (Local Windows Dev Environment)
    sql = require('mssql/msnodesqlv8');
    const driver = process.env.DB_ODBC_DRIVER || 'ODBC Driver 17 for SQL Server';
    config = {
        connectionString: `Driver={${driver}};Server=${process.env.DB_SERVER};Database=${process.env.DB_DATABASE};Trusted_Connection=yes;`,
        options: {
            trustedConnection: true,
            enableArithAbort: true
        }
    };
    console.log(`[DB] Initializing Windows Authentication (msnodesqlv8) for server '${process.env.DB_SERVER}'.`);
}

const poolPromise = new sql.ConnectionPool(config)
    .connect()
    .then(pool => {
        console.log('[DB] Connected to MSSQL Server successfully!');
        return pool;
    })
    .catch(err => {
        console.error('[DB] Database Connection Failed!', err.message || err);
        throw err;
    });

module.exports = {
    sql,
    poolPromise,
    config
};

