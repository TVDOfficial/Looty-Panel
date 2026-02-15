const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../database');
const { authMiddleware, generateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Check setup status
router.get('/setup-status', (req, res) => {
    try {
        const userCount = getDb().prepare('SELECT COUNT(*) as count FROM users').get().count;
        res.json({ requiresSetup: userCount === 0 });
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

// Setup admin user
router.post('/setup', (req, res) => {
    try {
        const userCount = getDb().prepare('SELECT COUNT(*) as count FROM users').get().count;
        if (userCount > 0) {
            return res.status(403).json({ error: 'Setup already completed' });
        }

        const { username, password } = req.body;
        if (!username || !password || password.length < 6) {
            return res.status(400).json({ error: 'Invalid username or password (min 6 chars)' });
        }

        const hash = bcrypt.hashSync(password, 10);
        getDb().prepare(
            'INSERT INTO users (username, password_hash, role, must_change_password) VALUES (?, ?, ?, ?)'
        ).run(username, hash, 'admin', 0); // No need to change password since they just set it

        const newUser = getDb().prepare('SELECT id FROM users WHERE username = ?').get(username);
        if (!newUser) {
            logger.error('AUTH', 'Setup: User was not found after insert');
            return res.status(500).json({ error: 'Setup failed' });
        }

        const token = generateToken(newUser.id);

        // Log
        getDb().prepare('INSERT INTO audit_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)').run(
            newUser.id, 'setup', 'Initial admin setup completed', req.ip
        );

        res.json({
            token,
            user: {
                id: newUser.id,
                username,
                role: 'admin',
                mustChangePassword: false,
            }
        });
    } catch (err) {
        logger.error('AUTH', 'Setup error', err.message);
        res.status(500).json({ error: 'Setup failed' });
    }
});

// Login
router.post('/login', (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        const user = getDb().prepare('SELECT * FROM users WHERE username = ?').get(username);
        if (!user || !bcrypt.compareSync(password, user.password_hash)) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = generateToken(user.id);

        // Audit log
        getDb().prepare('INSERT INTO audit_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)').run(
            user.id, 'login', 'User logged in', req.ip
        );

        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                mustChangePassword: !!user.must_change_password,
            },
        });
    } catch (err) {
        logger.error('AUTH', 'Login error', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get current user
router.get('/me', authMiddleware, (req, res) => {
    res.json({
        id: req.user.id,
        username: req.user.username,
        role: req.user.role,
        mustChangePassword: !!req.user.must_change_password,
    });
});

// Change password
router.put('/password', authMiddleware, (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({ error: 'New password must be at least 6 characters' });
        }

        const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

        // If must change password (first login), skip current password check
        if (!user.must_change_password) {
            if (!currentPassword || !bcrypt.compareSync(currentPassword, user.password_hash)) {
                return res.status(401).json({ error: 'Current password is incorrect' });
            }
        }

        const hash = bcrypt.hashSync(newPassword, 10);
        getDb().prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime(\'now\') WHERE id = ?').run(hash, req.user.id);

        getDb().prepare('INSERT INTO audit_log (user_id, action, ip_address) VALUES (?, ?, ?)').run(
            req.user.id, 'password_change', req.ip
        );

        res.json({ message: 'Password changed successfully' });
    } catch (err) {
        logger.error('AUTH', 'Password change error', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
