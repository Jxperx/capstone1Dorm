const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../config/db');
const multer = require('multer');
const path = require('path');
const { sha256FromFile, computePHash } = require('../utils/hashUtils');
const { extractReceiptData } = require('../utils/ocrProcessor');
const { analyzePayment } = require('../utils/fraudEngine');

const { paymentStorage } = require('../config/cloudinary');
const upload = multer({ storage: paymentStorage });

// 1. Upload Payment Proof
router.post('/upload', async (req, res, next) => {
    if (!req.session.user) {
        return res.status(403).json({ error: 'Not authorized. Please relogin.' });
    }
    
    // We allow admins to pass through, but we will assign their upload to the first active tenant below.
    if (req.session.user.role !== 'admin' && !req.session.user.tenant_id) {
        return res.status(403).json({ error: 'Tenant profile missing. Please relogin.' });
    }
    next();
}, (req, res, next) => {
    upload.single('proof')(req, res, (err) => {
        if (err) {
            console.error('Multer Upload Error:', err);
            return res.status(400).json({ error: 'File upload failed: ' + err.message });
        }
        next();
    });
}, async (req, res) => {
    const { amount, paymentDate, referenceNumber } = req.body;
    const proofUrl = req.file ? req.file.path : null;
    
    let tenantId = req.session.user.tenant_id;
    
    if (!proofUrl) {
        return res.status(400).json({ error: 'No file uploaded.' });
    }

    // MANDATORY VALIDATION: Both Reference Number and Payment Date are strictly required!
    if (!amount || parseFloat(amount) <= 0) {
        return res.status(400).json({ error: 'Payment amount is required and must be greater than 0.' });
    }
    if (!paymentDate) {
        return res.status(400).json({ error: 'Payment Date is required. Please select the date shown on your receipt screenshot.' });
    }
    if (!referenceNumber || !referenceNumber.trim()) {
        return res.status(400).json({ error: 'Reference Number is required. Please enter the exact reference number from your receipt screenshot.' });
    }


    try {
        const pool = await poolPromise;

        // If an Admin is testing the tenant portal, attach the upload to the first active tenant
        // so it actually appears on the Admin Dashboard for approval testing.
        if (req.session.user.role === 'admin') {
            const testTenant = await pool.request().query("SELECT TOP 1 id FROM tenants WHERE status = 'active' ORDER BY id ASC");
            if (testTenant.recordset.length > 0) {
                tenantId = testTenant.recordset[0].id;
            } else {
                return res.status(400).json({ error: 'Cannot test upload: No active tenants found in database. Create a tenant first.' });
            }
        }
        const reqInsert = pool.request()
            .input('tenant_id', sql.Int, tenantId)
            .input('amount', sql.Decimal(18, 2), amount || 0)
            .input('payment_date', sql.Date, paymentDate || new Date())
            .input('proof_image_url', sql.NVarChar, proofUrl);
            
        if (referenceNumber) {
            reqInsert.input('reference_number', sql.NVarChar, referenceNumber);
        }
        
        const insertQuery = referenceNumber
            ? `INSERT INTO payments (tenant_id, amount, payment_date, proof_image_url, reference_number, status) 
               OUTPUT INSERTED.id
               VALUES (@tenant_id, @amount, @payment_date, @proof_image_url, @reference_number, 'pending')`
            : `INSERT INTO payments (tenant_id, amount, payment_date, proof_image_url, status) 
               OUTPUT INSERTED.id
               VALUES (@tenant_id, @amount, @payment_date, @proof_image_url, 'pending')`;
               
        const insertRes = await reqInsert.query(insertQuery);
        const paymentId = insertRes.recordset[0].id;

        // --- Hooking up the Fraud Engine Pipeline ---
        try {
            const filePath = req.file.path;
            const [sha256, phash] = await Promise.all([
                sha256FromFile(filePath),
                computePHash(filePath)
            ]);
            const ocrData = await extractReceiptData(filePath);

            await pool.request()
                .input('payment_id', sql.Int, paymentId)
                .input('file_path', sql.NVarChar, proofUrl)
                .input('sha256', sql.NVarChar, sha256 || null)
                .input('phash', sql.NVarChar, phash || null)
                .input('ocr_raw', sql.NVarChar, ocrData.rawText || '')
                .input('ocr_ref', sql.NVarChar, ocrData.referenceNumber || null)
                .input('ocr_amount', sql.Decimal(18, 2), ocrData.amount || null)
                .input('ocr_ts', sql.NVarChar, ocrData.timestamp || null)
                .input('ocr_payer', sql.NVarChar, ocrData.payer || null)
                .query(`
                    INSERT INTO payment_receipts
                        (payment_id, file_path, sha256_hash, phash_value, ocr_raw_text, ocr_ref_number, ocr_amount, ocr_timestamp, ocr_payer)
                    VALUES
                        (@payment_id, @file_path, @sha256, @phash, @ocr_raw, @ocr_ref, @ocr_amount, @ocr_ts, @ocr_payer)
                `);

            // Run Fraud Engine analyzer and let it auto-approve or block based on risk score
            await analyzePayment(paymentId);
        } catch (engineErr) {
            console.error('[Fraud Integration Error]', engineErr);
        }

        res.json({ message: 'Payment proof uploaded and analyzed successfully!' });
    } catch (err) {
        console.error('Database Insert Error:', err);
        res.status(500).json({ error: 'Database error: ' + err.message });
    }
});

// 2. Get Payment History
router.get('/history', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not authorized. Please login.' });
    }

    let tenantId = req.session.user.tenant_id;
    const pool = await poolPromise;

    if (!tenantId && req.session.user.role === 'tenant') {
        try {
            const tRes = await pool.request()
                .input('uid', sql.Int, req.session.user.id)
                .query('SELECT id FROM tenants WHERE user_id = @uid');
            if (tRes.recordset.length > 0) {
                tenantId = tRes.recordset[0].id;
                req.session.user.tenant_id = tenantId;
            }
        } catch (e) {
            console.error('Error finding tenant ID for payment history:', e);
        }
    }

    if (!tenantId) {
        return res.status(403).json({ error: 'Tenant profile not found.' });
    }

    try {
        const result = await pool.request()
            .input('tenant_id', sql.Int, tenantId)
            .query(`
                SELECT p.*, 
                       u.full_name, 
                       r.room_number 
                FROM payments p
                LEFT JOIN tenants t ON p.tenant_id = t.id
                LEFT JOIN users u ON t.user_id = u.id
                LEFT JOIN rooms r ON t.room_id = r.id
                WHERE p.tenant_id = @tenant_id 
                ORDER BY p.created_at DESC
            `);
        
        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching payment history:', err);
        res.status(500).json({ error: 'Database error fetching history' });
    }
});

// 3. OCR Receipt Scanner Endpoint (Auto-detect Ref # and Date)
router.post('/scan-receipt', upload.single('proof'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No image uploaded for scanning.' });
    }

    try {
        const ocrData = await extractReceiptData(req.file.path);
        res.json({
            success: true,
            referenceNumber: ocrData.referenceNumber || null,
            amount: ocrData.amount || null,
            timestamp: ocrData.timestamp || null
        });
    } catch (err) {
        console.error('[OCR Scan Error]', err);
        res.json({ success: false, error: 'Could not parse image' });
    }
});

module.exports = router;


