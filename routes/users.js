const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../database');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();
router.use(authMiddleware);
router.use(adminOnly);

// List users
router.get('/', (req, res) => {
    try {
        const users = getDb().prepare('SELECT id, username, role, created_at, updated_at FROM users ORDER BY created_at DESC').all();
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: 'Failed to list users' });
    }
});

// Create user
router.post('/', (req, res) => {
    try {
        const { username, password, role } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
        if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

        const existing = getDb().prepare('SELECT id FROM users WHERE username = ?').get(username);
        if (existing) return res.status(409).json({ error: 'Username already exists' });

        const hash = bcrypt.hashSync(password, 10);
        const result = getDb().prepare(
            'INSERT INTO users (username, password_hash, role, must_change_password) VALUES (?, ?, ?, ?)'
        ).run(username, hash, role || 'user', 1);

        getDb().prepare('INSERT INTO audit_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)').run(
            req.user.id, 'user_create', `Created user: ${username}`, req.ip
        );

        res.status(201).json({ id: result.lastInsertRowid, username, role: role || 'user' });
    } catch (err) {
        logger.error('ROUTE', 'Create user error', err.message);
        res.status(500).json({ error: 'Failed to create user' });
    }
});

// Update user
router.put('/:id', (req, res) => {
    try {
        const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const { role, password } = req.body;

        if (password) {
            if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
            const hash = bcrypt.hashSync(password, 10);
            getDb().prepare('UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = datetime(\'now\') WHERE id = ?').run(hash, req.params.id);
        }

        if (role && ['admin', 'user'].includes(role)) {
            getDb().prepare('UPDATE users SET role = ?, updated_at = datetime(\'now\') WHERE id = ?').run(role, req.params.id);
        }

        res.json({ message: 'User updated' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update user' });
    }
});

// Delete user
router.delete('/:id', (req, res) => {
    try {
        if (parseInt(req.params.id) === req.user.id) {
            return res.status(400).json({ error: 'Cannot delete your own account' });
        }

        const user = getDb().prepare('SELECT username FROM users WHERE id = ?').get(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });

        getDb().prepare('DELETE FROM users WHERE id = ?').run(req.params.id);

        getDb().prepare('INSERT INTO audit_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)').run(
            req.user.id, 'user_delete', `Deleted user: ${user.username}`, req.ip
        );

        res.json({ message: 'User deleted' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

module.exports = router;
