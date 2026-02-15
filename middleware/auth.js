const jwt = require('jsonwebtoken');
const config = require('../config');
const { getDb } = require('../database');
const logger = require('../utils/logger');

function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        logger.warn('AUTH', `401 on ${req.method} ${req.originalUrl}: Missing or invalid Authorization header`);
        return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, config.JWT_SECRET);
        const user = getDb().prepare('SELECT id, username, role, must_change_password FROM users WHERE id = ?').get(decoded.userId);
        if (!user) {
            logger.warn('AUTH', `401 on ${req.method} ${req.originalUrl}: User ${decoded.userId} not found`);
            return res.status(401).json({ error: 'User not found' });
        }
        req.user = user;
        next();
    } catch (err) {
        logger.warn('AUTH', `401 on ${req.method} ${req.originalUrl}: ${err.message}`);
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

function adminOnly(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
}

function generateToken(userId) {
    return jwt.sign({ userId }, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRY });
}

module.exports = { authMiddleware, adminOnly, generateToken };
