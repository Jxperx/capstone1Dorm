/**
 * fraudEngine.js
 * Core Fraud Risk Scoring Engine
 * 
 * Analyzes a payment record and assigns a fraud risk score (0–100)
 * based on: duplicate hashes, OCR mismatch, gateway verification,
 * device reuse, and failed attempt patterns.
 */

const { poolPromise, sql } = require('../config/db');
const { pHashDistance } = require('./hashUtils');
const axios = require('axios');
require('dotenv').config();

// ─── Score weights ────────────────────────────────────────────
const WEIGHTS = {
    DUPLICATE_REFERENCE_NUMBER:      25,
    DUPLICATE_RECEIPT_HASH:          30,
    SIMILAR_PHASH:                   20,
    OCR_AMOUNT_MISMATCH:             20,
    OCR_REFERENCE_MISMATCH:          15,
    GATEWAY_PAYMENT_NOT_FOUND:       35,
    PAYMENT_STATUS_FAILED:           30,
    MULTIPLE_FAILED_ATTEMPTS:        20,
    EXCESSIVE_CHECKOUT_REQUESTS:     15,
    DEVICE_REUSE_SUSPICIOUS:         25,
    REFUNDED_OR_REVERSED_TRANSACTION: 40,
    UNREADABLE_RECEIPT:              80,
};

// ─── Risk classification ──────────────────────────────────────
function classifyRisk(score) {
    if (score <= 20) return 'SAFE';
    if (score <= 40) return 'LOW';
    if (score <= 70) return 'MEDIUM';
    if (score <= 90) return 'HIGH';
    return 'CRITICAL';
}

function decideAction(riskLevel) {
    if (['SAFE', 'LOW'].includes(riskLevel)) return 'AUTO_APPROVED';
    if (riskLevel === 'MEDIUM') return 'PENDING_REVIEW';
    return 'BLOCKED';
}

// ─── Main Analysis Function ───────────────────────────────────
/**
 * Run full fraud analysis on a payment.
 * @param {number} paymentId
 * @returns {Promise<{score, riskLevel, decision, flags}>}
 */
async function analyzePayment(paymentId) {
    const pool = await poolPromise;
    const flags = [];
    let score = 0;

    // ── Load payment ────────────────────────────────────────────
    const payResult = await pool.request()
        .input('id', sql.Int, paymentId)
        .query(`
            SELECT p.*, t.id as tenant_id_val,
                   u.full_name as tenant_name, u.email as tenant_email
            FROM payments p
            JOIN tenants t ON p.tenant_id = t.id
            JOIN users u ON t.user_id = u.id
            WHERE p.id = @id
        `);

    if (!payResult.recordset.length) {
        throw new Error('Payment not found: ' + paymentId);
    }
    const payment = payResult.recordset[0];

    // ── Load receipt ────────────────────────────────────────────
    const recResult = await pool.request()
        .input('pid', sql.Int, paymentId)
        .query('SELECT TOP 1 * FROM payment_receipts WHERE payment_id = @pid ORDER BY uploaded_at DESC');
    const receipt = recResult.recordset[0] || null;

    // ── 1. Duplicate reference number ───────────────────────────
    if (payment.reference_number) {
        const dupRef = await pool.request()
            .input('ref', sql.NVarChar, payment.reference_number)
            .input('id', sql.Int, paymentId)
            .query(`SELECT COUNT(*) as cnt FROM payments WHERE reference_number = @ref AND id != @id`);
        if (dupRef.recordset[0].cnt > 0) {
            score += WEIGHTS.DUPLICATE_REFERENCE_NUMBER;
            flags.push({ code: 'DUPLICATE_REFERENCE_NUMBER', desc: `Reference number "${payment.reference_number}" was already used in another payment.` });
        }
    }

    // ── 2. Duplicate SHA-256 receipt hash ──────────────────────
    if (receipt && receipt.sha256_hash) {
        const dupHash = await pool.request()
            .input('hash', sql.NVarChar, receipt.sha256_hash)
            .input('pid', sql.Int, paymentId)
            .query(`SELECT COUNT(*) as cnt FROM payment_receipts WHERE sha256_hash = @hash AND payment_id != @pid`);
        if (dupHash.recordset[0].cnt > 0) {
            score += WEIGHTS.DUPLICATE_RECEIPT_HASH;
            flags.push({ code: 'DUPLICATE_RECEIPT_HASH', desc: 'An identical receipt file was already uploaded for a different payment.' });
        }
    }

    // ── 3. Similar pHash (visual duplicate) ────────────────────
    if (receipt && receipt.phash_value) {
        const allHashes = await pool.request()
            .input('pid', sql.Int, paymentId)
            .query(`SELECT phash_value, payment_id FROM payment_receipts WHERE payment_id != @pid AND phash_value IS NOT NULL`);
        for (const row of allHashes.recordset) {
            const dist = pHashDistance(receipt.phash_value, row.phash_value);
            if (dist <= 10) {
                score += WEIGHTS.SIMILAR_PHASH;
                // FIX: was 'DUPLICATE_RECEIPT_HASH' (the SHA-256 flag); correct code is 'SIMILAR_PHASH'
                flags.push({ code: 'SIMILAR_PHASH', desc: `Receipt image is visually similar to receipt for payment #${row.payment_id} (pHash distance: ${dist}).` });
                break; // Flag once
            }
        }
    }

    // ── 4. OCR vs Expected Amount mismatch ─────────────────────
    if (receipt && receipt.ocr_amount !== null && payment.expected_amount !== null) {
        const diff = Math.abs(parseFloat(receipt.ocr_amount) - parseFloat(payment.expected_amount));
        if (diff > 1.0) { // Allow PHP 1 tolerance for rounding
            score += WEIGHTS.OCR_AMOUNT_MISMATCH;
            flags.push({ code: 'OCR_AMOUNT_MISMATCH', desc: `OCR detected amount ₱${receipt.ocr_amount} does not match expected ₱${payment.expected_amount}.` });
        }
    }

    // ── 4.1. Partial Payment Check (Amount < Expected Amount) ──
    const expectedAmt = parseFloat(payment.expected_amount) || (receipt ? parseFloat(receipt.ocr_amount) : 0);
    const paidAmt = parseFloat(payment.amount) || 0;
    if (expectedAmt > 0 && paidAmt > 0 && (expectedAmt - paidAmt) > 1.0) {
        const remaining = (expectedAmt - paidAmt).toFixed(2);
        flags.push({ 
            code: 'PARTIAL_PAYMENT', 
            desc: `Partial payment detected: Paid ₱${paidAmt.toFixed(2)} out of expected ₱${expectedAmt.toFixed(2)}. Remaining balance: ₱${remaining}.` 
        });
    }

    // ── 5. OCR vs Reference Number mismatch ────────────────────
    if (receipt && receipt.ocr_ref_number && payment.reference_number) {
        if (receipt.ocr_ref_number.trim() !== payment.reference_number.trim()) {
            score += WEIGHTS.OCR_REFERENCE_MISMATCH;
            flags.push({ code: 'OCR_REFERENCE_MISMATCH', desc: `OCR reference "${receipt.ocr_ref_number}" does not match declared reference "${payment.reference_number}".` });
        }
    }

    // ── 5.5. Unreadable Receipt / Blank Image ───────────────────
    if (receipt) {
        const rawText = receipt.ocr_raw_text || '';
        // If OCR found almost no text, or failed to find BOTH amount and reference, it's highly suspicious
        if (rawText.trim().length < 15 || (receipt.ocr_amount === null && receipt.ocr_ref_number === null)) {
            score += WEIGHTS.UNREADABLE_RECEIPT;
            flags.push({ code: 'UNREADABLE_RECEIPT', desc: 'Receipt image contains no readable payment data (possibly blank or invalid format).' });
        }
    }

    // ── 6 & 7. Gateway verification via PayMongo ────────────────
    if (payment.gateway_transaction_id) {
        const gatewayResult = await verifyPaymongoPayment(payment.gateway_transaction_id);
        if (gatewayResult.status === 'not_found') {
            score += WEIGHTS.GATEWAY_PAYMENT_NOT_FOUND;
            flags.push({ code: 'GATEWAY_PAYMENT_NOT_FOUND', desc: `Transaction ID "${payment.gateway_transaction_id}" was not found in the payment gateway.` });
        } else if (gatewayResult.status === 'failed' || gatewayResult.status === 'pending') {
            score += WEIGHTS.PAYMENT_STATUS_FAILED;
            flags.push({ code: 'PAYMENT_STATUS_FAILED', desc: `Gateway transaction status is "${gatewayResult.status}", not successful.` });
        } else if (['refunded', 'reversed', 'disputed', 'chargeback'].includes(gatewayResult.status)) {
            score += WEIGHTS.REFUNDED_OR_REVERSED_TRANSACTION;
            flags.push({ code: 'REFUNDED_OR_REVERSED_TRANSACTION', desc: `Transaction has been ${gatewayResult.status} in the payment gateway.` });
        }
    } else if (payment.payment_method && ['gcash', 'paymongo', 'qrph'].includes((payment.payment_method || '').toLowerCase())) {
        // Digital payment but no gateway transaction ID
        score += WEIGHTS.GATEWAY_PAYMENT_NOT_FOUND;
        flags.push({ code: 'GATEWAY_PAYMENT_NOT_FOUND', desc: 'Digital payment detected but no gateway transaction ID was recorded.' });
    }

    // ── 8. Multiple failed attempts in 1 hour ──────────────────
    const recentFails = await pool.request()
        .input('tid', sql.Int, payment.tenant_id)
        .query(`
            SELECT COUNT(*) as cnt FROM payment_attempt_logs
            WHERE tenant_id = @tid
              AND attempt_status IN ('failed', 'error')
              AND attempted_at >= DATEADD(HOUR, -1, GETDATE())
        `);
    if (recentFails.recordset[0].cnt >= 3) {
        score += WEIGHTS.MULTIPLE_FAILED_ATTEMPTS;
        flags.push({ code: 'MULTIPLE_FAILED_ATTEMPTS', desc: `${recentFails.recordset[0].cnt} failed payment attempts detected in the last hour.` });
    }

    // ── 9. Excessive checkout/OTP requests ─────────────────────
    const otpCount = await pool.request()
        .input('tid', sql.Int, payment.tenant_id)
        .query(`
            SELECT COUNT(*) as cnt FROM checkout_otp_logs
            WHERE tenant_id = @tid
              AND created_at >= DATEADD(MINUTE, -30, GETDATE())
        `);
    if (otpCount.recordset[0].cnt >= 5) {
        score += WEIGHTS.EXCESSIVE_CHECKOUT_REQUESTS;
        flags.push({ code: 'EXCESSIVE_CHECKOUT_REQUESTS', desc: `${otpCount.recordset[0].cnt} checkout/OTP events detected in the last 30 minutes.` });
    }

    // ── 10. Device reuse across multiple tenant accounts ────────
    // Get device fingerprint for this payment attempt
    const deviceAttempt = await pool.request()
        .input('pid', sql.Int, paymentId)
        .query(`SELECT TOP 1 device_hash FROM payment_attempt_logs WHERE payment_id = @pid AND device_hash IS NOT NULL`);
    
    if (deviceAttempt.recordset.length && deviceAttempt.recordset[0].device_hash) {
        const deviceHash = deviceAttempt.recordset[0].device_hash;
        const deviceReuse = await pool.request()
            .input('dh', sql.NVarChar, deviceHash)
            .input('tid', sql.Int, payment.tenant_id)
            .query(`
                SELECT COUNT(DISTINCT tenant_id) as cnt 
                FROM device_fingerprints 
                WHERE device_hash = @dh AND tenant_id != @tid
            `);
        if (deviceReuse.recordset[0].cnt >= 2) {
            score += WEIGHTS.DEVICE_REUSE_SUSPICIOUS;
            flags.push({ code: 'DEVICE_REUSE_SUSPICIOUS', desc: `This device fingerprint is linked to ${deviceReuse.recordset[0].cnt} other tenant accounts.` });
        }
    }

    // ── Cap score at 100 ────────────────────────────────────────
    score = Math.min(100, score);
    const riskLevel = classifyRisk(score);
    const decision = decideAction(riskLevel);

    // ── Persist fraud score ─────────────────────────────────────
    await persistFraudResult(pool, paymentId, score, riskLevel, decision, flags);

    return { score, riskLevel, decision, flags };
}

// ─── PayMongo Gateway Verification ───────────────────────────
async function verifyPaymongoPayment(transactionId) {
    try {
        const apiKey = process.env.PAYMONGO_SECRET_KEY;
        if (!apiKey || !transactionId) return { status: 'unknown' };

        const b64Key = Buffer.from(apiKey).toString('base64');
        
        // Try payment intent first
        let resp;
        try {
            resp = await axios.get(`https://api.paymongo.com/v1/payment_intents/${transactionId}`, {
                headers: { Authorization: `Basic ${b64Key}` },
                timeout: 8000
            });
            const attrs = resp.data?.data?.attributes;
            return { status: attrs?.status || 'unknown', amount: attrs?.amount };
        } catch (e) {
            // Try as payment
            try {
                resp = await axios.get(`https://api.paymongo.com/v1/payments/${transactionId}`, {
                    headers: { Authorization: `Basic ${b64Key}` },
                    timeout: 8000
                });
                const attrs = resp.data?.data?.attributes;
                return { status: attrs?.status || 'unknown', amount: attrs?.amount };
            } catch (e2) {
                return { status: 'not_found' };
            }
        }
    } catch (err) {
        console.error('[PayMongo Verify Error]', err.message);
        return { status: 'error' };
    }
}

// ─── Persist Results ──────────────────────────────────────────
async function persistFraudResult(pool, paymentId, score, riskLevel, decision, flags) {
    // Upsert fraud_scores
    await pool.request()
        .input('pid', sql.Int, paymentId)
        .input('score', sql.Int, score)
        .input('level', sql.NVarChar, riskLevel)
        .input('decision', sql.NVarChar, decision)
        .query(`
            IF EXISTS (SELECT 1 FROM fraud_scores WHERE payment_id = @pid)
                UPDATE fraud_scores SET risk_score = @score, risk_level = @level, decision = @decision, analyzed_at = GETDATE() WHERE payment_id = @pid
            ELSE
                INSERT INTO fraud_scores (payment_id, risk_score, risk_level, decision) VALUES (@pid, @score, @level, @decision)
        `);

    // Delete old flags then re-insert
    await pool.request().input('pid', sql.Int, paymentId)
        .query('DELETE FROM fraud_flags WHERE payment_id = @pid');

    for (const flag of flags) {
        await pool.request()
            .input('pid', sql.Int, paymentId)
            .input('code', sql.NVarChar, flag.code)
            .input('desc', sql.NVarChar, flag.desc)
            .query('INSERT INTO fraud_flags (payment_id, flag_code, flag_description) VALUES (@pid, @code, @desc)');
    }

    // Update payment status based on decision
    if (decision === 'BLOCKED') {
        await pool.request().input('pid', sql.Int, paymentId)
            .query(`UPDATE payments SET status = 'rejected' WHERE id = @pid`);
    } else if (decision === 'AUTO_APPROVED') {
        await pool.request().input('pid', sql.Int, paymentId)
            .query(`UPDATE payments SET status = 'approved' WHERE id = @pid`);
    }
    // PENDING_REVIEW keeps 'pending' status
}

module.exports = { analyzePayment, verifyPaymongoPayment, classifyRisk, decideAction };
