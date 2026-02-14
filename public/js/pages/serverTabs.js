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
    <div class="flex gap-2 mb-4">
      <input type="search" id="plugin-search-input" placeholder="Search plugins..." style="flex:1">
      <select id="plugin-source"><option value="all">All Sources</option><option value="modrinth">Modrinth</option><option value="spiget">SpigotMC</option><option value="hangar">Hangar</option></select>
      <button class="btn btn-primary btn-sm" id="plugin-search-btn">Search</button>
    </div>
    <div id="plugin-results"><div class="empty-state"><p>Search for plugins above</p></div></div>
  `;
    const modal = showModal('🔍 Search Plugins', body, '', 'modal-lg');

    const doSearch = async () => {
        const q = document.getElementById('plugin-search-input').value;
        const source = document.getElementById('plugin-source').value;
        if (!q) return;
        const results = document.getElementById('plugin-results');
        results.innerHTML = '<div class="loading-screen"><div class="spinner"></div></div>';
        try {
            const data = await API.get(`/servers/${serverId}/plugins/search?q=${encodeURIComponent(q)}&source=${source}`);
            let html = '';
            for (const sourceResult of data) {
                if (sourceResult.results.length === 0) continue;
                html += `<p class="text-muted mb-4" style="text-transform:uppercase;font-size:11px;font-weight:700;letter-spacing:1px">${sourceResult.source} (${sourceResult.total} results)</p>`;
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
              ${p.page_url ? `<a href="${p.page_url}" target="_blank" class="btn btn-ghost btn-sm">View</a>` : ''}
            </div>
          </div>
        `).join('');
            }
            results.innerHTML = html || '<div class="empty-state"><p>No results found</p></div>';
        } catch (e) { results.innerHTML = `<div class="alert alert-error">${e.message}</div>`; }
    };

    document.getElementById('plugin-search-btn').onclick = doSearch;
    document.getElementById('plugin-search-input').onkeydown = (e) => { if (e.key === 'Enter') doSearch(); };
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
          <div class="properties-grid mt-4">
            <div class="property-item"><label><input type="checkbox" id="cfg-autostart" ${server.auto_start ? 'checked' : ''}> Auto-start on panel boot</label></div>
            <div class="property-item"><label><input type="checkbox" id="cfg-autorestart" ${server.auto_restart ? 'checked' : ''}> Auto-restart on crash</label></div>
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
            auto_start: document.getElementById('cfg-autostart').checked ? 1 : 0,
            auto_restart: document.getElementById('cfg-autorestart').checked ? 1 : 0,
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
