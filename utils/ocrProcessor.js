/**
 * ocrProcessor.js
 * Uses Tesseract.js to extract text from uploaded payment receipt images.
 * Parses reference number, amount, and timestamp from raw OCR output.
 */

const { createWorker } = require('tesseract.js');

/**
 * Run OCR on an image file and extract structured payment data.
 * @param {string} filePath - Absolute or relative path to the receipt image.
 * @returns {Promise<{rawText, referenceNumber, amount, timestamp, payer}>}
 */
async function extractReceiptData(filePath) {
    let worker;
    try {
        worker = await createWorker('eng');
        const { data: { text } } = await worker.recognize(filePath);
        await worker.terminate();

        const rawText = text || '';

        return {
            rawText,
            referenceNumber: parseReferenceNumber(rawText),
            amount: parseAmount(rawText),
            timestamp: parseTimestamp(rawText),
            payer: parsePayer(rawText)
        };
    } catch (err) {
        if (worker) await worker.terminate().catch(() => {});
        console.error('[OCR Error]', err.message);
        return {
            rawText: '',
            referenceNumber: null,
            amount: null,
            timestamp: null,
            payer: null,
            error: err.message
        };
    }
}

// ─── Parsers ────────────────────────────────────────────────

/**
 * Extract GCash/payment reference numbers from OCR text.
 * GCash ref numbers are typically 13 digits.
 */
function parseReferenceNumber(text) {
    // GCash reference: 13-digit number, often labeled "Ref No." or "Reference"
    const patterns = [
        /(?:ref(?:erence)?(?:\s*no\.?)?|ref\s*#|reference\s*number)[:\s]*([A-Z0-9]{8,20})/i,
        /\b(\d{13})\b/,  // GCash 13-digit reference
        /\b([A-Z0-9]{10,16})\b/
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) return match[1].trim();
    }
    return null;
}

/**
 * Extract payment amount (Philippine Peso format).
 */
function parseAmount(text) {
    // Match PHP amounts like "PHP 1,200.00" or "₱1,200" or "1200.00"
    const patterns = [
        /(?:PHP|₱|Php)\s*([\d,]+(?:\.\d{2})?)/i,
        /(?:amount|total|paid)[:\s]*(?:PHP|₱|Php)?\s*([\d,]+(?:\.\d{2})?)/i,
        /\b([\d,]+\.\d{2})\b/
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            const cleaned = match[1].replace(/,/g, '');
            const num = parseFloat(cleaned);
            if (!isNaN(num) && num > 0 && num < 1000000) return num;
        }
    }
    return null;
}

/**
 * Extract date/time from receipt text.
 */
function parseTimestamp(text) {
    const patterns = [
        /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}[\s,]*\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)/i,
        /(\w+ \d{1,2},\s*\d{4}[\s,]*\d{1,2}:\d{2}(?:\s*[AP]M)?)/i,
        /(\d{4}[-\/]\d{2}[-\/]\d{2}[\sT]\d{2}:\d{2})/
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) return match[1].trim();
    }
    return null;
}

/**
 * Try to extract payer name from OCR text.
 */
function parsePayer(text) {
    const patterns = [
        /(?:sent\s+by|from|payer|paid\s+by)[:\s]+([A-Z][a-zA-Z\s]{2,40})/i,
        /(?:sender)[:\s]+([A-Z][a-zA-Z\s]{2,40})/i
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) return match[1].trim();
    }
    return null;
}

module.exports = { extractReceiptData };
