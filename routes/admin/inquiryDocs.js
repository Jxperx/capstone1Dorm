'use strict';
/**
 * routes/admin/inquiryDocs.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Secure file serving for uploaded inquiry ID documents.
 * Only admins with a valid session can view these files.
 *
 * Routes:
 *   GET /api/admin/inquiry-docs/:inquiryId/:fileType
 *       fileType: 'school_id' | 'govt_id'
 */

const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const { poolPromise, sql } = require('../../config/db');

// ─── Auth Guard ───────────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
    if (req.session?.user && req.session.user.role === 'admin') return next();
    return res.status(403).json({ error: 'Forbidden — admin access required.' });
}

// ─── GET /api/admin/inquiry-docs/:inquiryId/:fileType ─────────────────────────
router.get('/:inquiryId/:fileType', requireAdmin, async (req, res) => {
    const inquiryId = parseInt(req.params.inquiryId, 10);
    const fileType  = req.params.fileType;

    if (isNaN(inquiryId)) {
        return res.status(400).json({ error: 'Invalid inquiry ID.' });
    }
    if (!['school_id', 'govt_id'].includes(fileType)) {
        return res.status(400).json({ error: 'Invalid file type. Must be school_id or govt_id.' });
    }

    try {
        const pool   = await poolPromise;
        const result = await pool.request()
            .input('id', sql.Int, inquiryId)
            .query(`SELECT school_id_path, govt_id_path FROM inquiries WHERE id = @id`);

        const inquiry = result.recordset[0];
        if (!inquiry) {
            return res.status(404).json({ error: 'Inquiry not found.' });
        }

        const filePath = fileType === 'school_id' ? inquiry.school_id_path : inquiry.govt_id_path;

        if (!filePath) {
            return res.status(404).json({ error: 'No document uploaded for this field.' });
        }

        // If it's a Cloudinary URL, generate a temporary signed URL and redirect
        if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
            const { cloudinary, getPublicIdFromUrl } = require('../../config/cloudinary');
            const publicId = getPublicIdFromUrl(filePath);
            if (!publicId) {
                return res.redirect(filePath);
            }
            const signedUrl = cloudinary.url(publicId, {
                type: 'authenticated',
                sign_url: true,
                expires_at: Math.floor(Date.now() / 1000) + 600 // 10 minutes expiry
            });
            return res.redirect(signedUrl);
        }

        // Resolve absolute path — paths in DB are relative to project root
        const absolutePath = path.isAbsolute(filePath)
            ? filePath
            : path.join(__dirname, '..', '..', filePath);

        if (!fs.existsSync(absolutePath)) {
            return res.status(404).json({ error: 'File not found on disk.' });
        }

        // Determine MIME type
        const ext  = path.extname(absolutePath).toLowerCase();
        const mime = ext === '.png' ? 'image/png' : 'image/jpeg';

        res.setHeader('Content-Type', mime);
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.sendFile(absolutePath);

    } catch (err) {
        console.error('[InquiryDocs] Error serving file:', err.message);
        return res.status(500).json({ error: 'Failed to retrieve document.' });
    }
});

module.exports = router;
