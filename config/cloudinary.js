'use strict';

const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const path = require('path');

// Validate credentials
if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    console.error('[Cloudinary] Missing configuration credentials! Uploads will fail.');
}

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME?.trim(),
    api_key: process.env.CLOUDINARY_API_KEY?.trim(),
    api_secret: process.env.CLOUDINARY_API_SECRET?.trim()
});

/**
 * Creates a Multer storage engine configured for Cloudinary.
 * @param {string} folderSubpath - Subfolder inside Cloudinary (e.g. 'rooms', 'receipts')
 * @param {string[]} allowedFormats - Allowed file formats
 * @param {boolean} isPrivate - If true, uploads as 'authenticated' to prevent unauthorized public access
 */
function createCloudinaryStorage(folderSubpath, allowedFormats = ['jpg', 'jpeg', 'png'], isPrivate = false) {
    return new CloudinaryStorage({
        cloudinary: cloudinary,
        params: async (req, file) => {
            const ext = path.extname(file.originalname).substring(1).toLowerCase();
            const format = allowedFormats.includes(ext) ? ext : 'jpg';
            const cleanFilename = path.basename(file.originalname, path.extname(file.originalname))
                .replace(/[^a-zA-Z0-9]/g, '_')
                .substring(0, 50);
            const publicId = `${cleanFilename}_${Date.now()}`;
            
            return {
                folder: `elitestay/${folderSubpath}`,
                format: format,
                public_id: publicId,
                type: isPrivate ? 'authenticated' : 'upload', // 'authenticated' requires a signed URL to view
                transformation: isPrivate ? [] : [{ width: 1200, crop: 'limit', quality: 'auto' }] // Optimize non-sensitive images
            };
        }
    });
}

/**
 * Extracts Cloudinary Public ID from an absolute URL.
 * Example URL: https://res.cloudinary.com/cloud_name/image/upload/v123456789/elitestay/rooms/img_123.jpg
 * Returns: elitestay/rooms/img_123
 */
function getPublicIdFromUrl(url) {
    if (!url || !url.includes('cloudinary.com')) return null;
    try {
        const parts = url.split('/');
        const uploadIndex = parts.findIndex(p => p === 'upload' || p === 'authenticated');
        if (uploadIndex === -1) return null;
        
        // Join remaining parts after upload/version, and strip extension
        const remaining = parts.slice(uploadIndex + 1);
        // If there's a version tag (starts with 'v'), skip it
        if (remaining[0] && remaining[0].startsWith('v') && !isNaN(remaining[0].substring(1))) {
            remaining.shift();
        }
        
        const pathAndName = remaining.join('/');
        const lastDot = pathAndName.lastIndexOf('.');
        if (lastDot !== -1) {
            return pathAndName.substring(0, lastDot);
        }
        return pathAndName;
    } catch (e) {
        console.error('[Cloudinary] Failed to parse public ID from URL:', url, e.message);
        return null;
    }
}

/**
 * Deletes an asset from Cloudinary using its URL.
 */
async function deleteFromCloudinary(url, isPrivate = false) {
    const publicId = getPublicIdFromUrl(url);
    if (!publicId) return;
    try {
        const type = isPrivate ? 'authenticated' : 'upload';
        await cloudinary.uploader.destroy(publicId, { type });
        console.log('[Cloudinary] Deleted asset:', publicId);
    } catch (err) {
        console.warn('[Cloudinary] Failed to delete asset:', publicId, err.message);
    }
}

module.exports = {
    cloudinary,
    roomStorage: createCloudinaryStorage('rooms'),
    tenantStorage: createCloudinaryStorage('tenants'),
    profileStorage: createCloudinaryStorage('profiles'),
    maintenanceStorage: createCloudinaryStorage('maintenance'),
    paymentStorage: createCloudinaryStorage('payments'),
    receiptStorage: createCloudinaryStorage('receipts'),
    privateDocumentStorage: createCloudinaryStorage('documents', ['jpg', 'jpeg', 'png'], true),
    getPublicIdFromUrl,
    deleteFromCloudinary
};
