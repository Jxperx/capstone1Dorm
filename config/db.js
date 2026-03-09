const sql = require('mssql/msnodesqlv8');
require('dotenv').config();

console.log('DB_SERVER:', process.env.DB_SERVER);

// Use config object with connectionString to ensure it's passed correctly
const config = {
    connectionString: `Driver={ODBC Driver 17 for SQL Server};Server=${process.env.DB_SERVER};Database=${process.env.DB_DATABASE};Trusted_Connection=yes;`,
    // mssql/msnodesqlv8 specific options
    options: {
        trustedConnection: true,
        enableArithAbort: true
    }
};

console.log('Config Connection String:', config.connectionString);

const poolPromise = new sql.ConnectionPool(config)
    .connect()
    .then(pool => {
        console.log('Connected to MSSQL Server successfully!');
        return pool;
    })
    .catch(err => {
        console.error('Database Connection Failed!', err);
        throw err;
    });

module.exports = {
    sql,
    poolPromise
};
