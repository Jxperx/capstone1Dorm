const { classifyMaintenance } = require('./utils/aiMaintenanceClassifier');
const { poolPromise, sql } = require('./config/db');

async function runTest() {
    try {
        const pool = await poolPromise;
        const tenantRes = await pool.request().query('SELECT TOP 1 id FROM tenants');
        if (tenantRes.recordset.length === 0) {
            console.log('No tenants found. Make sure you have at least one tenant to run this test.');
            process.exit(1);
        }
        const validTenantId = tenantRes.recordset[0].id;

        console.log('--- Generating Test Reports ---');

        const testCases = [
            {
                tenant_id: validTenantId,
                title: 'Fire in the kitchen!',
                description: 'The microwave is smoking and there are sparks everywhere. It looks very dangerous.',
                expected: 'Emergency'
            },
            {
                tenant_id: validTenantId,
                title: 'Sink leaking',
                description: 'The kitchen sink is leaking water everywhere under the cabinet.',
                expected: 'High'
            },
            {
                tenant_id: validTenantId,
                title: 'Paint peeling',
                description: 'There is a small scratch on the wall near the door and the paint is peeling off.',
                expected: 'Routine'
            }
        ];

        for (const tc of testCases) {
            // 1. Insert Raw Request
            const insertRes = await pool.request()
                .input('tenant_id', sql.Int, tc.tenant_id)
                .input('title', sql.NVarChar, tc.title)
                .input('description', sql.NVarChar, tc.description)
                .query(`
                    INSERT INTO maintenance_requests (tenant_id, title, description, status)
                    OUTPUT INSERTED.id
                    VALUES (@tenant_id, @title, @description, 'pending')
                `);
            const id = insertRes.recordset[0].id;

            // 2. Classify
            const text = `${tc.title} ${tc.description}`;
            const ai = await classifyMaintenance(text);
            
            // 3. Update DB
            await pool.request()
                .input('id', sql.Int, id)
                .input('category', sql.NVarChar, ai.category)
                .input('priority', sql.NVarChar, ai.priority)
                .input('urgency', sql.NVarChar, ai.urgency)
                .input('department', sql.NVarChar, ai.department)
                .input('summary', sql.NVarChar(sql.MAX), ai.summary)
                .input('keywords', sql.NVarChar, JSON.stringify(ai.keywords))
                .input('confidence', sql.Decimal(5, 2), ai.confidence)
                .input('isEmergency', sql.Bit, ai.isEmergency ? 1 : 0)
                .query(`
                    UPDATE maintenance_requests
                    SET ai_category = @category, ai_priority = @priority,
                        ai_urgency = @urgency, ai_department = @department,
                        ai_summary = @summary, ai_keywords = @keywords,
                        ai_confidence = @confidence, ai_is_emergency = @isEmergency
                    WHERE id = @id
                `);
            
            console.log(`[Inserted ID ${id}] ${ai.priority} - ${ai.category} - ${tc.title}`);
        }

        console.log('\n--- Fetching Sorted Admin List ---');
        // Test the Admin Query Sorting
        const query = `
            SELECT m.id, m.title, m.ai_priority, m.ai_is_emergency, m.reported_at
            FROM maintenance_requests m
            ORDER BY
                CASE m.ai_priority
                    WHEN 'Emergency' THEN 1
                    WHEN 'High'      THEN 2
                    WHEN 'Medium'    THEN 3
                    WHEN 'Routine'   THEN 4
                    ELSE 5
                END,
                ISNULL(m.ai_is_emergency, 0) DESC,
                m.reported_at ASC
        `;
        const res = await pool.request().query(query);
        res.recordset.forEach((row, i) => {
            console.log(`${i+1}. [${row.ai_priority}] (Emergency: ${row.ai_is_emergency}) - ${row.title}`);
        });

    } catch (err) {
        console.error('Test Failed:', err);
    } finally {
        process.exit();
    }
}

runTest();
