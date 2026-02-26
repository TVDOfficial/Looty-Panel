const QuickCommands = {
    _buttons: [],
    _serverId: null,
    _defaultGroups: ['admin', 'moderator', 'builder', 'helper', 'vip', 'default'],

    async render(container, serverId) {
        this._serverId = serverId;
        this._buttons = await this._loadButtons();

        container.innerHTML = `
            <div class="quick-commands-bar mb-4">
                <div class="quick-commands-list" id="quick-commands-list">
                    <!-- Default Commands -->
                    <button class="btn btn-ghost btn-sm command-btn" onclick="QuickCommands.showGiveModal()">🎁 Give Item</button>
                    <button class="btn btn-ghost btn-sm command-btn" id="lp-btn" style="display:none" onclick="QuickCommands.showLPModal()">🔰 LuckPerms</button>
                    
                    <!-- Custom Buttons -->
                    ${this._buttons.map((btn, index) => `
                        <div class="custom-command-wrapper" draggable="true" data-index="${index}">
                            <button class="btn btn-ghost btn-sm command-btn" onclick="QuickCommands.run('${btn.command}')">
                                ${btn.name}
                            </button>
                            <span class="remove-cmd" onclick="QuickCommands.remove(${index})">×</span>
                        </div>
                    `).join('')}
                    
                    <button class="btn btn-ghost btn-sm add-cmd-btn" onclick="QuickCommands.showAddModal()">+ Add</button>
                </div>
            </div>
        `;

        this._checkPlugins();
        this._initDragAndDrop();
    },

    async _loadButtons() {
        const prefs = await App.getPreferences();
        return prefs.quickCommands ? prefs.quickCommands[this._serverId] || [] : [];
    },

    async _saveButtons() {
        const prefs = await App.getPreferences();
        if (!prefs.quickCommands) prefs.quickCommands = {};
        prefs.quickCommands[this._serverId] = this._buttons;
        await App.savePreferences(prefs);
    },

    async _loadLists() {
        const prefs = await App.getPreferences();
        return prefs.quickCommandLists || {};
    },

    async _saveLists(lists) {
        const prefs = await App.getPreferences();
        prefs.quickCommandLists = lists;
        await App.savePreferences(prefs);
    },

    async _checkPlugins() {
        try {
            const lp = await API.get(`/servers/${this._serverId}/plugins/check/LuckPerms`);
            if (lp.exists) {
                document.getElementById('lp-btn').style.display = '';
            }
        } catch (e) { }
    },

    async run(cmd) {
        // Find all unique placeholders like {player}, {item}, {group}, {custom}
        const matches = [...cmd.matchAll(/{([a-zA-Z0-9_-]+)}/g)];
        if (matches.length > 0) {
            this._showArgsModal(cmd, matches.map(m => m[1]));
            return;
        }

        API.post(`/servers/${this._serverId}/command`, { command: cmd })
            .then(() => Toast.success('Command sent'))
            .catch(e => Toast.error(e.message));
    },

    async _showArgsModal(cmd, placeholders) {
        const players = placeholders.includes('player') ? await API.get(`/servers/${this._serverId}/players`) : [];
        const lists = await this._loadLists();

        // Remove duplicates
        const uniquePlaceholders = [...new Set(placeholders)];

        let body = `<p class="text-muted mb-4" style="font-size: 13px">This command requires arguments. Please select them below.</p>`;

        for (const p of uniquePlaceholders) {
            let optionsHtml = '';
            let isSearchable = true;

            if (p === 'player') {
                optionsHtml = `
                    ${players.length ? players.map(pl => `<div class="option" data-value="${pl}">${pl}</div>`).join('') : '<div class="no-options">No players online</div>'}
                    <div class="option" data-value="@a">@a (All Players)</div>
                    <div class="option" data-value="@p">@p (Nearest Player)</div>
                `;
            } else if (p === 'item') {
                optionsHtml = MC_ITEMS.map(i => `<div class="option" data-value="${i.id}">${i.name} (${i.id})</div>`).join('');
            } else if (p === 'group') {
                const groups = [...new Set([...this._defaultGroups, ...(lists['group'] || [])])];
                optionsHtml = groups.map(g => `<div class="option" data-value="${g}">${g}</div>`).join('');
            } else if (lists[p]) {
                optionsHtml = lists[p].map(val => `<div class="option" data-value="${val}">${val}</div>`).join('');
            } else {
                isSearchable = false;
            }

            body += `
                <div class="form-group mb-4">
                    <label style="text-transform: capitalize;">${p.replace(/_/g, ' ')}</label>
                    ${isSearchable ? `
                        <div class="searchable-select" id="arg-${p}-select">
                            <input type="text" placeholder="Search ${p}..." class="search-input">
                            <div class="options-list">
                                ${optionsHtml}
                            </div>
                        </div>
                    ` : `
                        <input type="text" id="arg-${p}-input" placeholder="Enter ${p}..." class="w-full">
                    `}
                </div>
            `;
        }

        const footer = `
            <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
            <button class="btn btn-primary" id="execute-arg-cmd">Run Command</button>
        `;
        const modal = showModal('Command Arguments', body, footer);

        for (const p of uniquePlaceholders) {
            const el = document.getElementById(`arg-${p}-select`);
            if (el) this._initSearchableSelect(el);
        }

        document.getElementById('execute-arg-cmd').onclick = () => {
            let finalCmd = cmd;
            for (const p of uniquePlaceholders) {
                let val = '';
                const select = document.getElementById(`arg-${p}-select`);
                if (select) {
                    val = select.querySelector('.option.selected')?.dataset.value || select.querySelector('.search-input').value;
                } else {
                    val = document.getElementById(`arg-${p}-input`).value;
                }

                if (!val) {
                    Toast.error(`${p} is required`);
                    return;
                }
                // Global replace for this specific placeholder type
                finalCmd = finalCmd.replace(new RegExp(`{${p}}`, 'g'), val);
            }

            API.post(`/servers/${this._serverId}/command`, { command: finalCmd })
                .then(() => {
                    Toast.success('Command sent');
                    modal.remove();
                })
                .catch(e => Toast.error(e.message));
        };
    },

    async showAddModal() {
        const body = `
            <div class="form-group mb-4">
                <label>Button Name</label>
                <input type="text" id="new-cmd-name" placeholder="Heal All">
            </div>
            <div class="form-group mb-4">
                <label>Command</label>
                <input type="text" id="new-cmd-val" placeholder="heal *">
            </div>
            <div class="flex-between mb-2">
                <span class="text-muted" style="font-size:12px">Placeholders: <code>{player}</code>, <code>{item}</code>, <code>{group}</code></span>
                <button class="btn btn-ghost btn-sm" onclick="QuickCommands.showManageLists()">Manage Lists</button>
            </div>
            <div class="alert alert-info" style="font-size:12px; margin-bottom: 0;">
                <strong>Tip:</strong> You can create your own placeholders by managing lists! For example, <code>{warp}</code>.
            </div>
        `;
        const footer = `
            <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
            <button class="btn btn-primary" id="save-new-cmd">Add Button</button>
        `;
        const modal = showModal('Add Quick Command', body, footer);

        document.getElementById('save-new-cmd').onclick = async () => {
            const name = document.getElementById('new-cmd-name').value;
            const command = document.getElementById('new-cmd-val').value;
            if (!name || !command) return Toast.error('Both fields are required');

            this._buttons.push({ name, command });
            await this._saveButtons();
            modal.remove();
            this.render(document.querySelector('.quick-commands-bar').parentElement, this._serverId);
        };
    },

    async showManageLists() {
        const lists = await this._loadLists();
        const listKeys = Object.keys(lists);

        const body = `
            <div class="manage-lists-container">
                <div id="lists-container" style="max-height: 400px; overflow-y: auto;">
                    ${listKeys.length ? listKeys.map(k => `
                        <div class="card mb-3 p-3 list-item-card" data-key="${k}">
                            <div class="flex-between mb-2">
                                <strong>{${k}}</strong>
                                <button class="btn btn-ghost btn-sm text-danger" onclick="QuickCommands._deleteList('${k}')">Delete</button>
                            </div>
                            <textarea class="w-full text-sm" placeholder="Comma separated values" rows="2" onchange="QuickCommands._updateList('${k}', this.value)">${lists[k].join(', ')}</textarea>
                        </div>
                    `).join('') : '<p class="text-muted text-center p-4">No custom lists yet.</p>'}
                </div>
                <hr class="mb-4">
                <div class="flex gap-2">
                    <input type="text" id="new-list-name" placeholder="List name (e.g. warp)" class="flex-1">
                    <button class="btn btn-primary btn-sm" onclick="QuickCommands._addNewList()">+ New List</button>
                </div>
            </div>
        `;
        showModal('Manage Custom Lists', body, '', 'modal-lg');
    },

    async _addNewList() {
        const nameInput = document.getElementById('new-list-name');
        const name = nameInput.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
        if (!name) return Toast.error('Enter a valid name');

        const lists = await this._loadLists();
        if (lists[name]) return Toast.error('List already exists');

        lists[name] = [];
        await this._saveLists(lists);
        nameInput.value = '';
        this.showManageLists();
    },

    async _deleteList(key) {
        if (!confirm(`Delete list {${key}}?`)) return;
        const lists = await this._loadLists();
        delete lists[key];
        await this._saveLists(lists);
        this.showManageLists();
    },

    async _updateList(key, val) {
        const lists = await this._loadLists();
        lists[key] = val.split(',').map(v => v.trim()).filter(v => v);
        await this._saveLists(lists);
        Toast.success('List updated');
    },

    remove(index) {
        if (!confirm('Remove this shortcut?')) return;
        this._buttons.splice(index, 1);
        this._saveButtons().then(() => {
            this.render(document.querySelector('.quick-commands-bar').parentElement, this._serverId);
        });
    },

    async showGiveModal() {
        const players = await API.get(`/servers/${this._serverId}/players`);
        const body = `
            <div class="form-group mb-4">
                <label>Select Player</label>
                <div class="searchable-select" id="player-select">
                    <input type="text" placeholder="Search player..." class="search-input">
                    <div class="options-list">
                        ${players.length ? players.map(p => `<div class="option" data-value="${p}">${p}</div>`).join('') : '<div class="no-options">No players online</div>'}
                        <div class="option" data-value="@a">@a (All Players)</div>
                        <div class="option" data-value="@p">@p (Nearest Player)</div>
                    </div>
                </div>
            </div>
            <div class="form-group mb-4">
                <label>Select Item</label>
                <div class="searchable-select" id="item-select">
                    <input type="text" placeholder="Search item..." class="search-input">
                    <div class="options-list">
                        ${MC_ITEMS.map(i => `<div class="option" data-value="${i.id}">${i.name} (${i.id})</div>`).join('')}
                    </div>
                </div>
            </div>
            <div class="form-group">
                <label>Amount</label>
                <input type="number" id="give-amount" value="64" min="1" max="2304">
            </div>
        `;
        const footer = `
            <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
            <button class="btn btn-primary" id="execute-give">Give</button>
        `;
        const modal = showModal('🎁 Give Item', body, footer);

        this._initSearchableSelect(document.getElementById('player-select'));
        this._initSearchableSelect(document.getElementById('item-select'));

        document.getElementById('execute-give').onclick = () => {
            const player = document.querySelector('#player-select .option.selected')?.dataset.value || document.querySelector('#player-select .search-input').value;
            const item = document.querySelector('#item-select .option.selected')?.dataset.value;
            const amount = document.getElementById('give-amount').value;

            if (!player || !item) return Toast.error('Player and Item are required');

            this.run(`give ${player} ${item} ${amount}`);
            modal.remove();
        };
    },

    showLPModal() {
        const body = `
            <div class="lp-quick-actions">
                <button class="btn btn-ghost btn-sm w-full mb-2" onclick="QuickCommands.lpAction('editor')">📝 Open Web Editor</button>
                <button class="btn btn-ghost btn-sm w-full mb-2" onclick="QuickCommands.lpAction('sync')">🔄 Sync Permissions</button>
                <hr class="mb-2">
                <p class="text-muted mb-2" style="font-size:12px">User Management</p>
                <input type="text" id="lp-user" placeholder="Player Name" class="mb-2 w-full">
                <div class="flex gap-2">
                    <button class="btn btn-ghost btn-sm flex-1" onclick="QuickCommands.lpUserAction('info')">Info</button>
                    <button class="btn btn-ghost btn-sm flex-1" onclick="QuickCommands.lpUserAction('groups')">Groups</button>
                </div>
            </div>
        `;
        showModal('🔰 LuckPerms Quick Actions', body, '');
    },

    lpAction(action) {
        if (action === 'editor') {
            this.run('lp editor');
            Toast.info('Check console for editor link');
        } else if (action === 'sync') {
            this.run('lp sync');
        }
    },

    lpUserAction(action) {
        const user = document.getElementById('lp-user').value;
        if (!user) return Toast.error('Enter a player name');
        this.run(`lp user ${user} ${action}`);
    },

    _initSearchableSelect(container) {
        const input = container.querySelector('.search-input');
        const list = container.querySelector('.options-list');
        const options = list.querySelectorAll('.option');

        input.addEventListener('focus', () => list.classList.add('show'));

        input.addEventListener('input', () => {
            const q = input.value.toLowerCase();
            options.forEach(opt => {
                const text = opt.textContent.toLowerCase();
                opt.style.display = text.includes(q) ? '' : 'none';
            });
            list.classList.add('show');
        });

        options.forEach(opt => {
            opt.addEventListener('click', () => {
                options.forEach(o => o.classList.remove('selected'));
                opt.classList.add('selected');
                input.value = opt.textContent;
                list.classList.remove('show');
            });
        });

        document.addEventListener('click', (e) => {
            if (!container.contains(e.target)) list.classList.remove('show');
        });
    },

    _initDragAndDrop() {
        const wrappers = document.querySelectorAll('.custom-command-wrapper');
        const container = document.getElementById('quick-commands-list');

        wrappers.forEach(wrapper => {
            wrapper.addEventListener('dragstart', (e) => {
                wrapper.classList.add('dragging');
                e.dataTransfer.setData('text/plain', wrapper.dataset.index);
            });

            wrapper.addEventListener('dragend', () => {
                wrapper.classList.remove('dragging');
            });
        });

        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            const dragging = document.querySelector('.dragging');
            if (!dragging) return;
            const afterElement = this._getDragAfterElement(container, e.clientX);
            if (afterElement == null) {
                container.appendChild(dragging);
            } else {
                container.insertBefore(dragging, afterElement);
            }
        });

        container.addEventListener('drop', async (e) => {
            e.preventDefault();
            const newOrder = [];
            container.querySelectorAll('.custom-command-wrapper').forEach(w => {
                const index = parseInt(w.dataset.index);
                newOrder.push(this._buttons[index]);
            });
            this._buttons = newOrder;
            await this._saveButtons();
            this.render(container.parentElement.parentElement, this._serverId);
        });
    },

    _getDragAfterElement(container, x) {
        const draggableElements = [...container.querySelectorAll('.custom-command-wrapper:not(.dragging)')];
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = x - box.left - box.width / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }
};
