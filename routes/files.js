const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();
router.use(authMiddleware);

// Multer for file uploads
const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, require('os').tmpdir()),
        filename: (req, file, cb) => cb(null, `upload_${Date.now()}_${file.originalname}`),
    }),
    limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
});

// Security: prevent path traversal
function safePath(serverDir, requestedPath) {
    const resolved = path.resolve(serverDir, requestedPath || '');
    if (!resolved.startsWith(path.resolve(serverDir))) {
        throw new Error('Access denied: path traversal detected');
    }
    return resolved;
}

// List directory
router.get('/:id/files', (req, res) => {
    try {
        const server = getDb().prepare('SELECT server_dir FROM servers WHERE id = ?').get(req.params.id);
        if (!server) return res.status(404).json({ error: 'Server not found' });

        const targetPath = safePath(server.server_dir, req.query.path || '');
        if (!fs.existsSync(targetPath)) return res.status(404).json({ error: 'Path not found' });

        const stat = fs.statSync(targetPath);
        if (!stat.isDirectory()) {
            return res.status(400).json({ error: 'Path is not a directory' });
        }

        const entries = fs.readdirSync(targetPath, { withFileTypes: true });
        const items = entries.map(entry => {
            const fullPath = path.join(targetPath, entry.name);
            let size = 0;
            let modified = null;
            try {
                const s = fs.statSync(fullPath);
                size = s.size;
                modified = s.mtime.toISOString();
            } catch (e) { /* skip */ }
            return {
                name: entry.name,
                isDirectory: entry.isDirectory(),
                size,
                modified,
                path: path.relative(server.server_dir, fullPath).replace(/\\/g, '/'),
            };
        });

        // Sort: directories first, then alphabetical
        items.sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

        res.json({
            currentPath: (req.query.path || '').replace(/\\/g, '/'),
            items,
        });
    } catch (err) {
        if (err.message.includes('path traversal')) return res.status(403).json({ error: err.message });
        res.status(500).json({ error: 'Failed to list directory' });
    }
});

// Read file
router.get('/:id/files/read', (req, res) => {
    try {
        const server = getDb().prepare('SELECT server_dir FROM servers WHERE id = ?').get(req.params.id);
        if (!server) return res.status(404).json({ error: 'Server not found' });

        const filePath = safePath(server.server_dir, req.query.path);
        if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) return res.status(400).json({ error: 'Path is a directory' });

        // Check if file is too large for editing (>5MB)
        if (stat.size > 5 * 1024 * 1024) {
            return res.status(400).json({ error: 'File too large for editing (max 5MB)' });
        }

        // Check if binary
        const ext = path.extname(filePath).toLowerCase();
        const binaryExts = ['.jar', '.zip', '.gz', '.tar', '.png', '.jpg', '.gif', '.dat', '.mca', '.nbt'];
        if (binaryExts.includes(ext)) {
            return res.status(400).json({ error: 'Cannot edit binary files', binary: true });
        }

        const content = fs.readFileSync(filePath, 'utf-8');
        res.json({ content, path: req.query.path, size: stat.size });
    } catch (err) {
        if (err.message.includes('path traversal')) return res.status(403).json({ error: err.message });
        res.status(500).json({ error: 'Failed to read file' });
    }
});

// Write/edit file
router.put('/:id/files/write', (req, res) => {
    try {
        const server = getDb().prepare('SELECT server_dir FROM servers WHERE id = ?').get(req.params.id);
        if (!server) return res.status(404).json({ error: 'Server not found' });

        const filePath = safePath(server.server_dir, req.body.path);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        fs.writeFileSync(filePath, req.body.content || '');
        res.json({ message: 'File saved successfully' });
    } catch (err) {
        if (err.message.includes('path traversal')) return res.status(403).json({ error: err.message });
        res.status(500).json({ error: 'Failed to save file' });
    }
});

// Upload file
router.post('/:id/files/upload', upload.array('files', 20), (req, res) => {
    try {
        const server = getDb().prepare('SELECT server_dir FROM servers WHERE id = ?').get(req.params.id);
        if (!server) return res.status(404).json({ error: 'Server not found' });

        const targetDir = safePath(server.server_dir, req.body.path || '');
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

        const uploaded = [];
        for (const file of req.files) {
            const destPath = path.join(targetDir, file.originalname);
            fs.copyFileSync(file.path, destPath);
            fs.unlinkSync(file.path); // Clean up temp file
            uploaded.push(file.originalname);
        }

        res.json({ message: `Uploaded ${uploaded.length} file(s)`, files: uploaded });
    } catch (err) {
        if (err.message.includes('path traversal')) return res.status(403).json({ error: err.message });
        res.status(500).json({ error: 'Failed to upload files' });
    }
});

// Delete file/folder
router.delete('/:id/files', (req, res) => {
    try {
        const server = getDb().prepare('SELECT server_dir FROM servers WHERE id = ?').get(req.params.id);
        if (!server) return res.status(404).json({ error: 'Server not found' });

        const targetPath = safePath(server.server_dir, req.query.path);
        if (!fs.existsSync(targetPath)) return res.status(404).json({ error: 'Path not found' });

        // Prevent deleting server root
        if (path.resolve(targetPath) === path.resolve(server.server_dir)) {
            return res.status(403).json({ error: 'Cannot delete server root directory' });
        }

        const stat = fs.statSync(targetPath);
        if (stat.isDirectory()) {
            fs.rmSync(targetPath, { recursive: true, force: true });
        } else {
            fs.unlinkSync(targetPath);
        }

        res.json({ message: 'Deleted successfully' });
    } catch (err) {
        if (err.message.includes('path traversal')) return res.status(403).json({ error: err.message });
        res.status(500).json({ error: 'Failed to delete' });
    }
});

// Rename
router.post('/:id/files/rename', (req, res) => {
    try {
        const server = getDb().prepare('SELECT server_dir FROM servers WHERE id = ?').get(req.params.id);
        if (!server) return res.status(404).json({ error: 'Server not found' });

        const oldPath = safePath(server.server_dir, req.body.oldPath);
        const newPath = safePath(server.server_dir, req.body.newPath);

        if (!fs.existsSync(oldPath)) return res.status(404).json({ error: 'Source not found' });
        fs.renameSync(oldPath, newPath);
        res.json({ message: 'Renamed successfully' });
    } catch (err) {
        if (err.message.includes('path traversal')) return res.status(403).json({ error: err.message });
        res.status(500).json({ error: 'Failed to rename' });
    }
});

// Create folder
router.post('/:id/files/mkdir', (req, res) => {
    try {
        const server = getDb().prepare('SELECT server_dir FROM servers WHERE id = ?').get(req.params.id);
        if (!server) return res.status(404).json({ error: 'Server not found' });

        const targetPath = safePath(server.server_dir, req.body.path);
        fs.mkdirSync(targetPath, { recursive: true });
        res.json({ message: 'Folder created' });
    } catch (err) {
        if (err.message.includes('path traversal')) return res.status(403).json({ error: err.message });
        res.status(500).json({ error: 'Failed to create folder' });
    }
});

// Download file
router.get('/:id/files/download', (req, res) => {
    try {
        const server = getDb().prepare('SELECT server_dir FROM servers WHERE id = ?').get(req.params.id);
        if (!server) return res.status(404).json({ error: 'Server not found' });

        const filePath = safePath(server.server_dir, req.query.path);
        if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) return res.status(400).json({ error: 'Cannot download a directory' });

        res.download(filePath);
    } catch (err) {
        if (err.message.includes('path traversal')) return res.status(403).json({ error: err.message });
        res.status(500).json({ error: 'Failed to download file' });
    }
});

module.exports = router;
