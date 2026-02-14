// ========== Server Detail Page ==========
Pages.serverDetail = async (el, serverId, actions) => {
    if (!serverId) { el.innerHTML = '<div class="alert alert-error">No server selected</div>'; return; }
    el.innerHTML = '<div class="loading-screen"><div class="spinner spinner-lg"></div></div>';

    try {
        const server = await API.get(`/servers/${serverId}`);
        document.getElementById('page-title').textContent = server.name;

        actions.innerHTML = `
      ${server.status === 'stopped' ? `<button class="btn btn-success btn-sm" onclick="Pages.startServer(${serverId})">▶ Start</button>` : ''}
      ${server.status === 'running' ? `<button class="btn btn-warning btn-sm" onclick="Pages.restartServer(${serverId})">🔄 Restart</button>` : ''}
      ${server.status === 'running' ? `<button class="btn btn-danger btn-sm" onclick="Pages.stopServer(${serverId})">⏹ Stop</button>` : ''}
      <button class="btn btn-secondary btn-sm" onclick="Pages.deleteServerConfirm(${serverId}, '${server.name}')">🗑️</button>
    `;

        el.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-icon ${server.status === 'running' ? 'green' : 'red'}">${server.status === 'running' ? '✅' : '⛔'}</div><div class="stat-info"><h4>${server.status}</h4><p>Status</p></div></div>
        <div class="stat-card"><div class="stat-icon purple">🔌</div><div class="stat-info"><h4>${server.port}</h4><p>Port</p></div></div>
        <div class="stat-card"><div class="stat-icon blue">🧠</div><div class="stat-info"><h4>${server.memory_max}</h4><p>Max RAM</p></div></div>
        <div class="stat-card"><div class="stat-icon orange">📦</div><div class="stat-info"><h4>${server.type} ${server.mc_version}</h4><p>Version</p></div></div>
      </div>
      <div class="tabs" id="server-tabs">
        <button class="tab active" data-tab="console">Console</button>
        <button class="tab" data-tab="files">Files</button>
        <button class="tab" data-tab="plugins">Plugins</button>
        <button class="tab" data-tab="backups">Backups</button>
        <button class="tab" data-tab="schedules">Schedules</button>
        <button class="tab" data-tab="settings">Settings</button>
      </div>
      <div id="tab-console" class="tab-content active"></div>
      <div id="tab-files" class="tab-content"></div>
      <div id="tab-plugins" class="tab-content"></div>
      <div id="tab-backups" class="tab-content"></div>
      <div id="tab-schedules" class="tab-content"></div>
      <div id="tab-settings" class="tab-content"></div>
    `;

        // Tab switching
        document.querySelectorAll('#server-tabs .tab').forEach(tab => {
            tab.onclick = () => {
                document.querySelectorAll('#server-tabs .tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
                Pages[`loadTab_${tab.dataset.tab}`]?.(serverId);
            };
        });

        Pages.loadTab_console(serverId);
    } catch (err) { el.innerHTML = `<div class="alert alert-error">${err.message}</div>`; }
};

Pages.deleteServerConfirm = (id, name) => {
    const body = `<p>Are you sure you want to delete <strong>${name}</strong>?</p>
    <div class="form-group mt-4"><label><input type="checkbox" id="del-files"> Also delete all server files</label></div>`;
    const footer = `<button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
    <button class="btn btn-danger" id="del-confirm">Delete Server</button>`;
    const modal = showModal('🗑️ Delete Server', body, footer);
    document.getElementById('del-confirm').onclick = async () => {
        const delFiles = document.getElementById('del-files').checked;
        try {
            await API.request('DELETE', `/servers/${id}?deleteFiles=${delFiles}`);
            Toast.success('Server deleted');
            modal.remove();
            location.hash = 'servers';
        } catch (e) { Toast.error(e.message); }
    };
};

// --- Console Tab ---
Pages.loadTab_console = (serverId) => {
    const container = document.getElementById('tab-console');
    container.innerHTML = `
    <div class="console-container">
      <div class="console-output" id="console-output"></div>
      <div class="console-input-container">
        <span>&gt;</span>
        <input type="text" id="console-input" placeholder="Type a command..." autocomplete="off">
      </div>
    </div>
  `;

    const output = document.getElementById('console-output');
    const input = document.getElementById('console-input');

    // Load existing buffer
    API.get(`/servers/${serverId}/console`).then(data => {
        if (data.lines) data.lines.forEach(line => appendConsoleLine(output, line));
        output.scrollTop = output.scrollHeight;
    }).catch(() => { });

    // WebSocket
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}/?token=${API.token}&serverId=${serverId}`);
    App.ws = ws;

    ws.onmessage = (e) => {
        try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'console') {
                appendConsoleLine(output, msg.line);
                output.scrollTop = output.scrollHeight;
            } else if (msg.type === 'buffer' && msg.lines) {
                output.innerHTML = '';
                msg.lines.forEach(line => appendConsoleLine(output, line));
                output.scrollTop = output.scrollHeight;
            }
        } catch { }
    };

    input.onkeydown = (e) => {
        if (e.key === 'Enter' && input.value.trim()) {
            const cmd = input.value.trim();
            ws.send(JSON.stringify({ type: 'command', command: cmd }));
            appendConsoleLine(output, `> ${cmd}`);
            output.scrollTop = output.scrollHeight;
            input.value = '';
        }
    };
};

function appendConsoleLine(output, line) {
    const div = document.createElement('div');
    let cls = '';
    if (line.includes('[Loot Panel]')) cls = 'line-mcpanel';
    else if (line.includes('WARN') || line.includes('WARNING')) cls = 'line-warn';
    else if (line.includes('ERROR') || line.includes('SEVERE') || line.includes('[STDERR]')) cls = 'line-error';
    else if (line.includes('INFO')) cls = 'line-info';
    if (cls) div.className = cls;
    div.textContent = line;
    output.appendChild(div);
}

// --- Files Tab ---
Pages.loadTab_files = async (serverId) => {
    const container = document.getElementById('tab-files');
    container.innerHTML = '<div class="loading-screen"><div class="spinner"></div></div>';

    Pages._fileState = { serverId, currentPath: '' };

    const renderFiles = async (filePath) => {
        Pages._fileState.currentPath = filePath || '';
        try {
            const data = await API.get(`/servers/${serverId}/files?path=${encodeURIComponent(filePath || '')}`);
            const pathParts = (filePath || '').split('/').filter(Boolean);

            let breadcrumb = '<span onclick="Pages._navFile(\'\')">Root</span>';
            let accumulated = '';
            for (const part of pathParts) {
                accumulated += (accumulated ? '/' : '') + part;
                const p = accumulated;
                breadcrumb += `<span class="separator">/</span><span onclick="Pages._navFile('${p}')">${part}</span>`;
            }

            container.innerHTML = `
        <div class="flex-between mb-4">
          <div class="btn-group">
            <button class="btn btn-secondary btn-sm" onclick="Pages._uploadFile()">📤 Upload</button>
            <button class="btn btn-secondary btn-sm" onclick="Pages._newFolder()">📁 New Folder</button>
          </div>
        </div>
        <div class="file-manager">
          <div class="file-tree">
            <div class="file-breadcrumb">${breadcrumb}</div>
            <div id="file-list"></div>
          </div>
        </div>
      `;

            const list = document.getElementById('file-list');
            if (filePath) {
                const parent = filePath.split('/').slice(0, -1).join('/');
                list.innerHTML = `<div class="file-item" onclick="Pages._navFile('${parent}')"><span class="file-icon">⬆️</span><span class="file-name">..</span></div>`;
            } else {
                list.innerHTML = '';
            }

            data.items.forEach(item => {
                const div = document.createElement('div');
                div.className = 'file-item';
                div.innerHTML = `
          <span class="file-icon">${fileIcon(item.name, item.isDirectory)}</span>
          <span class="file-name">${item.name}</span>
          <span class="file-size">${item.isDirectory ? '' : formatBytes(item.size)}</span>
          <div class="file-actions">
            ${!item.isDirectory ? `<button class="btn-icon" title="Edit" onclick="event.stopPropagation();Pages._editFile('${item.path}')" style="font-size:14px">✏️</button>` : ''}
            ${!item.isDirectory ? `<button class="btn-icon" title="Download" onclick="event.stopPropagation();Pages._downloadFile(${serverId},'${item.path}')" style="font-size:14px">⬇️</button>` : ''}
            <button class="btn-icon" title="Delete" onclick="event.stopPropagation();Pages._deleteFile('${item.path}','${item.name}')" style="font-size:14px">🗑️</button>
          </div>
        `;
                if (item.isDirectory) {
                    div.onclick = () => Pages._navFile(item.path);
                } else {
                    div.onclick = () => Pages._editFile(item.path);
                }
                list.appendChild(div);
            });
        } catch (err) { container.innerHTML = `<div class="alert alert-error">${err.message}</div>`; }
    };

    Pages._navFile = (p) => renderFiles(p);
    Pages._editFile = async (filePath) => {
        try {
            const data = await API.get(`/servers/${serverId}/files/read?path=${encodeURIComponent(filePath)}`);
            const body = `<p class="text-muted mb-4">${filePath}</p><textarea class="code-editor" id="edit-content" style="min-height:350px">${data.content.replace(/</g, '&lt;')}</textarea>`;
            const footer = `<button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button><button class="btn btn-primary" id="save-file-btn">Save</button>`;
            const modal = showModal('✏️ Edit File', body, footer, 'modal-lg');
            document.getElementById('save-file-btn').onclick = async () => {
                try {
                    await API.put(`/servers/${serverId}/files/write`, { path: filePath, content: document.getElementById('edit-content').value });
                    Toast.success('File saved');
                    modal.remove();
                } catch (e) { Toast.error(e.message); }
            };
        } catch (e) { Toast.error(e.message); }
    };

    Pages._deleteFile = async (filePath, name) => {
        if (!confirm(`Delete "${name}"?`)) return;
        try {
            await API.request('DELETE', `/servers/${serverId}/files?path=${encodeURIComponent(filePath)}`);
            Toast.success('Deleted');
            renderFiles(Pages._fileState.currentPath);
        } catch (e) { Toast.error(e.message); }
    };

    Pages._downloadFile = (sid, fp) => {
        window.open(`/api/servers/${sid}/files/download?path=${encodeURIComponent(fp)}&token=${API.token}`, '_blank');
    };

    Pages._uploadFile = () => {
        const body = `<div class="dropzone" id="upload-zone"><div class="dropzone-icon">📤</div><p>Click or drag files here to upload</p><input type="file" id="upload-input" multiple style="display:none"></div><p class="text-muted mt-4">Upload to: /${Pages._fileState.currentPath || 'root'}</p>`;
        const modal = showModal('📤 Upload Files', body);
        const zone = document.getElementById('upload-zone');
        const input = document.getElementById('upload-input');
        zone.onclick = () => input.click();
        zone.ondragover = (e) => { e.preventDefault(); zone.classList.add('dragover'); };
        zone.ondragleave = () => zone.classList.remove('dragover');
        zone.ondrop = (e) => { e.preventDefault(); zone.classList.remove('dragover'); doUpload(e.dataTransfer.files); };
        input.onchange = () => doUpload(input.files);

        const doUpload = async (files) => {
            const fd = new FormData();
            fd.append('path', Pages._fileState.currentPath);
            for (const f of files) fd.append('files', f);
            try {
                await API.upload(`/servers/${serverId}/files/upload`, fd);
                Toast.success('Files uploaded');
                modal.remove();
                renderFiles(Pages._fileState.currentPath);
            } catch (e) { Toast.error(e.message); }
        };
    };

    Pages._newFolder = () => {
        const name = prompt('Folder name:');
        if (!name) return;
        const p = Pages._fileState.currentPath ? `${Pages._fileState.currentPath}/${name}` : name;
        API.post(`/servers/${serverId}/files/mkdir`, { path: p }).then(() => {
            Toast.success('Folder created');
            renderFiles(Pages._fileState.currentPath);
        }).catch(e => Toast.error(e.message));
    };

    renderFiles('');
};
