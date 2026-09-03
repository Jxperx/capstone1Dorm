const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../config/db');
const axios = require('axios');

// PayMongo GCash Payment Source Creation
router.post('/gcash', async (req, res) => {
    const { amount, description, name, email, phone, bill_id } = req.body;

    const secretKey = process.env.PAYMONGO_SECRET_KEY;
    if (!secretKey || !secretKey.startsWith('sk_')) {
        console.error('PayMongo secret key is missing or invalid.');
        return res.status(500).json({ error: 'Payment gateway is not configured correctly.' });
    }

    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) {
        return res.status(400).json({ error: 'Invalid amount. Please enter a valid peso amount.' });
    }

    const amountCentavos = Math.round(parsedAmount * 100);
    if (amountCentavos < 100) return res.status(400).json({ error: 'Minimum payment amount is ₱1.00.' });
    if (amountCentavos > 100000000) return res.status(400).json({ error: 'Maximum payment amount is ₱1,000,000.' });

    let normalizedPhone = (phone || '').toString().trim().replace(/\s+/g, '');
    if (normalizedPhone.startsWith('09') && normalizedPhone.length === 11) {
        normalizedPhone = '+63' + normalizedPhone.slice(1);
    } else if (normalizedPhone.startsWith('9') && normalizedPhone.length === 10) {
        normalizedPhone = '+63' + normalizedPhone;
    } else if (!normalizedPhone.startsWith('+')) {
        normalizedPhone = '+63' + normalizedPhone.replace(/^0+/, '');
    }
    if (normalizedPhone.length < 10) normalizedPhone = '+639567125849';

    const billing = {
        name: name || 'EliteStay Tenant',
        email: email || 'tenant@elitestay.com',
    };
    if (normalizedPhone) billing.phone = normalizedPhone;

    const options = {
        method: 'POST',
        url: 'https://api.paymongo.com/v1/sources',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${Buffer.from(secretKey).toString('base64')}`
        },
        data: {
            data: {
                attributes: {
                    amount: amountCentavos,
                    redirect: {
                        success: `${req.protocol}://${req.get('host')}/payment-success`,
                        failed: `${req.protocol}://${req.get('host')}/payment-failed.html`
                    },
                    billing,
                    type: 'gcash',
                    currency: 'PHP',
                    ...(bill_id ? { metadata: { bill_id: String(bill_id) } } : {})
                }
            }
        }
    };

    console.log(`[PayMongo] Creating GCash source: ₱${parsedAmount} (${amountCentavos} centavos), bill_id=${bill_id}`);

    try {
        const response = await axios.request(options);
        const source = response.data.data;
        res.json({ checkout_url: source.attributes.redirect.checkout_url });
    } catch (error) {
        const details = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error('PayMongo API Error:', details);
        res.status(500).json({ error: 'Failed to create GCash payment source.', details });
    }
});

// Create Checkout Session (General purpose checkout if needed)
router.post('/create-checkout-session', async (req, res) => {
    const { amount, description } = req.body;

    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

    try {
        const payload = {
            data: {
                attributes: {
                    line_items: [
                        {
                            currency: 'PHP',
                            amount: Math.round(amount * 100),
                            description: description || 'Boarding House Payment',
                            name: 'Rent/Utility Payment',
                            quantity: 1
                        }
                    ],
                    payment_method_types: ['gcash', 'card', 'paymaya'],
                    send_email_receipt: true,
                    show_description: true,
                    show_line_items: true,
                    success_url: `${req.protocol}://${req.get('host')}/tenant?payment_success=true`,
                    cancel_url: `${req.protocol}://${req.get('host')}/tenant?payment_cancelled=true`
                }
            }
        };

        const response = await axios.post('https://api.paymongo.com/v1/checkout_sessions', payload, {
            headers: {
                'Authorization': `Basic ${Buffer.from(process.env.PAYMONGO_SECRET_KEY || '').toString('base64')}`,
                'Content-Type': 'application/json'
            }
        });

        res.json({ checkoutUrl: response.data.data.attributes.checkout_url });

    } catch (error) {
        console.error('PayMongo Error:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Failed to create checkout session. Check API Key.' });
    }
});

// 1. Generate QRPH Code Route (with GCash Checkout Fallback)
router.post('/qrph', async (req, res) => {
  const secretKey = process.env.PAYMONGO_SECRET_KEY;
  if (!secretKey || !secretKey.startsWith('sk_')) {
    console.error('[PayMongo Error]: Secret key is missing or invalid.');
    return res.status(500).json({ error: 'Payment gateway is not configured correctly. Secret key is missing.' });
  }

  try {
    const { amount, description, name, email, phone, bill_id } = req.body;

    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      return res.status(400).json({ error: 'Amount is required and must be greater than zero.' });
    }

    const amountCentavos = Math.round(parsedAmount * 100);
    const authHeader = `Basic ${Buffer.from(secretKey + ':').toString('base64')}`;

    // Attempt Direct QRPH Code Generation first
    try {
      const response = await axios.post(
        'https://api.paymongo.com/v1/qrph/generate',
        {
          data: {
            attributes: {
              amount: amountCentavos,
              name: name || 'Tenant',
              kind: 'instore',
              description: description || 'Tenant bill payment',
              metadata: { bill_id: String(bill_id || '') }
            }
          }
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'accept': 'application/json',
            'authorization': authHeader
          }
        }
      );

      const qrData = response.data.data;
      return res.status(200).json({
        success: true,
        code_id: qrData.id,
        reference_id: qrData.attributes.reference_id,
        status: qrData.attributes.status,
        qr_image: qrData.attributes.qr_image
      });

    } catch (qrError) {
      console.warn('[PayMongo QRPH Direct API warning, falling back to GCash Source Checkout]:', qrError.response?.data || qrError.message);

      // Fallback: Create PayMongo GCash Source Checkout URL
      let normalizedPhone = (phone || '').toString().trim().replace(/\s+/g, '');
      if (normalizedPhone.startsWith('09') && normalizedPhone.length === 11) {
        normalizedPhone = '+63' + normalizedPhone.slice(1);
      } else if (!normalizedPhone.startsWith('+')) {
        normalizedPhone = '+639567125849';
      }

      const sourceRes = await axios.post(
        'https://api.paymongo.com/v1/sources',
        {
          data: {
            attributes: {
              amount: amountCentavos,
              redirect: {
                success: `${req.protocol}://${req.get('host')}/tenant-dashboard.html?payment_success=true`,
                failed: `${req.protocol}://${req.get('host')}/tenant-dashboard.html?payment_failed=true`
              },
              billing: {
                name: name || 'EliteStay Tenant',
                email: email || 'tenant@elitestay.com',
                phone: normalizedPhone
              },
              type: 'gcash',
              currency: 'PHP',
              metadata: { bill_id: String(bill_id || '') }
            }
          }
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'accept': 'application/json',
            'authorization': authHeader
          }
        }
      );

      const sourceData = sourceRes.data.data;
      return res.status(200).json({
        success: true,
        redirect_url: sourceData.attributes.redirect.checkout_url
      });
    }

  } catch (error) {
    const errorDetails = error.response?.data?.errors?.[0]?.detail || error.response?.data || error.message;
    console.error('PayMongo QRPH Payment Error:', errorDetails);

    return res.status(500).json({
      message: 'Failed to initiate GCash/QRPH payment.',
      error: errorDetails
    });
  }
});

const crypto = require('crypto');

/**
 * Verify PayMongo HMAC-SHA256 Webhook Signature
 * Header format: "t=1630000000,te=hex_signature,li=hex_signature"
 */
function verifyPaymongoSignature(req, webhookSecret) {
    const signatureHeader = req.headers['paymongo-signature'];
    if (!signatureHeader) {
        return { valid: false, reason: 'Missing Paymongo-Signature header' };
    }

    const rawBodyStr = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);
    const parts = signatureHeader.split(',').reduce((acc, part) => {
        const [key, value] = part.trim().split('=');
        if (key && value) acc[key] = value;
        return acc;
    }, {});

    const timestamp = parts.t;
    const testSignature = parts.te;
    const liveSignature = parts.li;

    if (!timestamp || (!testSignature && !liveSignature)) {
        return { valid: false, reason: 'Malformed Paymongo-Signature header' };
    }

    // Enforce freshness window (5 minutes / 300 seconds)
    const now = Math.floor(Date.now() / 1000);
    const eventTime = parseInt(timestamp, 10);
    if (isNaN(eventTime) || Math.abs(now - eventTime) > 300) {
        return { valid: false, reason: 'Webhook signature timestamp expired (older than 5 minutes)' };
    }

    // Compute HMAC-SHA256 over `${timestamp}.${rawBodyStr}`
    const payloadToSign = `${timestamp}.${rawBodyStr}`;
    const computedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(payloadToSign)
        .digest('hex');

    const matches = (targetSig) => {
        if (!targetSig) return false;
        const bufA = Buffer.from(computedSignature, 'utf8');
        const bufB = Buffer.from(targetSig, 'utf8');
        return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
    };

    if (matches(testSignature) || matches(liveSignature)) {
        return { valid: true };
    }

    return { valid: false, reason: 'HMAC signature mismatch' };
}

// 2. Webhook Endpoint with Cryptographic Signature Verification
router.post('/webhook', async (req, res) => {
    const webhookSecret = process.env.PAYMONGO_WEBHOOK_SECRET;

    // Enforce HMAC signature verification — reject if secret is not configured
    if (!webhookSecret || webhookSecret.trim() === '') {
        console.error('[PayMongo Webhook Rejected]: PAYMONGO_WEBHOOK_SECRET is not configured. Cannot verify authenticity.');
        return res.status(500).json({ error: 'Webhook secret not configured — cannot process.' });
    }

    const verification = verifyPaymongoSignature(req, webhookSecret.trim());
    if (!verification.valid) {
        console.warn(`[PayMongo Webhook Rejected]: ${verification.reason}`);
        return res.status(401).json({ error: 'Unauthorized webhook request', details: verification.reason });
    }

    const event = req.body;
    if (!event || !event.data || !event.data.attributes) {
        return res.status(400).json({ error: 'Invalid event payload structure' });
    }

    const eventType = event.data.attributes.type;

    try {
        if (eventType === 'payment.paid') {
            const paymentData = event.data.attributes.data;
            const metadata = paymentData?.attributes?.metadata || {};
            const billId = metadata.bill_id;
            const refNumber = paymentData?.id || metadata.reference_number;
            const amountPaid = paymentData?.attributes?.amount ? (paymentData.attributes.amount / 100) : 0;

            console.log(`[PayMongo Webhook Verified] payment.paid received for bill_id: ${billId}, amount: ₱${amountPaid}`);

            if (billId) {
                const pool = await poolPromise;
                await pool.request()
                    .input('billId', sql.Int, billId)
                    .input('ref', sql.NVarChar, refNumber || 'PAYMONGO_WEBHOOK')
                    .query(`
                        UPDATE payments 
                        SET status = 'approved', 
                            resolved_at = NOW(),
                            reference_number = COALESCE(reference_number, @ref)
                        WHERE id = @billId
                    `);
                console.log(`[PayMongo Webhook] Payment ID ${billId} status updated to 'approved'.`);
            }
        }

        return res.status(200).json({ status: 'success', received: true });
    } catch (err) {
        console.error('[PayMongo Webhook Processing Error]:', err);
        return res.status(500).json({ error: 'Internal server error while processing webhook' });
    }
});

// 3. Status Polling Endpoint (Check if PayMongo received the money)
router.get('/status/:code_id', async (req, res) => {
    const { code_id } = req.params;
    const secretKey = process.env.PAYMONGO_SECRET_KEY;

    if (!code_id) {
        return res.status(400).json({ error: 'Code ID is required' });
    }

    try {
        const pool = await poolPromise;
        let isPaid = false;
        let paymongoData = null;
        let amountPaid = 0;

        // Query PayMongo API if secret key exists
        if (secretKey && secretKey.startsWith('sk_')) {
            try {
                const response = await axios.get(`https://api.paymongo.com/v1/qrph/${code_id}`, {
                    headers: {
                        'accept': 'application/json',
                        'authorization': `Basic ${Buffer.from(secretKey + ':').toString('base64')}`
                    }
                });
                paymongoData = response.data?.data;
                const status = paymongoData?.attributes?.status;
                amountPaid = paymongoData?.attributes?.amount ? (paymongoData.attributes.amount / 100) : 0;
                
                if (status === 'paid' || status === 'completed' || status === 'successful') {
                    isPaid = true;
                }
            } catch (apiErr) {
                console.warn(`[PayMongo Status API Warning for ${code_id}]:`, apiErr.response?.data?.errors?.[0]?.detail || apiErr.message);
            }
        }

        // Check DB as well (e.g. if webhook already processed it or admin approved it)
        const dbCheck = await pool.request()
            .input('codeId', sql.NVarChar, code_id)
            .query("SELECT id, amount, status FROM payments WHERE (reference_number = @codeId OR proof_image_url LIKE '%' || @codeId || '%') AND status = 'approved' LIMIT 1");
        
        if (dbCheck.recordset.length > 0) {
            isPaid = true;
            if (!amountPaid) amountPaid = parseFloat(dbCheck.recordset[0].amount) || 0;
        }

        // If PayMongo confirmed paid, ensure DB record is created & approved
        if (isPaid) {
            let tenantId = req.session?.user?.tenant_id;
            if (!tenantId && req.session?.user?.id) {
                const tRes = await pool.request()
                    .input('uid', sql.Int, req.session.user.id)
                    .query('SELECT id FROM tenants WHERE user_id = @uid');
                if (tRes.recordset.length > 0) tenantId = tRes.recordset[0].id;
            }

            const existing = await pool.request()
                .input('codeId', sql.NVarChar, code_id)
                .query('SELECT id, status FROM payments WHERE reference_number = @codeId');

            if (existing.recordset.length > 0) {
                if (existing.recordset[0].status !== 'approved') {
                    await pool.request()
                        .input('codeId', sql.NVarChar, code_id)
                        .query("UPDATE payments SET status = 'approved', resolved_at = NOW() WHERE reference_number = @codeId");
                }
            } else if (tenantId) {
                await pool.request()
                    .input('tenantId', sql.Int, tenantId)
                    .input('amount', sql.Decimal(18, 2), amountPaid || 0)
                    .input('ref', sql.NVarChar, code_id)
                    .query(`
                        INSERT INTO payments (tenant_id, amount, payment_date, proof_image_url, reference_number, status)
                        VALUES (@tenantId, @amount, CURRENT_DATE, 'PayMongo QRPH Online Payment', @ref, 'approved')
                    `);
            }
        }

        res.json({
            paid: isPaid,
            status: isPaid ? 'paid' : (paymongoData?.attributes?.status || 'unpaid'),
            amount: amountPaid,
            code_id: code_id
        });

    } catch (err) {
        console.error('[PayMongo Status Error]', err);
        res.status(500).json({ error: 'Failed to check payment status' });
    }
});

module.exports = router;

