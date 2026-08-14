const express = require('express');
const router = express.Router();
const { poolPromise, sql } = require('../../config/db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1000) + path.extname(file.originalname))
});
const upload = multer({ storage: storage });

// ── Auto-migration: ensure room_gallery table exists ──
let galleryTableReady = false;
async function ensureGalleryTable() {
    if (galleryTableReady) return;
    try {
        const pool = await poolPromise;
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'room_gallery')
            BEGIN
                CREATE TABLE room_gallery (
                    id INT IDENTITY(1,1) PRIMARY KEY,
                    room_id INT NOT NULL,
                    image_url NVARCHAR(255) NOT NULL,
                    caption NVARCHAR(100) NULL,
                    sort_order INT NOT NULL DEFAULT 0,
                    created_at DATETIME2 NOT NULL DEFAULT GETDATE(),
                    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
                );
            END
        `);
        galleryTableReady = true;
    } catch (err) {
        console.error('[Rooms] room_gallery migration error:', err.message);
    }
}

// Admin/Public - Get all rooms (with cover image from gallery)
router.get('/', async (req, res) => {
    try {
        const pool = await poolPromise;
        await ensureGalleryTable();
        const result = await pool.request().query(`
            SELECT r.*,
                   ISNULL(t.active_count, 0) AS active_tenants,
                   g.image_url AS cover_image
            FROM rooms r
            LEFT JOIN (
                SELECT room_id, COUNT(*) AS active_count
                FROM tenants
                WHERE status = 'active'
                GROUP BY room_id
            ) t ON r.id = t.room_id
            LEFT JOIN (
                SELECT room_id, image_url,
                       ROW_NUMBER() OVER (PARTITION BY room_id ORDER BY sort_order, id) AS rn
                FROM room_gallery
            ) g ON r.id = g.room_id AND g.rn = 1
        `);
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// Admin/Public - Get single room with media + gallery
router.get('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid room id' });
    
    try {
        const pool = await poolPromise;
        await ensureGalleryTable();
        const roomResult = await pool.request()
            .input('id', sql.Int, id)
            .query('SELECT TOP 1 * FROM rooms WHERE id = @id');

        if (roomResult.recordset.length === 0) return res.status(404).json({ error: 'Room not found' });

        const room = roomResult.recordset[0];
        let media = null;
        
        if (room.room_type) {
            const mediaResult = await pool.request()
                .input('type', sql.NVarChar, room.room_type)
                .query('SELECT TOP 1 image_url, video_url, map_embed_url FROM property_media WHERE type = @type');
            if (mediaResult.recordset.length > 0) media = mediaResult.recordset[0];
        }

        // Fetch per-unit gallery images
        const galleryResult = await pool.request()
            .input('rid', sql.Int, id)
            .query('SELECT id, image_url, caption, sort_order FROM room_gallery WHERE room_id = @rid ORDER BY sort_order, id');

        // Fetch active tenant leases for calendar availability
        const leasesResult = await pool.request()
            .input('rid', sql.Int, id)
            .query("SELECT id, lease_start_date, lease_end_date, status FROM tenants WHERE room_id = @rid AND status = 'active'");

        res.json({ room, media, gallery: galleryResult.recordset, leases: leasesResult.recordset });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Admin - Add Room
router.post('/', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.status(401).json({ error: 'Not authorized' });
    
    const { room_number, capacity, monthly_rate, room_type } = req.body;
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('room_number', sql.NVarChar, room_number)
            .input('capacity', sql.Int, capacity)
            .input('monthly_rate', sql.Decimal(10, 2), monthly_rate)
            .input('room_type', sql.NVarChar, room_type)
            .query('INSERT INTO rooms (room_number, capacity, monthly_rate, room_type) VALUES (@room_number, @capacity, @monthly_rate, @room_type)');
        res.json({ message: 'Room added successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Admin - Update Room
router.put('/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.status(401).json({ error: 'Not authorized' });
    
    const { room_number, capacity, monthly_rate, room_type } = req.body;
    const id = req.params.id;
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('id', sql.Int, id)
            .input('room_number', sql.NVarChar, room_number)
            .input('capacity', sql.Int, capacity)
            .input('monthly_rate', sql.Decimal(10, 2), monthly_rate)
            .input('room_type', sql.NVarChar, room_type)
            .query('UPDATE rooms SET room_number = @room_number, capacity = @capacity, monthly_rate = @monthly_rate, room_type = @room_type WHERE id = @id');
        res.json({ message: 'Room updated successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Admin - Delete Room
router.delete('/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.status(401).json({ error: 'Not authorized' });
    
    const id = req.params.id;
    try {
        const pool = await poolPromise;
        const check = await pool.request()
            .input('id', sql.Int, id)
            .query("SELECT COUNT(*) as count FROM tenants WHERE room_id = @id AND status = 'active'");
        
        if (check.recordset[0].count > 0) return res.status(400).json({ error: 'Cannot delete room with active tenants' });

        await pool.request()
            .input('id', sql.Int, id)
            .query('DELETE FROM rooms WHERE id = @id');
        res.json({ message: 'Room deleted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Admin/Public - Get all property media
router.get('/media/all', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query('SELECT type, image_url, video_url, map_embed_url FROM property_media');
        const data = {};
        result.recordset.forEach(row => {
            data[row.type] = {
                image_url: row.image_url,
                video_url: row.video_url,
                map_embed_url: row.map_embed_url
            };
        });
        res.json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Admin - Update property media
router.post('/:type', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'video', maxCount: 1 }]), async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.status(401).json({ error: 'Not authorized' });
    
    const type = req.params.type;
    if (type !== 'condo' && type !== 'dorm') return res.status(400).json({ error: 'Invalid type' });

    const mapEmbed = req.body.mapEmbed || null;
    const imageFile = req.files && req.files.image && req.files.image[0];
    const videoFile = req.files && req.files.video && req.files.video[0];
    const imageUrl = imageFile ? '/uploads/' + imageFile.filename : null;
    const videoUrl = videoFile ? '/uploads/' + videoFile.filename : null;

    try {
        const pool = await poolPromise;
        await pool.request()
            .input('type', sql.NVarChar, type)
            .input('image_url', sql.NVarChar, imageUrl)
            .input('video_url', sql.NVarChar, videoUrl)
            .input('map_embed_url', sql.NVarChar, mapEmbed)
            .query(`
                IF EXISTS (SELECT 1 FROM property_media WHERE type = @type)
                BEGIN
                    UPDATE property_media
                    SET image_url = COALESCE(@image_url, image_url),
                        video_url = COALESCE(@video_url, video_url),
                        map_embed_url = @map_embed_url
                    WHERE type = @type
                END
                ELSE
                BEGIN
                    INSERT INTO property_media (type, image_url, video_url, map_embed_url)
                    VALUES (@type, @image_url, @video_url, @map_embed_url)
                END
            `);

        const updated = await pool.request()
            .input('type', sql.NVarChar, type)
            .query('SELECT type, image_url, video_url, map_embed_url FROM property_media WHERE type = @type');

        res.json({ message: 'Media saved successfully', media: updated.recordset[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ═══════════════════════════════════════════════════
//  PER-UNIT GALLERY ENDPOINTS
// ═══════════════════════════════════════════════════

// Get gallery images for a specific room
router.get('/gallery/:roomId', async (req, res) => {
    const roomId = parseInt(req.params.roomId, 10);
    if (Number.isNaN(roomId)) return res.status(400).json({ error: 'Invalid room id' });
    try {
        const pool = await poolPromise;
        await ensureGalleryTable();
        const result = await pool.request()
            .input('rid', sql.Int, roomId)
            .query('SELECT id, image_url, caption, sort_order FROM room_gallery WHERE room_id = @rid ORDER BY sort_order, id');
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Upload multiple gallery images for a room
router.post('/gallery/:roomId', upload.array('images', 25), async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.status(401).json({ error: 'Not authorized' });
    const roomId = parseInt(req.params.roomId, 10);
    if (Number.isNaN(roomId)) return res.status(400).json({ error: 'Invalid room id' });
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

    try {
        const pool = await poolPromise;
        await ensureGalleryTable();

        // Get current max sort_order
        const maxOrder = await pool.request()
            .input('rid', sql.Int, roomId)
            .query('SELECT ISNULL(MAX(sort_order), -1) AS maxSort FROM room_gallery WHERE room_id = @rid');
        let nextOrder = maxOrder.recordset[0].maxSort + 1;

        for (const file of req.files) {
            await pool.request()
                .input('room_id', sql.Int, roomId)
                .input('image_url', sql.NVarChar, '/uploads/' + file.filename)
                .input('sort_order', sql.Int, nextOrder++)
                .query('INSERT INTO room_gallery (room_id, image_url, sort_order) VALUES (@room_id, @image_url, @sort_order)');
        }

        // Return updated gallery
        const result = await pool.request()
            .input('rid', sql.Int, roomId)
            .query('SELECT id, image_url, caption, sort_order FROM room_gallery WHERE room_id = @rid ORDER BY sort_order, id');

        res.json({ message: `${req.files.length} image(s) uploaded`, gallery: result.recordset });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Delete a single gallery image
router.delete('/gallery/image/:id', async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.status(401).json({ error: 'Not authorized' });
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid image id' });

    try {
        const pool = await poolPromise;
        // Get file path before deleting
        const img = await pool.request()
            .input('id', sql.Int, id)
            .query('SELECT image_url FROM room_gallery WHERE id = @id');

        if (img.recordset.length === 0) return res.status(404).json({ error: 'Image not found' });

        const imageUrl = img.recordset[0].image_url;

        // Delete from database
        await pool.request()
            .input('id', sql.Int, id)
            .query('DELETE FROM room_gallery WHERE id = @id');

        // Delete file from disk
        const filePath = path.join(__dirname, '../../public', imageUrl);
        fs.unlink(filePath, err => {
            if (err) console.warn('[Gallery] Could not delete file:', filePath, err.message);
        });

        res.json({ message: 'Image deleted' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

module.exports = router;
