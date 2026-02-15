// ========== Users & Settings Pages ==========

// --- USERS PAGE ---
Pages.users = async (el, actions) => {
  if (App.user.role !== 'admin') {
    el.innerHTML = '<div class="alert alert-error">Admin access required</div>';
    return;
  }
  actions.innerHTML = '<button class="btn btn-primary btn-sm" id="add-user-btn">+ Add User</button>';

  el.innerHTML = '<div class="loading-screen"><div class="spinner spinner-lg"></div></div>';
  try {
    const users = await API.get('/users');
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><h3>Users (${users.length})</h3></div>
        <div class="table-container">
          <table>
            <thead><tr><th>Username</th><th>Role</th><th>Created</th><th>Actions</th></tr></thead>
            <tbody>${users.map(u => `<tr>
              <td><div class="flex gap-2" style="align-items:center"><div class="user-avatar" style="width:28px;height:28px;font-size:11px">${u.username[0].toUpperCase()}</div>${u.username}</div></td>
              <td><span class="badge ${u.role === 'admin' ? 'badge-running' : 'badge-type'}">${u.role}</span></td>
              <td>${new Date(u.created_at).toLocaleDateString()}</td>
              <td class="btn-group">
                <button class="btn btn-ghost btn-sm" onclick="Pages._editUser(${u.id},'${u.username}','${u.role}')">Edit</button>
                ${u.id !== App.user.id ? `<button class="btn btn-ghost btn-sm text-danger" onclick="Pages._deleteUser(${u.id},'${u.username}')">Delete</button>` : ''}
              </td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>
      <div class="card mt-6">
        <div class="card-header"><h3>Activity Log</h3></div>
        <div class="card-body" id="audit-log-container"><div class="loading-screen"><div class="spinner"></div></div></div>
      </div>
    `;

    document.getElementById('add-user-btn').onclick = () => Pages._addUser();
    Pages._loadAuditLog();
  } catch (err) { el.innerHTML = `<div class="alert alert-error">${err.message}</div>`; }
};

Pages._addUser = () => {
  const body = `
    <div class="form-group"><label>Username</label><input type="text" id="au-username" placeholder="username" required></div>
    <div class="form-group"><label>Password</label><input type="password" id="au-password" placeholder="Min 6 characters" required></div>
    <div class="form-group"><label>Role</label><select id="au-role"><option value="user">User</option><option value="admin">Admin</option></select></div>
  `;
  const footer = `<button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button><button class="btn btn-primary" id="au-create">Create User</button>`;
  const modal = showModal('👤 Add User', body, footer);
  document.getElementById('au-create').onclick = async () => {
    try {
      await API.post('/users', {
        username: document.getElementById('au-username').value,
        password: document.getElementById('au-password').value,
        role: document.getElementById('au-role').value,
      });
      Toast.success('User created');
      modal.remove();
      App.route();
    } catch (e) { Toast.error(e.message); }
  };
};

Pages._editUser = (id, username, currentRole) => {
  const body = `
    <p class="text-muted mb-4">Editing: <strong>${username}</strong></p>
    <div class="form-group"><label>Role</label><select id="eu-role"><option value="user" ${currentRole === 'user' ? 'selected' : ''}>User</option><option value="admin" ${currentRole === 'admin' ? 'selected' : ''}>Admin</option></select></div>
    <div class="form-group"><label>New Password (leave blank to keep)</label><input type="password" id="eu-password" placeholder="Leave blank to keep current"></div>
  `;
  const footer = `<button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button><button class="btn btn-primary" id="eu-save">Save</button>`;
  const modal = showModal('✏️ Edit User', body, footer);
  document.getElementById('eu-save').onclick = async () => {
    const data = { role: document.getElementById('eu-role').value };
    const pw = document.getElementById('eu-password').value;
    if (pw) data.password = pw;
    try {
      await API.put(`/users/${id}`, data);
      Toast.success('User updated');
      modal.remove();
      App.route();
    } catch (e) { Toast.error(e.message); }
  };
};

Pages._deleteUser = async (id, username) => {
  if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
  try { await API.del(`/users/${id}`); Toast.success('User deleted'); App.route(); } catch (e) { Toast.error(e.message); }
};

Pages._loadAuditLog = async () => {
  const container = document.getElementById('audit-log-container');
  try {
    const logs = await API.get('/system/audit-log?limit=30');
    if (logs.length === 0) {
      container.innerHTML = '<p class="text-muted">No activity yet</p>';
      return;
    }
    container.innerHTML = `<div class="table-container"><table>
      <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Details</th></tr></thead>
      <tbody>${logs.map(l => `<tr>
        <td style="white-space:nowrap;font-size:12px">${new Date(l.created_at).toLocaleString()}</td>
        <td>${l.username || 'System'}</td>
        <td><span class="badge badge-type">${l.action}</span></td>
        <td style="font-size:12px">${l.details || '-'}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  } catch (e) { container.innerHTML = `<div class="alert alert-error">${e.message}</div>`; }
};

// --- SETTINGS PAGE ---
Pages.settings = async (el) => {
  el.innerHTML = '<div class="loading-screen"><div class="spinner spinner-lg"></div></div>';
  try {
    const [sysInfo, java, daemon, panelSettings] = await Promise.all([
      API.get('/system/info'),
      API.get('/system/java'),
      App.user.role === 'admin' ? API.get('/system/daemon').catch(() => ({ installed: false })) : Promise.resolve(null),
      App.user.role === 'admin' ? API.get('/system/panel-settings').catch(() => ({ log_max_size_mb: 10 })) : Promise.resolve(null),
    ]);

    const currentTheme = localStorage.getItem('mcpanel_theme') || 'midnight';

    el.innerHTML = `
      <!-- Theme -->
      <div class="card mb-6">
        <div class="card-header"><h3>🎨 Theme</h3></div>
        <div class="card-body">
          <div class="theme-grid" id="theme-grid">
            <div class="theme-option ${currentTheme === 'midnight' ? 'active' : ''}" data-theme="midnight">
              <div class="theme-preview" style="background:linear-gradient(135deg,#0f0f17,#1a1a2e);border:2px solid ${currentTheme === 'midnight' ? 'var(--accent)' : 'var(--border-color)'}">
                <div style="width:30%;height:100%;background:#161625;border-right:1px solid #2a2a45"></div>
              </div>
              <span>Midnight</span>
            </div>
            <div class="theme-option ${currentTheme === 'noble' ? 'active' : ''}" data-theme="noble">
              <div class="theme-preview" style="background:linear-gradient(135deg,#0c0f1d,#11162b);border:2px solid ${currentTheme === 'noble' ? 'var(--accent)' : 'var(--border-color)'}">
                <div style="width:30%;height:100%;background:#131930;border-right:1px solid #1e3799"></div>
              </div>
              <span>Noble (Loot)</span>
            </div>
            <div class="theme-option ${currentTheme === 'dark' ? 'active' : ''}" data-theme="dark">
              <div class="theme-preview" style="background:linear-gradient(135deg,#1a1a2a,#252538);border:2px solid ${currentTheme === 'dark' ? 'var(--accent)' : 'var(--border-color)'}">
                <div style="width:30%;height:100%;background:#1f1f30;border-right:1px solid #333355"></div>
              </div>
              <span>Dark</span>
            </div>
            <div class="theme-option ${currentTheme === 'ocean' ? 'active' : ''}" data-theme="ocean">
              <div class="theme-preview" style="background:linear-gradient(135deg,#0a1628,#112240);border:2px solid ${currentTheme === 'ocean' ? 'var(--accent)' : 'var(--border-color)'}">
                <div style="width:30%;height:100%;background:#0d1b30;border-right:1px solid #1e3a5f"></div>
              </div>
              <span>Ocean</span>
            </div>
            <div class="theme-option ${currentTheme === 'emerald' ? 'active' : ''}" data-theme="emerald">
              <div class="theme-preview" style="background:linear-gradient(135deg,#0a1810,#112218);border:2px solid ${currentTheme === 'emerald' ? 'var(--accent)' : 'var(--border-color)'}">
                <div style="width:30%;height:100%;background:#0d1a12;border-right:1px solid #1e4f30"></div>
              </div>
              <span>Emerald</span>
            </div>
            <div class="theme-option ${currentTheme === 'crimson' ? 'active' : ''}" data-theme="crimson">
              <div class="theme-preview" style="background:linear-gradient(135deg,#1a0a0f,#2a1018);border:2px solid ${currentTheme === 'crimson' ? 'var(--accent)' : 'var(--border-color)'}">
                <div style="width:30%;height:100%;background:#1a0d12;border-right:1px solid #4f1e2e"></div>
              </div>
              <span>Crimson</span>
            </div>
            <div class="theme-option ${currentTheme === 'amoled' ? 'active' : ''}" data-theme="amoled">
              <div class="theme-preview" style="background:#000;border:2px solid ${currentTheme === 'amoled' ? 'var(--accent)' : 'var(--border-color)'}">
                <div style="width:30%;height:100%;background:#0a0a0a;border-right:1px solid #222"></div>
              </div>
              <span>AMOLED</span>
            </div>
            <div class="theme-option ${currentTheme === 'looty' ? 'active' : ''}" data-theme="looty">
              <div class="theme-preview" style="background:linear-gradient(135deg,#0a0f1a,#0d1422);border:2px solid ${currentTheme === 'looty' ? 'var(--accent)' : 'var(--border-color)'}">
                <div style="width:30%;height:100%;background:#0f1625;border-right:1px solid #d4a84b"></div>
              </div>
              <span>Looty (Blue & Gold)</span>
            </div>
          </div>
        </div>
      </div>

      <!-- System Info -->
      <div class="card mb-6">
        <div class="card-header"><h3>💻 System Information</h3></div>
        <div class="card-body">
          <div class="properties-grid">
            <div class="property-item"><label>OS</label><input type="text" value="${sysInfo.platform} (${sysInfo.arch})" readonly></div>
            <div class="property-item"><label>Hostname</label><input type="text" value="${sysInfo.hostname}" readonly></div>
            <div class="property-item"><label>CPU</label><input type="text" value="${sysInfo.cpuModel}" readonly></div>
            <div class="property-item"><label>CPU Cores</label><input type="text" value="${sysInfo.cpus}" readonly></div>
            <div class="property-item"><label>Total Memory</label><input type="text" value="${Math.round(sysInfo.totalMemory / 1024)} GB" readonly></div>
            <div class="property-item"><label>Free Memory</label><input type="text" value="${Math.round(sysInfo.freeMemory / 1024)} GB" readonly></div>
            <div class="property-item"><label>Node.js</label><input type="text" value="${sysInfo.nodeVersion}" readonly></div>
            <div class="property-item"><label>Uptime</label><input type="text" value="${formatUptime(sysInfo.uptime)}" readonly></div>
          </div>
        </div>
      </div>

      <!-- Java -->
      <div class="card mb-6">
        <div class="card-header"><h3>☕ Java Installations</h3></div>
        <div class="card-body">
          ${java.length === 0 ? '<div class="alert alert-warning">No Java installations detected. Java is required to run Minecraft servers.</div>' :
        `<div class="table-container"><table>
            <thead><tr><th>Version</th><th>Major</th><th>Path</th></tr></thead>
            <tbody>${java.map(j => `<tr><td>${j.display}</td><td>${j.majorVersion}</td><td style="font-family:var(--font-mono);font-size:12px">${j.path}</td></tr>`).join('')}</tbody>
          </table></div>`}
        </div>
      </div>

      ${App.user.role === 'admin' ? `
      <!-- Panel Settings -->
      <div class="card mb-6">
        <div class="card-header"><h3>⚙️ Panel Settings</h3></div>
        <div class="card-body">
          <div class="form-group">
            <label for="log-max-size">Log file max size (MB)</label>
            <input type="number" id="log-max-size" min="1" max="100" value="${panelSettings && panelSettings.log_max_size_mb ? panelSettings.log_max_size_mb : 10}" placeholder="10" style="width:120px">
            <p class="text-muted" style="font-size:12px;margin-top:6px">Each log file will be rotated when it exceeds this size. Keeps up to 3 backup files. Range: 1–100 MB.</p>
          </div>
          <button class="btn btn-primary btn-sm" id="save-panel-settings-btn">Save Panel Settings</button>
        </div>
      </div>

      <!-- Daemon -->
      <div class="card mb-6">
        <div class="card-header"><h3>🔧 Windows Service (Daemon)</h3></div>
        <div class="card-body">
          <p class="mb-3"><strong>What does this do?</strong> Installing the daemon registers Loot Panel as a Windows service. This means:</p>
          <ul class="text-muted mb-4" style="padding-left:20px;line-height:1.8">
            <li>The panel will <strong>start automatically</strong> when Windows boots—no need to manually run it</li>
            <li>It runs in the <strong>background</strong> even when no one is logged in</li>
            <li>Your Minecraft servers keep running if you lock your PC or switch users</li>
            <li>You can manage it from <em>Services</em> (services.msc) like any Windows service</li>
          </ul>
          <p class="text-muted mb-4">When you click Install, a UAC prompt will appear—click Yes to allow. Administrator privileges are required to register the service.</p>
          <div class="flex gap-2">
            <button class="btn btn-primary" id="daemon-install-btn">${daemon && daemon.installed ? '✅ Service Installed' : '📥 Install Service'}</button>
            ${daemon && daemon.installed ? '<button class="btn btn-danger" id="daemon-uninstall-btn">Uninstall Service</button>' : ''}
          </div>
          <div id="daemon-status" class="mt-4"></div>
        </div>
      </div>

      <!-- Danger Zone -->
      <div class="card" style="border-color:rgba(255,71,87,0.3)">
        <div class="card-header" style="background:var(--danger-bg)"><h3 class="text-danger">⚠️ Danger Zone</h3></div>
        <div class="card-body">
          <p class="text-muted mb-4">These actions are irreversible. Use with caution.</p>
          <button class="btn btn-danger btn-sm" onclick="Pages._resetPanel()">Reset Panel (Delete all data)</button>
        </div>
      </div>
      ` : ''}
    `;

    // Theme click handlers
    document.querySelectorAll('.theme-option').forEach(opt => {
      opt.onclick = () => {
        const theme = opt.dataset.theme;
        ThemeManager.apply(theme);
        document.querySelectorAll('.theme-option').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        // Update preview borders
        document.querySelectorAll('.theme-preview').forEach(p => p.style.borderColor = 'var(--border-color)');
        opt.querySelector('.theme-preview').style.borderColor = 'var(--accent)';
        Toast.success(`Theme changed to ${theme}`);
      };
    });

    // Panel settings save
    const savePanelBtn = document.getElementById('save-panel-settings-btn');
    if (savePanelBtn) {
      savePanelBtn.onclick = async () => {
        const val = parseInt(document.getElementById('log-max-size')?.value, 10);
        if (isNaN(val) || val < 1 || val > 100) {
          Toast.error('Enter a value between 1 and 100');
          return;
        }
        try {
          await API.put('/system/panel-settings', { log_max_size_mb: val });
          Toast.success('Panel settings saved');
        } catch (e) { Toast.error(e.message); }
      };
    }

    // Daemon buttons
    const installBtn = document.getElementById('daemon-install-btn');
    if (installBtn && !(daemon && daemon.installed)) {
      installBtn.onclick = async () => {
        installBtn.disabled = true;
        installBtn.textContent = 'Installing...';
        Toast.info('A UAC prompt will appear—click Yes to allow installation.');
        try {
          const result = await API.post('/system/daemon/install');
          if (result.success) {
            Toast.success('Service installed successfully');
            installBtn.textContent = '✅ Service Installed';
          } else {
            Toast.error(result.message || 'Installation failed');
            installBtn.disabled = false;
            installBtn.textContent = '📥 Install Service';
          }
        } catch (e) { Toast.error(e.message); installBtn.disabled = false; installBtn.textContent = '📥 Install Service'; }
      };
    }

    const uninstallBtn = document.getElementById('daemon-uninstall-btn');
    if (uninstallBtn) {
      uninstallBtn.onclick = async () => {
        if (!confirm('Uninstall the Loot Panel service?')) return;
        try {
          await API.post('/system/daemon/uninstall');
          Toast.success('Service uninstalled');
          App.route();
        } catch (e) { Toast.error(e.message); }
      };
    }
  } catch (err) { el.innerHTML = `<div class="alert alert-error">${err.message}</div>`; }
};

Pages._resetPanel = () => {
  if (!confirm('This will delete ALL data. Are you absolutely sure?')) return;
  if (!confirm('FINAL WARNING: This cannot be undone!')) return;
  Toast.warning('Panel reset is not implemented for safety. Delete the data folder manually.');
};

// ========== Theme Manager ==========
const ThemeManager = {
  themes: {
    midnight: {
      '--bg-primary': '#0f0f17', '--bg-secondary': '#161625', '--bg-tertiary': '#1e1e32',
      '--bg-card': '#1a1a2e', '--bg-hover': '#252540', '--bg-input': '#12121f',
      '--border-color': '#2a2a45', '--border-light': '#333355',
      '--text-primary': '#e8e8f0', '--text-secondary': '#9898b0', '--text-muted': '#6b6b85',
      '--accent': '#6c5ce7', '--accent-hover': '#7d6ff0',
      '--accent-glow': 'rgba(108, 92, 231, 0.3)',
      '--gradient-brand': 'linear-gradient(135deg, #6c5ce7, #a855f7, #6366f1)',
    },
    noble: {
      '--bg-primary': '#0c0f1d', '--bg-secondary': '#11162b', '--bg-tertiary': '#171e3d',
      '--bg-card': '#131930', '--bg-hover': '#1e264a', '--bg-input': '#0a0d18',
      '--border-color': '#2a3b68', '--border-light': '#3651b5',
      '--text-primary': '#f2f5ff', '--text-secondary': '#a0a8cc', '--text-muted': '#626a8f',
      '--accent': '#f1c40f', '--accent-hover': '#f39c12',
      '--accent-glow': 'rgba(241, 196, 15, 0.25)',
      '--gradient-brand': 'linear-gradient(135deg, #1e3799, #4a69bd, #f1c40f)',
    },
    dark: {
      '--bg-primary': '#18181b', '--bg-secondary': '#1f1f23', '--bg-tertiary': '#27272a',
      '--bg-card': '#222226', '--bg-hover': '#2e2e33', '--bg-input': '#151518',
      '--border-color': '#333338', '--border-light': '#404045',
      '--text-primary': '#e4e4e7', '--text-secondary': '#a1a1aa', '--text-muted': '#71717a',
      '--accent': '#8b5cf6', '--accent-hover': '#a78bfa',
      '--accent-glow': 'rgba(139, 92, 246, 0.3)',
      '--gradient-brand': 'linear-gradient(135deg, #8b5cf6, #a855f7, #7c3aed)',
    },
    ocean: {
      '--bg-primary': '#0a1628', '--bg-secondary': '#0f1e35', '--bg-tertiary': '#152540',
      '--bg-card': '#112240', '--bg-hover': '#1a3050', '--bg-input': '#081320',
      '--border-color': '#1e3a5f', '--border-light': '#2a4a70',
      '--text-primary': '#ccd6f6', '--text-secondary': '#8892b0', '--text-muted': '#5a6a8a',
      '--accent': '#64ffda', '--accent-hover': '#80ffe4',
      '--accent-glow': 'rgba(100, 255, 218, 0.2)',
      '--gradient-brand': 'linear-gradient(135deg, #64ffda, #48c9b0, #3498db)',
    },
    emerald: {
      '--bg-primary': '#0a1810', '--bg-secondary': '#0f2018', '--bg-tertiary': '#152a1e',
      '--bg-card': '#112218', '--bg-hover': '#1a3525', '--bg-input': '#08120c',
      '--border-color': '#1e4f30', '--border-light': '#2a6040',
      '--text-primary': '#d4edda', '--text-secondary': '#88b898', '--text-muted': '#5a8a6a',
      '--accent': '#00d68f', '--accent-hover': '#00e69a',
      '--accent-glow': 'rgba(0, 214, 143, 0.25)',
      '--gradient-brand': 'linear-gradient(135deg, #00d68f, #00b074, #10b981)',
    },
    crimson: {
      '--bg-primary': '#1a0a0f', '--bg-secondary': '#221015', '--bg-tertiary': '#2a181e',
      '--bg-card': '#261218', '--bg-hover': '#351a22', '--bg-input': '#14080c',
      '--border-color': '#4f1e2e', '--border-light': '#602a3a',
      '--text-primary': '#f0d4da', '--text-secondary': '#b08890', '--text-muted': '#8a5a65',
      '--accent': '#ff4757', '--accent-hover': '#ff6b7a',
      '--accent-glow': 'rgba(255, 71, 87, 0.25)',
      '--gradient-brand': 'linear-gradient(135deg, #ff4757, #ff6b6b, #e74c3c)',
    },
    amoled: {
      '--bg-primary': '#000000', '--bg-secondary': '#0a0a0a', '--bg-tertiary': '#141414',
      '--bg-card': '#0e0e0e', '--bg-hover': '#1a1a1a', '--bg-input': '#050505',
      '--border-color': '#222222', '--border-light': '#333333',
      '--text-primary': '#e0e0e0', '--text-secondary': '#999999', '--text-muted': '#666666',
      '--accent': '#bb86fc', '--accent-hover': '#d4a5ff',
      '--accent-glow': 'rgba(187, 134, 252, 0.25)',
      '--gradient-brand': 'linear-gradient(135deg, #bb86fc, #9c64fb, #7c4dff)',
    },
    looty: {
      '--bg-primary': '#0a0f1a', '--bg-secondary': '#0f1625', '--bg-tertiary': '#151e30',
      '--bg-card': '#0d1422', '--bg-hover': '#1a2540', '--bg-input': '#060a12',
      '--border-color': '#1e3250', '--border-light': '#2a4580',
      '--text-primary': '#e8ecf4', '--text-secondary': '#8fa3c4', '--text-muted': '#5a7090',
      '--accent': '#d4a84b', '--accent-hover': '#e8bc5a',
      '--accent-glow': 'rgba(212, 168, 75, 0.3)',
      '--gradient-brand': 'linear-gradient(135deg, #2563eb, #1e40af, #d4a84b)',
    },
  },

  apply(themeName) {
    const theme = this.themes[themeName];
    if (!theme) return;
    const root = document.documentElement;
    for (const [prop, value] of Object.entries(theme)) {
      root.style.setProperty(prop, value);
    }
    localStorage.setItem('mcpanel_theme', themeName);
  },

  init() {
    const saved = localStorage.getItem('mcpanel_theme');
    if (saved && this.themes[saved]) this.apply(saved);
  },
};

// Init theme on load
ThemeManager.init();
