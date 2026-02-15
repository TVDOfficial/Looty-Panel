// Parse "8G", "512M", "1G" etc. to MB for percentage calculation
function parseMemoryToMb(str) {
    if (!str || typeof str !== 'string') return 0;
    const s = str.trim().toUpperCase();
    const num = parseInt(s.replace(/[^0-9]/g, ''), 10) || 0;
    if (s.endsWith('G')) return num * 1024;
    return num; // M or no suffix = MB
}

// ========== Server Dashboard Tab ==========
Pages.loadTab_dashboard = async (serverId) => {
    const container = document.getElementById('tab-dashboard');
    container.innerHTML = '<div class="loading-screen"><div class="spinner"></div></div>';

    try {
        const [server, eula, resources] = await Promise.all([
            API.get(`/servers/${serverId}`),
            API.get(`/servers/${serverId}/eula`).catch(() => ({ agreed: false })),
            API.get(`/servers/${serverId}/resources`).catch(() => ({ cpu: 0, memory: 0, uptime: 0 })),
        ]);

        const usage = resources;
        const isRunning = server.status === 'running' || server.status === 'starting';
        const memUsed = usage.memory || 0;
        const memMaxMb = parseMemoryToMb(server.memory_max);
        const memPct = memMaxMb > 0 ? Math.min(100, Math.round((memUsed / memMaxMb) * 100)) : 0;
        const memMaxDisp = server.memory_max || '-';
        const ramDisp = isRunning ? `${memUsed} MB / ${memMaxDisp}` : '—';
        const cpuDisp = isRunning ? `${usage.cpu}%` : '—';
        const uptimeDisp = isRunning ? formatUptime(usage.uptime) : '—';
        const pctDisp = isRunning ? `${memPct}%` : '—';

        let eulaHtml = '';
        if (!eula.agreed) {
            eulaHtml = `
        <div class="card mb-6 danger-zone">
          <div class="card-header"><h3>EULA Agreement</h3></div>
          <div class="card-body">
            <p class="text-muted">Minecraft servers require acceptance of the Mojang EULA. You must agree before the server will start.</p>
            <button class="btn btn-primary" id="eula-agree-btn" onclick="Pages._agreeEula(${serverId})">Agree to EULA</button>
          </div>
        </div>
      `;
        }

        container.innerHTML = `
      <div class="dashboard-overview mb-6">
        <div class="dashboard-status ${server.status === 'running' ? 'running' : 'stopped'}">
          <span class="status-dot"></span>
          <span class="status-text">${server.status.toUpperCase()}</span>
        </div>
        <div class="dashboard-meta">
          <span class="meta-item">Port <strong>${server.port}</strong></span>
          <span class="meta-item">${server.type} ${server.mc_version}</span>
          <span class="meta-item">RAM ${server.memory_min || '512M'} – ${memMaxDisp}</span>
        </div>
      </div>

      <div class="stats-grid mb-6">
        <div class="stat-card">
          <div class="stat-icon orange">🧠</div>
          <div class="stat-info">
            <h4 data-resource="ram">${ramDisp}</h4>
            <p>RAM</p>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon blue">💻</div>
          <div class="stat-info">
            <h4 data-resource="cpu">${cpuDisp}</h4>
            <p>CPU</p>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon green">⏱️</div>
          <div class="stat-info">
            <h4 data-resource="uptime">${uptimeDisp}</h4>
            <p>Uptime</p>
          </div>
        </div>
      </div>
      <div class="card mb-6">
        <div class="card-header"><h3>Resource Usage</h3></div>
        <div class="card-body">
          ${!isRunning ? '<p class="text-muted mb-4" style="font-size:13px">Start the server to see live resource usage.</p>' : ''}
          <div class="resource-row mb-4">
            <div class="resource-label">
              <span>RAM</span>
              <span class="text-muted" data-resource="ram-label">${ramDisp}</span>
            </div>
            <div class="progress-bar" style="flex:1;max-width:400px">
              <div class="progress-fill ${memPct > 80 ? 'warning' : ''}" data-resource="progress" style="width:${isRunning ? memPct : 0}%"></div>
            </div>
            <span class="resource-value" data-resource="pct">${pctDisp}</span>
          </div>
          <div class="resource-row">
            <div class="resource-label"><span>CPU</span></div>
            <span class="resource-value" data-resource="cpu-row">${cpuDisp}</span>
          </div>
          <div class="resource-row">
            <div class="resource-label"><span>Uptime</span></div>
            <span class="resource-value" data-resource="uptime-row">${uptimeDisp}</span>
          </div>
        </div>
      </div>

      <div class="card mb-6">
        <div class="card-header"><h3>Configuration</h3></div>
        <div class="card-body">
          <p class="text-muted mb-3">Edit server settings and Minecraft server.properties.</p>
          <button class="btn btn-secondary btn-sm" onclick="Pages._switchTab('configuration')">Open server.properties & Configuration →</button>
        </div>
      </div>
      ${eulaHtml}
    `;

        container.dataset.serverId = serverId;
        container.dataset.serverMaxRam = String(server.memory_max || '');

        // Refresh usage periodically when running or starting
        if (container.dataset.refresh) {
            clearInterval(parseInt(container.dataset.refresh));
        }
        if (isRunning) {
            const pollInterval = server.status === 'starting' ? 2000 : 3000;
            const interval = setInterval(() => {
                if (!document.getElementById('tab-dashboard') || !document.getElementById('tab-dashboard').classList.contains('active')) {
                    clearInterval(interval);
                    return;
                }
                API.get(`/servers/${serverId}/resources`).then(r => {
                    const c = document.getElementById('tab-dashboard');
                    if (!c) return;
                    const memMaxDisp = c.dataset.serverMaxRam || '';
                    const ramStr = r.memory + ' MB / ' + memMaxDisp;
                    const mxMb = parseMemoryToMb(memMaxDisp);
                    const pct = mxMb > 0 ? Math.min(100, Math.round((r.memory / mxMb) * 100)) : 0;
                    const prog = c.querySelector('[data-resource="progress"]');
                    if (prog) {
                        prog.style.width = pct + '%';
                        prog.classList.toggle('warning', pct > 80);
                    }
                    const update = (sel, val) => { const el = c.querySelector(sel); if (el) el.textContent = val; };
                    update('[data-resource="ram"]', ramStr);
                    update('[data-resource="ram-label"]', ramStr);
                    update('[data-resource="cpu"]', r.cpu + '%');
                    update('[data-resource="cpu-row"]', r.cpu + '%');
                    update('[data-resource="uptime"]', formatUptime(r.uptime));
                    update('[data-resource="uptime-row"]', formatUptime(r.uptime));
                    update('[data-resource="pct"]', pct + '%');
                }).catch(() => {});
            }, pollInterval);
            container.dataset.refresh = interval;
        }
    } catch (err) {
        container.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    }
};

Pages._switchTab = (tabName) => {
    const tab = document.querySelector(`#server-tabs .tab[data-tab="${tabName}"]`);
    if (tab) tab.click();
};

Pages._agreeEula = async (serverId) => {
    const btn = document.getElementById('eula-agree-btn');
    if (btn) btn.disabled = true;
    try {
        await API.post(`/servers/${serverId}/eula`);
        Toast.success('EULA accepted');
        Pages.loadTab_dashboard(serverId);
    } catch (e) {
        Toast.error(e.message);
        if (btn) btn.disabled = false;
    }
};

// ========== Plugins Tab ==========
Pages.loadTab_plugins = async (serverId) => {
    const container = document.getElementById('tab-plugins');
    container.innerHTML = '<div class="loading-screen"><div class="spinner"></div></div>';

    try {
        const plugins = await API.get(`/servers/${serverId}/plugins`);
        container.innerHTML = `
      <div class="flex-between mb-4">
        <h3>Installed Plugins (${plugins.length})</h3>
        <button class="btn btn-primary btn-sm" onclick="Pages._searchPlugins(${serverId})">🔍 Search & Install</button>
      </div>
      <div id="plugin-list"></div>
    `;

        const list = document.getElementById('plugin-list');
        if (plugins.length === 0) {
            list.innerHTML = '<div class="empty-state"><div class="empty-icon">🧩</div><h3>No plugins installed</h3><p>Search and install plugins from the marketplace.</p></div>';
        } else {
            list.innerHTML = plugins.map(p => `
        <div class="plugin-card">
          <div class="plugin-icon">🧩</div>
          <div class="plugin-info">
            <h4>${p.name}</h4>
            <p>Size: ${formatBytes(p.size)} | Modified: ${new Date(p.modified).toLocaleDateString()}</p>
          </div>
          <div class="plugin-actions">
            <button class="btn btn-danger btn-sm" onclick="Pages._removePlugin(${serverId},'${p.filename}')">Remove</button>
          </div>
        </div>
      `).join('');
        }
    } catch (err) { container.innerHTML = `<div class="alert alert-error">${err.message}</div>`; }
};

Pages._removePlugin = async (serverId, filename) => {
    if (!confirm(`Remove plugin "${filename}"?`)) return;
    try {
        await API.request('DELETE', `/servers/${serverId}/plugins/${encodeURIComponent(filename)}`);
        Toast.success('Plugin removed');
        Pages.loadTab_plugins(serverId);
    } catch (e) { Toast.error(e.message); }
};

Pages._searchPlugins = (serverId) => {
    const body = `
    <div class="form-group mb-4">
      <label for="plugin-search-input" style="display:block;margin-bottom:6px;font-weight:600;color:var(--text-primary)">Search</label>
      <input type="search" id="plugin-search-input" class="plugin-search-input" placeholder="Search plugins..." style="width:100%;padding:10px 14px;background:var(--bg-input);border:1px solid var(--border-color);border-radius:var(--radius-sm);color:var(--text-primary);font-size:14px">
    </div>
    <div class="flex gap-2 mb-4" style="flex-wrap:wrap">
      <div class="form-group" style="margin-bottom:0;min-width:140px">
        <label for="plugin-source" style="display:block;margin-bottom:6px;font-weight:600;color:var(--text-primary)">Source</label>
        <select id="plugin-source" style="width:100%;padding:10px 14px;background:var(--bg-input);border:1px solid var(--border-color);border-radius:var(--radius-sm);color:var(--text-primary)">
          <option value="all">All Sources</option>
          <option value="modrinth">Modrinth</option>
          <option value="spiget">SpigotMC</option>
          <option value="bukkit">Bukkit</option>
          <option value="hangar">Hangar</option>
        </select>
      </div>
      <div style="align-self:flex-end">
        <button class="btn btn-primary" id="plugin-search-btn">Search</button>
      </div>
    </div>
    <div id="plugin-results"><div class="loading-screen"><div class="spinner"></div></div></div>
  `;
    const modal = showModal('🔍 Search Plugins', body, '', 'modal-lg');

    const doSearch = async (queryOverride) => {
        const q = queryOverride !== undefined ? queryOverride : document.getElementById('plugin-search-input').value;
        const source = document.getElementById('plugin-source').value;
        const results = document.getElementById('plugin-results');
        results.innerHTML = '<div class="loading-screen"><div class="spinner"></div></div>';
        try {
            const data = await API.get(`/servers/${serverId}/plugins/search?q=${encodeURIComponent(q)}&source=${source}`);
            let html = '';
            for (const sourceResult of data) {
                if (sourceResult.results.length === 0) continue;
                const label = sourceResult.source === 'featured' ? 'Popular Plugins' : sourceResult.source;
            html += `<p class="text-muted mb-4" style="text-transform:uppercase;font-size:11px;font-weight:700;letter-spacing:1px">${label} (${sourceResult.total} results)</p>`;
                html += sourceResult.results.map(p => `
          <div class="plugin-card mb-4">
            <div class="plugin-icon">${p.icon_url ? `<img src="${p.icon_url}" alt="">` : '🧩'}</div>
            <div class="plugin-info">
              <h4>${p.name}</h4>
              <p>${(p.description || '').substring(0, 120)}</p>
              <div class="plugin-meta">
                <span>👤 ${p.author || 'Unknown'}</span>
                <span>📥 ${(p.downloads || 0).toLocaleString()}</span>
              </div>
            </div>
            <div class="plugin-actions">
              ${p.source === 'modrinth' ? `<button class="btn btn-success btn-sm" onclick="Pages._installFromModrinth(${serverId},'${p.id}')">Install</button>` : ''}
              ${p.source === 'spiget' && !p.premium ? `<button class="btn btn-success btn-sm" onclick="Pages._installFromSpiget(${serverId},${p.id})">Install</button>` : ''}
              ${p.source === 'hangar' && p.namespace ? `<button class="btn btn-success btn-sm" onclick="Pages._installFromHangar(${serverId},'${String(p.namespace.owner||'').replace(/'/g,"\\'")}','${String(p.namespace.slug||p.id||p.name||'').replace(/'/g,"\\'")}')">Install</button>` : ''}
              ${p.page_url ? `<a href="${p.page_url}" target="_blank" class="btn btn-ghost btn-sm">View</a>` : ''}
            </div>
          </div>
        `).join('');
            }
            results.innerHTML = html || '<div class="empty-state"><p>No results found</p></div>';
        } catch (e) { results.innerHTML = `<div class="alert alert-error">${e.message}</div>`; }
    };

    document.getElementById('plugin-search-btn').onclick = () => doSearch();
    document.getElementById('plugin-search-input').onkeydown = (e) => { if (e.key === 'Enter') doSearch(); };
    doSearch('');
};

Pages._installFromModrinth = async (serverId, projectId) => {
    try {
        const versions = await API.get(`/servers/${serverId}/plugins/versions/${projectId}`);
        if (!versions.length) { Toast.error('No versions available'); return; }
        const latest = versions[0];
        const file = latest.files.find(f => f.primary) || latest.files[0];
        if (!file) { Toast.error('No file available'); return; }
        await API.post(`/servers/${serverId}/plugins/install`, { url: file.url, filename: file.filename });
        Toast.success(`Installed ${file.filename}`);
        Pages.loadTab_plugins(serverId);
    } catch (e) { Toast.error(e.message); }
};

Pages._installFromSpiget = async (serverId, resourceId) => {
    try {
        await API.post(`/servers/${serverId}/plugins/install-spiget`, { resourceId });
        Toast.success('Plugin installed');
        Pages.loadTab_plugins(serverId);
    } catch (e) {
        Toast.error(e.message);
    }
};

Pages._installFromHangar = async (serverId, author, slug) => {
    try {
        await API.post(`/servers/${serverId}/plugins/install-hangar`, { author, slug });
        Toast.success('Plugin installed');
        Pages.loadTab_plugins(serverId);
    } catch (e) { Toast.error(e.message); }
};

// ========== Backups Tab ==========
Pages.loadTab_backups = async (serverId) => {
    const container = document.getElementById('tab-backups');
    container.innerHTML = '<div class="loading-screen"><div class="spinner"></div></div>';
    try {
        const backups = await API.get(`/servers/${serverId}/backups`);
        container.innerHTML = `
      <div class="flex-between mb-4">
        <h3>Backups (${backups.length})</h3>
        <button class="btn btn-primary btn-sm" id="create-backup-btn">+ Create Backup</button>
      </div>
      <div id="backup-list"></div>
    `;
        document.getElementById('create-backup-btn').onclick = async () => {
            const btn = document.getElementById('create-backup-btn');
            btn.disabled = true; btn.textContent = 'Creating...';
            try {
                await API.post(`/servers/${serverId}/backups`, { notes: 'Manual backup' });
                Toast.success('Backup created');
                Pages.loadTab_backups(serverId);
            } catch (e) { Toast.error(e.message); btn.disabled = false; btn.textContent = '+ Create Backup'; }
        };

        const list = document.getElementById('backup-list');
        if (backups.length === 0) {
            list.innerHTML = '<div class="empty-state"><div class="empty-icon">💾</div><h3>No backups</h3><p>Create your first backup to protect your server data.</p></div>';
        } else {
            list.innerHTML = `<div class="table-container"><table>
        <thead><tr><th>Filename</th><th>Size</th><th>Date</th><th>Notes</th><th>Actions</th></tr></thead>
        <tbody>${backups.map(b => `<tr>
          <td>${b.filename}</td><td>${formatBytes(b.size)}</td>
          <td>${new Date(b.created_at).toLocaleString()}</td><td>${b.notes || '-'}</td>
          <td class="btn-group">
            <button class="btn btn-ghost btn-sm" onclick="Pages._restoreBackup(${serverId},${b.id})">Restore</button>
            <button class="btn btn-ghost btn-sm" onclick="window.open('/api/servers/${serverId}/backups/${b.id}/download','_blank')">Download</button>
            <button class="btn btn-ghost btn-sm text-danger" onclick="Pages._deleteBackup(${serverId},${b.id})">Delete</button>
          </td>
        </tr>`).join('')}</tbody></table></div>`;
        }
    } catch (err) { container.innerHTML = `<div class="alert alert-error">${err.message}</div>`; }
};

Pages._restoreBackup = async (sid, bid) => {
    if (!confirm('Restore this backup? The server will be stopped and files overwritten.')) return;
    try { await API.post(`/servers/${sid}/backups/${bid}/restore`); Toast.success('Backup restored'); } catch (e) { Toast.error(e.message); }
};
Pages._deleteBackup = async (sid, bid) => {
    if (!confirm('Delete this backup?')) return;
    try { await API.request('DELETE', `/servers/${sid}/backups/${bid}`); Toast.success('Deleted'); Pages.loadTab_backups(sid); } catch (e) { Toast.error(e.message); }
};

// ========== Schedules Tab ==========
Pages.loadTab_schedules = async (serverId) => {
    const container = document.getElementById('tab-schedules');
    container.innerHTML = '<div class="loading-screen"><div class="spinner"></div></div>';
    try {
        const schedules = await API.get(`/servers/${serverId}/schedules`);
        container.innerHTML = `
      <div class="flex-between mb-4">
        <h3>Scheduled Tasks (${schedules.length})</h3>
        <button class="btn btn-primary btn-sm" onclick="Pages._createSchedule(${serverId})">+ New Schedule</button>
      </div>
      <div id="schedule-list"></div>
    `;
        const list = document.getElementById('schedule-list');
        if (schedules.length === 0) {
            list.innerHTML = '<div class="empty-state"><div class="empty-icon">⏰</div><h3>No schedules</h3><p>Create scheduled tasks for automated backups, restarts, and more.</p></div>';
        } else {
            list.innerHTML = `<div class="table-container"><table>
        <thead><tr><th>Name</th><th>Type</th><th>Cron</th><th>Enabled</th><th>Last Run</th><th>Actions</th></tr></thead>
        <tbody>${schedules.map(s => `<tr>
          <td>${s.name}</td><td><span class="badge badge-type">${s.type}</span></td>
          <td><code>${s.cron_expression}</code></td>
          <td>${s.enabled ? '<span class="text-success">Yes</span>' : '<span class="text-muted">No</span>'}</td>
          <td>${s.last_run ? new Date(s.last_run).toLocaleString() : 'Never'}</td>
          <td><button class="btn btn-ghost btn-sm text-danger" onclick="Pages._deleteSchedule(${serverId},${s.id})">Delete</button></td>
        </tr>`).join('')}</tbody></table></div>`;
        }
    } catch (err) { container.innerHTML = `<div class="alert alert-error">${err.message}</div>`; }
};

Pages._createSchedule = (serverId) => {
    const body = `
    <div class="form-group"><label>Name</label><input type="text" id="sched-name" placeholder="Daily Backup"></div>
    <div class="grid-2">
      <div class="form-group"><label>Type</label><select id="sched-type"><option value="backup">Backup</option><option value="restart">Restart</option><option value="command">Command</option><option value="message">Broadcast Message</option></select></div>
      <div class="form-group"><label>Cron Expression</label><input type="text" id="sched-cron" placeholder="0 */6 * * *" value="0 */6 * * *"></div>
    </div>
    <div class="form-group" id="sched-payload-group" style="display:none"><label>Payload</label><input type="text" id="sched-payload" placeholder="say Hello!"></div>
    <p class="text-muted" style="font-size:11px">Cron format: minute hour day month weekday. Examples: <code>0 */6 * * *</code> (every 6h), <code>0 3 * * *</code> (daily 3am), <code>*/30 * * * *</code> (every 30min)</p>
  `;
    const footer = `<button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button><button class="btn btn-primary" id="sched-create-btn">Create</button>`;
    const modal = showModal('⏰ New Schedule', body, footer);

    document.getElementById('sched-type').onchange = () => {
        const t = document.getElementById('sched-type').value;
        document.getElementById('sched-payload-group').style.display = (t === 'command' || t === 'message') ? '' : 'none';
    };

    document.getElementById('sched-create-btn').onclick = async () => {
        const type = document.getElementById('sched-type').value;
        const payload = {};
        if (type === 'command') payload.command = document.getElementById('sched-payload').value;
        if (type === 'message') payload.message = document.getElementById('sched-payload').value;
        try {
            await API.post(`/servers/${serverId}/schedules`, {
                name: document.getElementById('sched-name').value,
                type, cron_expression: document.getElementById('sched-cron').value, payload,
            });
            Toast.success('Schedule created');
            modal.remove();
            Pages.loadTab_schedules(serverId);
        } catch (e) { Toast.error(e.message); }
    };
};

Pages._deleteSchedule = async (sid, id) => {
    if (!confirm('Delete this schedule?')) return;
    try { await API.request('DELETE', `/servers/${sid}/schedules/${id}`); Toast.success('Deleted'); Pages.loadTab_schedules(sid); } catch (e) { Toast.error(e.message); }
};

// ========== Settings Tab ==========
Pages.loadTab_settings = async (serverId) => {
    const container = document.getElementById('tab-settings');
    container.innerHTML = '<div class="loading-screen"><div class="spinner"></div></div>';
    try {
        const server = await API.get(`/servers/${serverId}`);

        container.innerHTML = `
      <div class="card mb-6">
        <div class="card-header"><h3>Server Settings</h3></div>
        <div class="card-body">
          <div class="form-group mb-4">
            <label class="flex gap-2" style="align-items:center;cursor:pointer">
              <input type="checkbox" id="cfg-autostart" ${server.auto_start ? 'checked' : ''}>
              <span>Auto-start when panel comes online</span>
            </label>
            <p class="text-muted" style="font-size:12px;margin-top:4px;margin-left:24px">This server will start automatically when the Loot Panel starts.</p>
          </div>
          <div class="form-group mb-4">
            <label class="flex gap-2" style="align-items:center;cursor:pointer">
              <input type="checkbox" id="cfg-autorestart" ${server.auto_restart ? 'checked' : ''}>
              <span>Auto-restart on crash</span>
            </label>
            <p class="text-muted" style="font-size:12px;margin-top:4px;margin-left:24px">Automatically restart the server if it crashes.</p>
          </div>
          <button class="btn btn-primary btn-sm" onclick="Pages._saveSettings(${serverId})">Save Settings</button>
        </div>
      </div>
      <div class="card mb-6">
        <div class="card-header"><h3>Advanced</h3></div>
        <div class="card-body">
          <p class="text-muted mb-4">Configure server name, port, RAM, Java path, JVM arguments, and Minecraft server.properties.</p>
          <button class="btn btn-secondary" onclick="Pages._goToConfiguration(${serverId})">Open Configuration →</button>
        </div>
      </div>
      <div class="card danger-zone">
        <div class="card-header"><h3>⚠️ Danger Zone</h3></div>
        <div class="card-body">
          <p class="text-muted">Permanently delete this server. This action cannot be undone.</p>
          <button class="btn btn-danger" data-server-id="${serverId}" data-server-name="${(server.name || '').replace(/"/g, '&quot;')}" onclick="Pages.deleteServerConfirm(this.dataset.serverId, this.dataset.serverName)">Delete Server</button>
        </div>
      </div>
    `;
    } catch (err) { container.innerHTML = `<div class="alert alert-error">${err.message}</div>`; }
};

Pages._saveSettings = async (serverId) => {
    try {
        await API.put(`/servers/${serverId}`, {
            auto_start: document.getElementById('cfg-autostart').checked ? 1 : 0,
            auto_restart: document.getElementById('cfg-autorestart').checked ? 1 : 0,
        });
        Toast.success('Settings saved');
    } catch (e) { Toast.error(e.message); }
};

Pages._goToConfiguration = (serverId) => {
    document.querySelectorAll('#server-tabs .tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const configTab = document.querySelector('#server-tabs .tab[data-tab="configuration"]');
    const configContent = document.getElementById('tab-configuration');
    if (configTab && configContent) {
        configTab.classList.add('active');
        configContent.classList.add('active');
        Pages.loadTab_configuration(serverId);
    }
};

// ========== Configuration Tab (full server config + server.properties) ==========
Pages.loadTab_configuration = async (serverId) => {
    const container = document.getElementById('tab-configuration');
    container.innerHTML = '<div class="loading-screen"><div class="spinner"></div></div>';
    try {
        const [server, props] = await Promise.all([
            API.get(`/servers/${serverId}`),
            API.get(`/servers/${serverId}/properties`),
        ]);

        container.innerHTML = `
      <div class="card mb-6">
        <div class="card-header"><h3>Server Configuration</h3></div>
        <div class="card-body">
          <div class="properties-grid">
            <div class="property-item"><label>Server Name</label><input type="text" id="cfg-name" value="${server.name}"></div>
            <div class="property-item"><label>Port</label><input type="number" id="cfg-port" value="${server.port}"></div>
            <div class="property-item"><label>Min RAM</label><input type="text" id="cfg-minram" value="${server.memory_min}"></div>
            <div class="property-item"><label>Max RAM</label><input type="text" id="cfg-maxram" value="${server.memory_max}"></div>
            <div class="property-item"><label>Java Path</label><input type="text" id="cfg-java" value="${server.java_path}"></div>
            <div class="property-item"><label>JVM Args</label><input type="text" id="cfg-jvm" value="${server.jvm_args || ''}"></div>
          </div>
        </div>
        <div class="card-footer"><button class="btn btn-primary btn-sm" onclick="Pages._saveConfig(${serverId})">Save Configuration</button></div>
      </div>
      <div class="card">
        <div class="card-header"><h3>server.properties</h3></div>
        <div class="card-body">
          <div class="properties-grid" id="props-grid">
            ${Object.entries(props).map(([k, v]) => `<div class="property-item"><label>${k}</label><input type="text" data-prop="${k}" value="${v}"></div>`).join('')}
          </div>
        </div>
        <div class="card-footer"><button class="btn btn-primary btn-sm" onclick="Pages._saveProps(${serverId})">Save Properties</button></div>
      </div>
    `;
    } catch (err) { container.innerHTML = `<div class="alert alert-error">${err.message}</div>`; }
};

Pages._saveConfig = async (sid) => {
    try {
        await API.put(`/servers/${sid}`, {
            name: document.getElementById('cfg-name').value,
            port: parseInt(document.getElementById('cfg-port').value),
            memory_min: document.getElementById('cfg-minram').value,
            memory_max: document.getElementById('cfg-maxram').value,
            java_path: document.getElementById('cfg-java').value,
            jvm_args: document.getElementById('cfg-jvm').value,
        });
        Toast.success('Configuration saved');
    } catch (e) { Toast.error(e.message); }
};

Pages._saveProps = async (sid) => {
    const inputs = document.querySelectorAll('#props-grid input[data-prop]');
    const props = {};
    inputs.forEach(i => props[i.dataset.prop] = i.value);
    try {
        await API.put(`/servers/${sid}/properties`, props);
        Toast.success('Properties saved');
    } catch (e) { Toast.error(e.message); }
};
