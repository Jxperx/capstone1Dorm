/**
 * hashUtils.js
 * Generates SHA-256 (exact duplicate) and pHash (perceptual/visual duplicate)
 * from uploaded receipt image files.
 */

const fs = require('fs');
const crypto = require('crypto');
const Jimp = require('jimp');

/**
 * Generate SHA-256 hash from a file path.
 * @param {string} filePath - Absolute or relative path to the file.
 * @returns {Promise<string>} Hex string SHA-256 hash.
 */
const axios = require('axios');

/**
 * Generate SHA-256 hash from a file path or URL.
 * @param {string} filePath - Absolute or relative path to the file, or a remote HTTP(S) URL.
 * @returns {Promise<string>} Hex string SHA-256 hash.
 */
async function sha256FromFile(filePath) {
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
        try {
            const response = await axios.get(filePath, { responseType: 'arraybuffer' });
            const buffer = Buffer.from(response.data);
            return crypto.createHash('sha256').update(buffer).digest('hex');
        } catch (err) {
            console.error('[sha256FromFile Error fetching URL]', err.message);
            throw err;
        }
    }
    return new Promise((resolve, reject) => {
        try {
            const buffer = fs.readFileSync(filePath);
            const hash = crypto.createHash('sha256').update(buffer).digest('hex');
            resolve(hash);
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Compute a perceptual hash (dHash) from an image file.
 * dHash works by resizing the image to 9x8 and comparing adjacent pixels.
 * Returns a 64-character hex string representing a 64-bit hash.
 * @param {string} filePath - Path to the image file.
 * @returns {Promise<string>} pHash hex string.
 */
async function computePHash(filePath) {
    try {
        // Read with Jimp
        const image = await Jimp.read(filePath);
        // Resize to 9x8 (9 wide for 8 comparisons per row) and grayscale
        image.resize(9, 8).grayscale();

        let hashBits = '';
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const leftPixel = Jimp.intToRGBA(image.getPixelColor(x, y)).r;
                const rightPixel = Jimp.intToRGBA(image.getPixelColor(x + 1, y)).r;
                hashBits += leftPixel > rightPixel ? '1' : '0';
            }
        }

        // Convert 64-bit string to 16-char hex
        let hexHash = '';
        for (let i = 0; i < 64; i += 4) {
            hexHash += parseInt(hashBits.slice(i, i + 4), 2).toString(16);
        }
        return hexHash;
    } catch (err) {
        console.error('[pHash Error]', err.message);
        return null;
    }
}

/**
 * Compute Hamming distance between two pHash hex strings.
 * Lower = more visually similar. 0 = identical, >10 = likely different.
 * @param {string} hash1
 * @param {string} hash2
 * @returns {number} Hamming distance (0–64)
 */
function pHashDistance(hash1, hash2) {
    if (!hash1 || !hash2 || hash1.length !== hash2.length) return 999;
    let distance = 0;
    for (let i = 0; i < hash1.length; i++) {
        const b1 = parseInt(hash1[i], 16).toString(2).padStart(4, '0');
        const b2 = parseInt(hash2[i], 16).toString(2).padStart(4, '0');
        for (let j = 0; j < 4; j++) {
            if (b1[j] !== b2[j]) distance++;
        }
    }
    return distance;
}

module.exports = {
    sha256FromFile,
    computePHash,
    pHashDistance
};
