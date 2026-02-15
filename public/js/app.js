// ========== Looty Panel SPA ==========
const App = {
    user: JSON.parse(localStorage.getItem('mcpanel_user') || 'null'),
    currentPage: null,
    ws: null,
    currentServerId: null,

    init() {
        this.bindEvents();
        this.initPasswordToggles();
        if (this.user && API.token) {
            this.showApp();
        } else {
            this.checkStatus();
        }
        window.addEventListener('hashchange', () => this.route());
    },

    initPasswordToggles() {
        document.querySelectorAll('.password-toggle').forEach(btn => {
            btn.addEventListener('click', () => {
                const input = btn.previousElementSibling;
                if (input.type === 'password') {
                    input.type = 'text';
                    btn.textContent = '🙈';
                    btn.title = 'Hide Password';
                } else {
                    input.type = 'password';
                    btn.textContent = '👁️';
                    btn.title = 'Show Password';
                }
            });
        });
    },

    async checkStatus() {
        try {
            const status = await API.get('/auth/setup-status');
            if (status.requiresSetup) {
                document.getElementById('setup-screen').style.display = 'flex';
                document.getElementById('login-screen').style.display = 'none';
                document.getElementById('app').style.display = 'none';
            } else {
                this.showLogin();
            }
        } catch (e) {
            console.error('Failed to check status', e);
            this.showLogin();
        }
    },

    showLogin() {
        document.getElementById('setup-screen').style.display = 'none';
        document.getElementById('login-screen').style.display = 'flex';
        document.getElementById('app').style.display = 'none';
    },

    showApp() {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app').style.display = 'flex';
        document.getElementById('user-name').textContent = this.user.username;
        document.getElementById('user-role').textContent = this.user.role === 'admin' ? 'Administrator' : 'User';
        document.getElementById('user-avatar').textContent = this.user.username[0].toUpperCase();
        document.getElementById('nav-users').style.display = this.user.role === 'admin' ? '' : 'none';
        if (this.user.mustChangePassword) {
            document.getElementById('password-modal').style.display = 'flex';
        } else {
            this.route();
        }
    },

    bindEvents() {
        // Login
        document.getElementById('login-form').onsubmit = async (e) => {
            e.preventDefault();
            const errEl = document.getElementById('login-error');
            errEl.style.display = 'none';
            const btn = document.getElementById('login-btn');
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span>';
            try {
                const data = await API.post('/auth/login', {
                    username: document.getElementById('login-username').value,
                    password: document.getElementById('login-password').value,
                });
                API.setToken(data.token);
                this.user = data.user;
                localStorage.setItem('mcpanel_user', JSON.stringify(data.user));
                this.showApp();
            } catch (err) {
                errEl.textContent = err.message;
                errEl.style.display = 'block';
            }
            btn.disabled = false;
            btn.innerHTML = '<span>Sign In</span>';
        };

        // Setup
        const setupForm = document.getElementById('setup-form');
        if (setupForm) {
            setupForm.onsubmit = async (e) => {
                e.preventDefault();
                const username = document.getElementById('setup-username').value;
                const password = document.getElementById('setup-password').value;
                const confirm = document.getElementById('setup-password-confirm').value;
                const btn = document.getElementById('setup-btn');

                if (password !== confirm) {
                    Toast.error('Passwords do not match');
                    return;
                }

                btn.disabled = true;
                btn.textContent = 'Creating Account...';

                try {
                    const data = await API.post('/auth/setup', { username, password });
                    API.setToken(data.token);
                    this.user = data.user;
                    localStorage.setItem('mcpanel_user', JSON.stringify(data.user));

                    document.getElementById('setup-screen').style.display = 'none';
                    Toast.success('Admin account created!');
                    this.showApp();
                } catch (err) {
                    Toast.error(err.message);
                    btn.disabled = false;
                    btn.textContent = 'Create Admin Account';
                }
            };
        }

        // Password change
        document.getElementById('password-form').onsubmit = async (e) => {
            e.preventDefault();
            const errEl = document.getElementById('password-error');
            const np = document.getElementById('new-password').value;
            const cp = document.getElementById('confirm-password').value;
            if (np !== cp) { errEl.textContent = 'Passwords do not match'; errEl.style.display = 'block'; return; }
            try {
                await API.put('/auth/password', { newPassword: np });
                this.user.mustChangePassword = false;
                localStorage.setItem('mcpanel_user', JSON.stringify(this.user));
                document.getElementById('password-modal').style.display = 'none';
                Toast.success('Password changed successfully');
                this.route();
            } catch (err) { errEl.textContent = err.message; errEl.style.display = 'block'; }
        };

        // Logout
        document.getElementById('logout-btn').onclick = () => {
            API.clearToken();
            this.user = null;
            if (this.ws) this.ws.close();
            this.showLogin();
        };

        // Sidebar toggle
        document.getElementById('sidebar-toggle').onclick = () => {
            document.getElementById('sidebar').classList.toggle('open');
        };
        // Close sidebar when overlay clicked (mobile)
        const overlay = document.getElementById('sidebar-overlay');
        if (overlay) overlay.onclick = () => document.getElementById('sidebar').classList.remove('open');

        // Nav items
        document.querySelectorAll('.nav-item').forEach(item => {
            item.onclick = (e) => {
                e.preventDefault();
                const page = item.dataset.page;
                if (page) window.location.hash = page;
            };
        });
    },

    route() {
        const hash = window.location.hash.slice(1) || 'dashboard';
        const parts = hash.split('/');
        const page = parts[0];
        const param = parts[1];
        const subParam = parts[2]; // e.g. 'configuration' for #server/1/configuration

        // Update nav
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        const activeNav = document.querySelector(`.nav-item[data-page="${page}"]`) ||
            document.querySelector(`.nav-item[data-page="servers"]`);
        if (activeNav) activeNav.classList.add('active');

        // Close mobile sidebar
        document.getElementById('sidebar').classList.remove('open');

        // Route
        const content = document.getElementById('content-area');
        const title = document.getElementById('page-title');
        const actions = document.getElementById('top-bar-actions');
        actions.innerHTML = '';

        if (this.ws) { this.ws.close(); this.ws = null; }

        switch (page) {
            case 'dashboard': title.textContent = 'Dashboard'; Pages.dashboard(content); break;
            case 'servers': title.textContent = 'Servers'; Pages.servers(content, actions); break;
            case 'server': title.textContent = 'Server'; Pages.serverDetail(content, param, actions, subParam); break;
            case 'users': title.textContent = 'User Management'; Pages.users(content, actions); break;
            case 'settings': title.textContent = 'Settings'; Pages.settings(content); break;
            default: title.textContent = 'Dashboard'; Pages.dashboard(content); break;
        }
    },
};

// Toast notifications
const Toast = {
    show(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    },
    success(msg) { this.show(msg, 'success'); },
    error(msg) { this.show(msg, 'error'); },
    warning(msg) { this.show(msg, 'warning'); },
    info(msg) { this.show(msg, 'info'); },
};

// Helper
function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatUptime(seconds) {
    if (!seconds) return '0s';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

function statusBadge(status) {
    return `<span class="badge badge-${status}"><span class="badge-dot"></span>${status}</span>`;
}

function fileIcon(name, isDir) {
    if (isDir) return '📁';
    const ext = name.split('.').pop().toLowerCase();
    const icons = { jar: '☕', yml: '📋', yaml: '📋', json: '📋', properties: '⚙️', txt: '📄', log: '📜', png: '🖼️', jpg: '🖼️', zip: '📦', gz: '📦', dat: '💾', sk: '📜', js: '📜', cfg: '⚙️', toml: '📋', md: '📝' };
    return icons[ext] || '📄';
}

// Modal helper
function showModal(title, bodyHtml, footerHtml, cssClass) {
    const existing = document.querySelector('.dynamic-modal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.className = 'modal-overlay dynamic-modal';
    modal.innerHTML = `<div class="modal ${cssClass || ''}">
    <div class="modal-header"><h2>${title}</h2><button class="btn-icon modal-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="modal-body">${bodyHtml}</div>
    ${footerHtml ? `<div class="modal-footer">${footerHtml}</div>` : ''}
  </div>`;
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
    return modal;
}

// ========== Pages ==========
const Pages = {};

// --- DASHBOARD ---
Pages.dashboard = async (el) => {
    el.innerHTML = '<div class="loading-screen"><div class="spinner spinner-lg"></div><p>Loading dashboard...</p></div>';
    try {
        const promises = [API.get('/servers'), API.get('/system/info')];
        if (App.user?.role === 'admin') promises.push(API.get('/system/daemon').catch(() => null));
        const results = await Promise.all(promises);
        const [servers, sysInfo, daemon] = results;
        const running = servers.filter(s => s.status === 'running').length;
        const stopped = servers.filter(s => s.status === 'stopped').length;
        const showDaemonNotice = daemon && !daemon.installed;

        el.innerHTML = `
      ${showDaemonNotice ? `
      <div class="card mb-4 daemon-notice">
        <div class="card-body" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
          <div>
            <strong>Looty Panel won't auto-start with Windows</strong>
            <p class="text-muted" style="margin:4px 0 0;font-size:13px">Install the Windows service so the panel (and your servers) start automatically when Windows boots.</p>
          </div>
          <button class="btn btn-primary btn-sm" onclick="location.hash='settings'">Install Service →</button>
        </div>
      </div>
      ` : ''}
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-icon purple">🖥️</div><div class="stat-info"><h4>${servers.length}</h4><p>Total Servers</p></div></div>
        <div class="stat-card"><div class="stat-icon green">✅</div><div class="stat-info"><h4>${running}</h4><p>Running</p></div></div>
        <div class="stat-card"><div class="stat-icon red">⛔</div><div class="stat-info"><h4>${stopped}</h4><p>Stopped</p></div></div>
        <div class="stat-card"><div class="stat-icon blue">💻</div><div class="stat-info"><h4>${sysInfo.cpus} cores</h4><p>${sysInfo.cpuModel.substring(0, 30)}</p></div></div>
        <div class="stat-card"><div class="stat-icon orange">🧠</div><div class="stat-info"><h4>${Math.round(sysInfo.usedMemory / 1024)}/${Math.round(sysInfo.totalMemory / 1024)} GB</h4><p>Memory Usage</p></div></div>
      </div>
      <div class="flex-between mb-4"><h3>Your Servers</h3><button class="btn btn-primary btn-sm" onclick="location.hash='servers'">View All →</button></div>
      <div class="server-grid" id="dash-servers"></div>
    `;

        const grid = document.getElementById('dash-servers');
        if (servers.length === 0) {
            grid.innerHTML = '<div class="empty-state"><div class="empty-icon">🖥️</div><h3>No servers yet</h3><p>Create your first Minecraft server to get started.</p><button class="btn btn-primary" onclick="location.hash=\'servers\'">Create Server</button></div>';
        } else {
            grid.innerHTML = servers.map(s => `
        <div class="server-card" onclick="location.hash='server/${s.id}'">
          <div class="server-card-header">
            <h3>${s.name}</h3>
            ${statusBadge(s.status)}
          </div>
          <div class="server-card-meta">
            <span class="badge badge-type">${s.type}</span>
            <span class="badge badge-type">${s.mc_version}</span>
            <span class="badge badge-type">:${s.port}</span>
          </div>
          <div class="server-card-actions">
            ${s.status === 'stopped' ? `<button class="btn btn-success btn-sm" onclick="event.stopPropagation();Pages.startServer(${s.id})">▶ Start</button>` : ''}
            ${s.status === 'running' ? `<button class="btn btn-danger btn-sm" onclick="event.stopPropagation();Pages.stopServer(${s.id})">⏹ Stop</button>` : ''}
            ${s.status === 'running' || s.status === 'starting' ? `<button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();Pages.killServer(${s.id})" title="Force stop">Kill</button>` : ''}
            <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();location.hash='server/${s.id}/configuration'" title="Configure server">⚙️</button>
          </div>
        </div>
      `).join('');
        }
    } catch (err) {
        el.innerHTML = `<div class="alert alert-error">Failed to load dashboard: ${err.message}</div>`;
    }
};

// Start/Stop helpers
Pages.startServer = async (id) => {
    try { await API.post(`/servers/${id}/start`); Toast.success('Server starting...'); App.route(); } catch (e) { Toast.error(e.message); }
};
Pages.stopServer = async (id) => {
    try { await API.post(`/servers/${id}/stop`); Toast.success('Server stopping...'); App.route(); } catch (e) { Toast.error(e.message); }
};
Pages.killServer = async (id) => {
    try { await API.post(`/servers/${id}/kill`); Toast.success('Server force stopped'); App.route(); } catch (e) { Toast.error(e.message); }
};

// --- SERVERS LIST ---
Pages.servers = async (el, actions) => {
    actions.innerHTML = '<button class="btn btn-primary btn-sm" id="create-server-btn">+ New Server</button>';
    document.getElementById('create-server-btn').onclick = () => Pages.createServerWizard();

    el.innerHTML = '<div class="loading-screen"><div class="spinner spinner-lg"></div></div>';
    try {
        const servers = await API.get('/servers');
        if (servers.length === 0) {
            el.innerHTML = '<div class="empty-state"><div class="empty-icon">🖥️</div><h3>No servers yet</h3><p>Create your first Minecraft server to get started.</p><button class="btn btn-primary" onclick="Pages.createServerWizard()">+ Create Server</button></div>';
            return;
        }
        el.innerHTML = `<div class="server-grid">${servers.map(s => `
      <div class="server-card" onclick="location.hash='server/${s.id}'">
        <div class="server-card-header"><h3>${s.name}</h3>${statusBadge(s.status)}</div>
        <div class="server-card-meta">
          <span class="badge badge-type">${s.type}</span>
          <span class="badge badge-type">${s.mc_version}</span>
          <span class="badge badge-type">Port: ${s.port}</span>
          <span class="badge badge-type">RAM: ${s.memory_max}</span>
        </div>
        <div class="server-card-actions">
          ${s.status === 'stopped' ? `<button class="btn btn-success btn-sm" onclick="event.stopPropagation();Pages.startServer(${s.id})">▶ Start</button>` : ''}
          ${s.status === 'running' ? `<button class="btn btn-danger btn-sm" onclick="event.stopPropagation();Pages.stopServer(${s.id})">⏹ Stop</button>` : ''}
          ${s.status === 'running' || s.status === 'starting' ? `<button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();Pages.killServer(${s.id})" title="Force stop">Kill</button>` : ''}
          ${s.status === 'running' ? `<button class="btn btn-warning btn-sm" onclick="event.stopPropagation();Pages.restartServer(${s.id})">🔄 Restart</button>` : ''}
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();location.hash='server/${s.id}/configuration'" title="Configure">⚙️</button>
        </div>
      </div>
    `).join('')}</div>`;
    } catch (err) { el.innerHTML = `<div class="alert alert-error">${err.message}</div>`; }
};

Pages.restartServer = async (id) => {
    try { await API.post(`/servers/${id}/restart`); Toast.success('Server restarting...'); setTimeout(() => App.route(), 2000); } catch (e) { Toast.error(e.message); }
};

// JAR type descriptions for create server wizard
const JAR_TYPE_INFO = {
    paper: { name: 'Paper', desc: 'Best performance. Optimized Spigot fork. Recommended for most servers. Supports Spigot plugins.' },
    purpur: { name: 'Purpur', desc: 'Paper fork with extra customization. Great for creative/survival with unique features.' },
    spigot: { name: 'Spigot', desc: 'Classic Bukkit/Spigot. Largest plugin ecosystem. Best plugin compatibility.' },
    velocity: { name: 'Velocity', desc: 'Modern proxy server. Connects multiple backend servers. Use with Paper/Spigot backends.' },
    vanilla: { name: 'Vanilla', desc: 'Official Minecraft server. No mods or plugins. Simplest option.' },
    fabric: { name: 'Fabric', desc: 'Lightweight mod loader. Modern mod support. Popular for modded gameplay.' },
    forge: { name: 'Forge', desc: 'Heavy mod loader. Best for large modpacks. Extensive mod library.' },
};

// --- CREATE SERVER WIZARD ---
Pages.createServerWizard = async () => {
    const types = ['paper', 'purpur', 'spigot', 'velocity', 'vanilla', 'fabric', 'forge'];
    let javaInstalls = [];
    try { javaInstalls = await API.get('/system/java'); } catch (e) { }

    const body = `
    <div class="form-group"><label>Server Name</label><input type="text" id="wiz-name" placeholder="My Server" required></div>
    <div class="grid-2">
      <div class="form-group"><label>Server Type <button type="button" class="btn-icon" id="wiz-type-info" title="Help choosing a server type" style="margin-left:4px;vertical-align:middle;font-size:14px">ℹ️</button></label>
        <select id="wiz-type">${types.map(t => `<option value="${t}">${t.charAt(0).toUpperCase() + t.slice(1)}</option>`).join('')}</select>
      </div>
      <div class="form-group"><label>Version</label>
        <select id="wiz-version"><option>Loading...</option></select>
      </div>
    </div>
    <div class="grid-2">
      <div class="form-group"><label>Port</label><input type="number" id="wiz-port" value="25565"></div>
      <div class="form-group"><label>Max RAM</label>
        <select id="wiz-ram"><option value="1G">1 GB</option><option value="2G" selected>2 GB</option><option value="4G">4 GB</option><option value="6G">6 GB</option><option value="8G">8 GB</option><option value="12G">12 GB</option><option value="16G">16 GB</option></select>
      </div>
    </div>
    <div class="form-group"><label>Java Path</label>
      <select id="wiz-java"><option value="java">System Default (java)</option>${javaInstalls.map(j => `<option value="${j.path}">${j.display} - ${j.path}</option>`).join('')}</select>
    </div>
    <div id="wiz-status" style="display:none" class="mt-4"><div class="flex gap-2" style="align-items:center"><div class="spinner"></div><span id="wiz-status-text">Downloading server JAR...</span></div><div class="progress-bar mt-4"><div class="progress-fill" id="wiz-progress" style="width:0%"></div></div></div>
    <div id="wiz-error" class="alert alert-error" style="display:none"></div>
  `;
    const footer = `<button class="btn btn-secondary modal-close" onclick="this.closest('.modal-overlay').remove()">Cancel</button><button class="btn btn-primary" id="wiz-create">Create Server</button>`;

    const modal = showModal('🖥️ Create New Server', body, footer);

    // JAR type info button
    document.getElementById('wiz-type-info').onclick = () => {
        const currentType = document.getElementById('wiz-type').value;
        const info = JAR_TYPE_INFO[currentType];
        const allInfo = Object.entries(JAR_TYPE_INFO).map(([k, v]) =>
            `<p class="mb-2"><strong>${v.name}</strong> — ${v.desc}</p>`
        ).join('');
        showModal('ℹ️ Server Type Guide', `
            <p class="text-muted mb-4">Choose based on your needs:</p>
            ${allInfo}
            <p class="text-muted mt-4" style="font-size:12px">💡 Most users should pick <strong>Paper</strong> for best performance with plugins.</p>
        `, '<button class="btn btn-primary modal-close" onclick="this.closest(\'.modal-overlay\').remove()">Got it</button>');
    };

    // Load versions on type change
    const loadVersions = async () => {
        const type = document.getElementById('wiz-type').value;
        const sel = document.getElementById('wiz-version');
        sel.innerHTML = '<option>Loading...</option>';
        try {
            const versions = await API.get(`/servers/versions/${type}`);
            sel.innerHTML = versions.slice(0, 50).map(v => `<option value="${v}">${v}</option>`).join('');
        } catch { sel.innerHTML = '<option>Error loading</option>'; }
    };
    document.getElementById('wiz-type').onchange = loadVersions;
    loadVersions();

    document.getElementById('wiz-create').onclick = async () => {
        const btn = document.getElementById('wiz-create');
        const errEl = document.getElementById('wiz-error');
        errEl.style.display = 'none';
        btn.disabled = true;
        document.getElementById('wiz-status').style.display = 'block';
        document.getElementById('wiz-status-text').textContent = 'Creating server & downloading JAR...';

        try {
            await API.post('/servers', {
                name: document.getElementById('wiz-name').value,
                type: document.getElementById('wiz-type').value,
                version: document.getElementById('wiz-version').value,
                port: parseInt(document.getElementById('wiz-port').value),
                memoryMax: document.getElementById('wiz-ram').value,
                javaPath: document.getElementById('wiz-java').value,
            });
            Toast.success('Server created successfully!');
            modal.remove();
            App.route();
        } catch (err) {
            errEl.textContent = err.message;
            errEl.style.display = 'block';
            document.getElementById('wiz-status').style.display = 'none';
        }
        btn.disabled = false;
    };
};

// Init
document.addEventListener('DOMContentLoaded', () => App.init());
