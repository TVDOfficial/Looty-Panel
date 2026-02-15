/**
 * Alert service - sends Discord webhook and/or email on server events.
 * Events: server crash, backup fail, server restart (optional).
 */
const https = require('https');
const http = require('http');
const { getDb } = require('../database');
const logger = require('../utils/logger');

function getSettings() {
    const rows = getDb().prepare('SELECT key, value FROM settings WHERE key LIKE "alert_%"').all();
    const s = {};
    for (const r of rows) {
        s[r.key] = r.value;
    }
    return {
        discordWebhook: s.alert_discord_webhook || '',
        discordOnCrash: (s.alert_discord_on_crash || '1') === '1',
        discordOnBackupFail: (s.alert_discord_on_backup_fail || '1') === '1',
        discordOnRestart: (s.alert_discord_on_restart || '0') === '1',
        emailEnabled: (s.alert_email_enabled || '0') === '1',
        emailHost: s.alert_email_host || '',
        emailPort: parseInt(s.alert_email_port || '587', 10),
        emailSecure: (s.alert_email_secure || '0') === '1',
        emailUser: s.alert_email_user || '',
        emailPass: s.alert_email_pass || '',
        emailTo: s.alert_email_to || '',
        emailOnCrash: (s.alert_email_on_crash || '1') === '1',
        emailOnBackupFail: (s.alert_email_on_backup_fail || '1') === '1',
        emailOnRestart: (s.alert_email_on_restart || '0') === '1',
    };
}

function saveSetting(key, value) {
    getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value ? String(value) : '');
}

async function sendDiscord(webhookUrl, title, description, color = 0xff0000) {
    if (!webhookUrl || !webhookUrl.startsWith('https://discord.com/api/webhooks/')) return;

    const body = JSON.stringify({
        embeds: [{
            title,
            description,
            color,
            timestamp: new Date().toISOString(),
        }],
    });

    return new Promise((resolve) => {
        const u = new URL(webhookUrl);
        const opts = {
            hostname: u.hostname,
            port: 443,
            path: u.pathname + u.search,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        };
        const req = https.request(opts, (res) => {
            if (res.statusCode >= 200 && res.statusCode < 300) resolve();
            else resolve(new Error(`Discord webhook returned ${res.statusCode}`));
        });
        req.on('error', (err) => {
            logger.error('ALERT', 'Discord webhook failed', err.message);
            resolve(err);
        });
        req.write(body);
        req.end();
    });
}

async function sendEmail(settings, subject, body) {
    if (!settings.emailEnabled || !settings.emailHost || !settings.emailUser || !settings.emailTo) return;

    let nodemailer;
    try {
        nodemailer = require('nodemailer');
    } catch (e) {
        logger.warn('ALERT', 'nodemailer not available for email alerts');
        return;
    }

    const transporter = nodemailer.createTransport({
        host: settings.emailHost,
        port: settings.emailPort,
        secure: settings.emailSecure,
        auth: { user: settings.emailUser, pass: settings.emailPass },
    });

    try {
        await transporter.sendMail({
            from: settings.emailUser,
            to: settings.emailTo,
            subject: `[Looty Panel] ${subject}`,
            text: body,
        });
    } catch (err) {
        logger.error('ALERT', 'Email send failed', err.message);
    }
}

async function notifyCrash(serverName, serverId) {
    const s = getSettings();
    const msg = `Server **${serverName}** (ID: ${serverId}) has crashed. Auto-restart will attempt in 10 seconds if enabled.`;

    if (s.discordWebhook && s.discordOnCrash) {
        await sendDiscord(s.discordWebhook, '⚠️ Server Crashed', msg, 0xff6600);
    }
    if (s.emailEnabled && s.emailOnCrash) {
        await sendEmail(s, 'Server Crashed', msg.replace(/\*\*/g, ''));
    }
}

async function notifyBackupFail(serverName, serverId, errorMessage) {
    const s = getSettings();
    const msg = `Backup failed for server **${serverName}** (ID: ${serverId}).\nError: ${errorMessage}`;

    if (s.discordWebhook && s.discordOnBackupFail) {
        await sendDiscord(s.discordWebhook, '❌ Backup Failed', msg, 0xff0000);
    }
    if (s.emailEnabled && s.emailOnBackupFail) {
        await sendEmail(s, 'Backup Failed', msg.replace(/\*\*/g, ''));
    }
}

async function notifyRestart(serverName, serverId, reason = 'Manual or scheduled') {
    const s = getSettings();
    const msg = `Server **${serverName}** (ID: ${serverId}) has restarted. Reason: ${reason}`;

    if (s.discordWebhook && s.discordOnRestart) {
        await sendDiscord(s.discordWebhook, '🔄 Server Restarted', msg, 0x3498db);
    }
    if (s.emailEnabled && s.emailOnRestart) {
        await sendEmail(s, 'Server Restarted', msg.replace(/\*\*/g, ''));
    }
}

module.exports = {
    getSettings,
    saveSetting,
    notifyCrash,
    notifyBackupFail,
    notifyRestart,
};
