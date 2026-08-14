const { poolPromise } = require('./config/db');

async function check() {
    try {
        const pool = await poolPromise;
        const res = await pool.request().query(`
            SELECT 
                fk.name AS foreign_key_name,
                tp.name AS parent_table,
                tr.name AS referenced_table,
                fk.delete_referential_action_desc
            FROM sys.foreign_keys fk
            INNER JOIN sys.tables tp ON fk.parent_object_id = tp.object_id
            INNER JOIN sys.tables tr ON fk.referenced_object_id = tr.object_id
        `);
        console.table(res.recordset);
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
check();
