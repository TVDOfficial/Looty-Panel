const cron = require('node-cron');
const { getDb } = require('../database');
const serverManager = require('./serverManager');
const backupManager = require('./backupManager');
const logger = require('../utils/logger');

// Active cron jobs: Map<scheduleId, CronTask>
const activeJobs = new Map();

function loadSchedules() {
    const schedules = getDb().prepare('SELECT * FROM schedules WHERE enabled = 1').all();
    for (const schedule of schedules) {
        registerJob(schedule);
    }
    logger.info('SCHEDULER', `Loaded ${schedules.length} scheduled tasks`);
}

function registerJob(schedule) {
    // Remove existing job for this schedule
    if (activeJobs.has(schedule.id)) {
        activeJobs.get(schedule.id).stop();
        activeJobs.delete(schedule.id);
    }

    if (!cron.validate(schedule.cron_expression)) {
        logger.warn('SCHEDULER', `Invalid cron expression for schedule ${schedule.id}: ${schedule.cron_expression}`);
        return;
    }

    const task = cron.schedule(schedule.cron_expression, async () => {
        logger.info('SCHEDULER', `Executing scheduled task: ${schedule.name} (${schedule.type})`);
        try {
            await executeTask(schedule);
            getDb().prepare('UPDATE schedules SET last_run = datetime(\'now\') WHERE id = ?').run(schedule.id);
        } catch (err) {
            logger.error('SCHEDULER', `Failed to execute task ${schedule.name}`, err.message);
        }
    });

    activeJobs.set(schedule.id, task);
}

async function executeTask(schedule) {
    const payload = schedule.payload ? JSON.parse(schedule.payload) : {};

    switch (schedule.type) {
        case 'restart': {
            const server = getDb().prepare('SELECT name FROM servers WHERE id = ?').get(schedule.server_id);
            await serverManager.restartServer(schedule.server_id);
            const alertService = require('./alertService');
            alertService.notifyRestart(server?.name || 'Server', schedule.server_id, `Scheduled: ${schedule.name}`).catch(() => {});
            break;
        }
        case 'backup':
            await backupManager.createBackup(schedule.server_id, `Scheduled backup: ${schedule.name}`);
            break;
        case 'command':
            serverManager.sendCommand(schedule.server_id, payload.command || 'say Scheduled command');
            break;
        case 'message':
            serverManager.sendCommand(schedule.server_id, `say ${payload.message || 'Scheduled message'}`);
            break;
        default:
            logger.warn('SCHEDULER', `Unknown task type: ${schedule.type}`);
    }
}

function createSchedule(data) {
    if (!cron.validate(data.cron_expression)) {
        throw new Error('Invalid cron expression');
    }

    const result = getDb().prepare(
        'INSERT INTO schedules (server_id, name, type, cron_expression, payload, enabled) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
        data.server_id, data.name, data.type, data.cron_expression,
        data.payload ? JSON.stringify(data.payload) : null,
        data.enabled !== false ? 1 : 0
    );

    const schedule = getDb().prepare('SELECT * FROM schedules WHERE id = ?').get(result.lastInsertRowid);
    if (schedule.enabled) registerJob(schedule);
    return schedule;
}

function updateSchedule(id, data) {
    const existing = getDb().prepare('SELECT * FROM schedules WHERE id = ?').get(id);
    if (!existing) throw new Error('Schedule not found');

    if (data.cron_expression && !cron.validate(data.cron_expression)) {
        throw new Error('Invalid cron expression');
    }

    getDb().prepare(
        'UPDATE schedules SET name = ?, type = ?, cron_expression = ?, payload = ?, enabled = ? WHERE id = ?'
    ).run(
        data.name || existing.name,
        data.type || existing.type,
        data.cron_expression || existing.cron_expression,
        data.payload ? JSON.stringify(data.payload) : existing.payload,
        data.enabled !== undefined ? (data.enabled ? 1 : 0) : existing.enabled,
        id
    );

    // Refresh job
    const updated = getDb().prepare('SELECT * FROM schedules WHERE id = ?').get(id);
    if (updated.enabled) {
        registerJob(updated);
    } else if (activeJobs.has(id)) {
        activeJobs.get(id).stop();
        activeJobs.delete(id);
    }

    return updated;
}

function deleteSchedule(id) {
    if (activeJobs.has(id)) {
        activeJobs.get(id).stop();
        activeJobs.delete(id);
    }
    getDb().prepare('DELETE FROM schedules WHERE id = ?').run(id);
}

function getSchedules(serverId) {
    return getDb().prepare('SELECT * FROM schedules WHERE server_id = ? ORDER BY created_at DESC').all(serverId);
}

function stopAll() {
    for (const [id, task] of activeJobs) {
        task.stop();
    }
    activeJobs.clear();
}

module.exports = { loadSchedules, createSchedule, updateSchedule, deleteSchedule, getSchedules, stopAll };
