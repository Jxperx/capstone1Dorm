/**
 * routes/fraud-check.js
 * Tenant-facing and webhook-facing fraud check routes.
 * Handles: receipt upload + OCR + hashing + fraud analysis trigger,
 *          device fingerprint storage.
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { poolPromise, sql } = require('../config/db');
const { sha256FromFile, computePHash } = require('../utils/hashUtils');
const { extractReceiptData } = require('../utils/ocrProcessor');
const { analyzePayment } = require('../utils/fraudEngine');

// ─── Multer for receipt uploads ──────────────────────────────
const receiptStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = 'public/uploads/receipts';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `receipt_${Date.now()}${ext}`);
    }
});
const uploadReceipt = multer({
    storage: receiptStorage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
    fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png|gif|webp|bmp/i;
        if (allowed.test(path.extname(file.originalname))) return cb(null, true);
        cb(new Error('Only image files are allowed for receipt upload.'));
    }
});

// ─── POST /api/fraud/upload-receipt ──────────────────────────
// Upload a payment receipt + trigger fraud analysis
router.post('/upload-receipt', async (req, res, next) => {
    if (!req.session?.user) {
        return res.status(403).json({ error: 'Not authorized. Please relogin.' });
    }
    
    // If an Admin is testing the tenant portal, mock a success response to avoid DB pollution
    if (req.session.user.role === 'admin') {
        return res.json({ 
            success: true, 
            receiptUrl: '/uploads/receipts/dummy.jpg', 
            fraud: { score: 0, riskLevel: 'SAFE', decision: 'AUTO_APPROVED', flags: [] },
            ocr: { rawText: 'Admin Test', amount: req.body.expectedAmount || 0 }
        });
    }

    if (!req.session.user.tenant_id) {
        return res.status(403).json({ error: 'Tenant profile missing. Please relogin.' });
    }
    next();
}, (req, res, next) => {
    uploadReceipt.single('receipt')(req, res, err => {
        if (err) return res.status(400).json({ error: err.message });
        next();
    });
}, async (req, res) => {

    const { paymentId, referenceNumber, expectedAmount, gatewayTxId } = req.body;
    if (!paymentId || !req.file) {
        return res.status(400).json({ error: 'Payment ID and receipt image are required.' });
    }

    const filePath = req.file.path;
    const fileUrl = '/uploads/receipts/' + req.file.filename;

    try {
        const pool = await poolPromise;

        // ── 1. Compute hashes ──────────────────────────────────
        const [sha256, phash] = await Promise.all([
            sha256FromFile(filePath),
            computePHash(filePath)
        ]);

        // ── 2. Run OCR ─────────────────────────────────────────
        const ocrData = await extractReceiptData(filePath);

        // ── 3. Store receipt record ────────────────────────────
        await pool.request()
            .input('payment_id', sql.Int, parseInt(paymentId))
            .input('file_path', sql.NVarChar, fileUrl)
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

        // ── 4. Update payment with reference and gateway info ──
        await pool.request()
            .input('id', sql.Int, parseInt(paymentId))
            .input('ref', sql.NVarChar, referenceNumber || null)
            .input('gid', sql.NVarChar, gatewayTxId || null)
            .input('exp', sql.Decimal(18, 2), expectedAmount ? parseFloat(expectedAmount) : null)
            .input('img', sql.NVarChar, fileUrl)
            .query(`
                UPDATE payments SET
                    reference_number = COALESCE(@ref, reference_number),
                    gateway_transaction_id = COALESCE(@gid, gateway_transaction_id),
                    expected_amount = COALESCE(@exp, expected_amount),
                    proof_image_url = @img
                WHERE id = @id
            `);

        // ── 5. Log payment attempt ─────────────────────────────
        const tenantId = req.session.user.tenant_id;
        const deviceHash = req.body.deviceHash || null;
        const ipAddress = req.ip || req.headers['x-forwarded-for'] || null;

        await pool.request()
            .input('tid', sql.Int, tenantId)
            .input('pid', sql.Int, parseInt(paymentId))
            .input('dh', sql.NVarChar, deviceHash)
            .input('ip', sql.NVarChar, ipAddress)
            .input('ua', sql.NVarChar, (req.headers['user-agent'] || '').substring(0, 490))
            .input('type', sql.NVarChar, 'upload')
            .input('status', sql.NVarChar, 'pending')
            .query(`
                INSERT INTO payment_attempt_logs (tenant_id, payment_id, device_hash, ip_address, user_agent, attempt_type, attempt_status)
                VALUES (@tid, @pid, @dh, @ip, @ua, @type, @status)
            `);

        // ── 6. Store device fingerprint ────────────────────────
        if (deviceHash && tenantId) {
            const existing = await pool.request()
                .input('tid', sql.Int, tenantId)
                .input('dh', sql.NVarChar, deviceHash)
                .query('SELECT id FROM device_fingerprints WHERE tenant_id = @tid AND device_hash = @dh');
            
            if (existing.recordset.length === 0) {
                await pool.request()
                    .input('tid', sql.Int, tenantId)
                    .input('dh', sql.NVarChar, deviceHash)
                    .query('INSERT INTO device_fingerprints (tenant_id, device_hash) VALUES (@tid, @dh)');
            } else {
                await pool.request()
                    .input('tid', sql.Int, tenantId)
                    .input('dh', sql.NVarChar, deviceHash)
                    .query('UPDATE device_fingerprints SET last_seen = GETDATE() WHERE tenant_id = @tid AND device_hash = @dh');
            }
        }

        // ── 7. Run fraud analysis ──────────────────────────────
        let fraudResult = { score: 0, riskLevel: 'SAFE', decision: 'AUTO_APPROVED', flags: [] };
        try {
            fraudResult = await analyzePayment(parseInt(paymentId));
        } catch (fraudErr) {
            console.error('[Fraud Engine Error]', fraudErr.message);
        }

        res.json({
            success: true,
            receiptUrl: fileUrl,
            sha256,
            phash,
            ocr: ocrData,
            fraud: fraudResult
        });

    } catch (err) {
        console.error('[Receipt Upload Error]', err.message, err.stack);
        res.status(500).json({ error: 'Failed to process receipt: ' + err.message });
    }
});

// ─── POST /api/fraud/fingerprint ─────────────────────────────
// Store device fingerprint for current session
router.post('/fingerprint', async (req, res) => {
    if (!req.session?.user?.tenant_id) return res.status(403).json({ error: 'Not authorized.' });

    const { deviceHash } = req.body;
    if (!deviceHash) return res.status(400).json({ error: 'deviceHash is required.' });

    const tenantId = req.session.user.tenant_id;

    try {
        const pool = await poolPromise;
        const existing = await pool.request()
            .input('tid', sql.Int, tenantId)
            .input('dh', sql.NVarChar, deviceHash)
            .query('SELECT id FROM device_fingerprints WHERE tenant_id = @tid AND device_hash = @dh');

        if (existing.recordset.length === 0) {
            await pool.request()
                .input('tid', sql.Int, tenantId)
                .input('dh', sql.NVarChar, deviceHash)
                .query('INSERT INTO device_fingerprints (tenant_id, device_hash) VALUES (@tid, @dh)');
        } else {
            await pool.request()
                .input('tid', sql.Int, tenantId)
                .input('dh', sql.NVarChar, deviceHash)
                .query('UPDATE device_fingerprints SET last_seen = GETDATE() WHERE tenant_id = @tid AND device_hash = @dh');
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── POST /api/fraud/log-attempt ──────────────────────────────
// Log a checkout or OTP event
router.post('/log-attempt', async (req, res) => {
    if (!req.session?.user?.tenant_id) return res.status(403).json({ error: 'Not authorized.' });

    const { eventType, deviceHash } = req.body;
    const tenantId = req.session.user.tenant_id;
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || null;

    try {
        const pool = await poolPromise;
        await pool.request()
            .input('tid', sql.Int, tenantId)
            .input('evt', sql.NVarChar, eventType || 'checkout_request')
            .input('dh', sql.NVarChar, deviceHash || null)
            .input('ip', sql.NVarChar, ipAddress)
            .query('INSERT INTO checkout_otp_logs (tenant_id, event_type, device_hash, ip_address) VALUES (@tid, @evt, @dh, @ip)');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
