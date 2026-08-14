const crypto = require('crypto');
const assert = require('assert');

// Import or recreate the verification function to test signature unit logic
function verifyPaymongoSignature(headers, rawBodyBuffer, webhookSecret) {
    const signatureHeader = headers['paymongo-signature'];
    if (!signatureHeader) {
        return { valid: false, reason: 'Missing Paymongo-Signature header' };
    }

    const rawBodyStr = rawBodyBuffer ? rawBodyBuffer.toString('utf8') : '';
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

    const now = Math.floor(Date.now() / 1000);
    const eventTime = parseInt(timestamp, 10);
    if (isNaN(eventTime) || Math.abs(now - eventTime) > 300) {
        return { valid: false, reason: 'Webhook signature timestamp expired (older than 5 minutes)' };
    }

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

console.log('🧪 Starting PayMongo Webhook Signature Unit Tests...\n');

const testSecret = 'whsk_test_secret_key_12345';
const samplePayload = Buffer.from(JSON.stringify({
    data: {
        id: 'evt_123456789',
        type: 'event',
        attributes: {
            type: 'payment.paid',
            data: {
                id: 'pay_987654321',
                attributes: {
                    amount: 500000,
                    metadata: { bill_id: '101' }
                }
            }
        }
    }
}));

// Test 1: Valid test mode signature
const nowTs = Math.floor(Date.now() / 1000);
const validPayloadToSign = `${nowTs}.${samplePayload.toString('utf8')}`;
const validTestSig = crypto.createHmac('sha256', testSecret).update(validPayloadToSign).digest('hex');
const validHeaders = { 'paymongo-signature': `t=${nowTs},te=${validTestSig}` };

const res1 = verifyPaymongoSignature(validHeaders, samplePayload, testSecret);
assert.strictEqual(res1.valid, true, 'Test 1 Failed: Valid signature should pass');
console.log('✅ Test 1 Passed: Valid PayMongo HMAC signature accepted.');

// Test 2: Forged / invalid signature
const invalidHeaders = { 'paymongo-signature': `t=${nowTs},te=forged_signature_hex` };
const res2 = verifyPaymongoSignature(invalidHeaders, samplePayload, testSecret);
assert.strictEqual(res2.valid, false, 'Test 2 Failed: Forged signature should be rejected');
assert.strictEqual(res2.reason, 'HMAC signature mismatch');
console.log('✅ Test 2 Passed: Forged/invalid HMAC signature rejected.');

// Test 3: Expired timestamp (> 5 minutes ago)
const expiredTs = nowTs - 600; // 10 minutes ago
const expiredPayloadToSign = `${expiredTs}.${samplePayload.toString('utf8')}`;
const expiredSig = crypto.createHmac('sha256', testSecret).update(expiredPayloadToSign).digest('hex');
const expiredHeaders = { 'paymongo-signature': `t=${expiredTs},te=${expiredSig}` };

const res3 = verifyPaymongoSignature(expiredHeaders, samplePayload, testSecret);
assert.strictEqual(res3.valid, false, 'Test 3 Failed: Expired timestamp should be rejected');
assert.strictEqual(res3.reason, 'Webhook signature timestamp expired (older than 5 minutes)');
console.log('✅ Test 3 Passed: Replayed/expired timestamp (>5 minutes) rejected.');

// Test 4: Missing header
const res4 = verifyPaymongoSignature({}, samplePayload, testSecret);
assert.strictEqual(res4.valid, false, 'Test 4 Failed: Missing header should be rejected');
assert.strictEqual(res4.reason, 'Missing Paymongo-Signature header');
console.log('✅ Test 4 Passed: Missing signature header rejected.');

console.log('\n🎉 ALL PAYMONGO WEBHOOK SECURITY TESTS PASSED SUCCESSFULLY!');
