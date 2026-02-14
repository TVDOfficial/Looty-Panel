// ========== API Client ==========
const API = {
    token: localStorage.getItem('mcpanel_token'),

    async request(method, url, body) {
        const opts = {
            method,
            headers: { 'Content-Type': 'application/json' },
        };
        if (this.token) opts.headers['Authorization'] = `Bearer ${this.token}`;
        if (body) opts.body = JSON.stringify(body);

        const res = await fetch(`/api${url}`, opts);
        if (res.status === 401) {
            this.token = null;
            localStorage.removeItem('mcpanel_token');
            location.reload();
            throw new Error('Session expired');
        }

        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
        return data;
    },

    get(url) { return this.request('GET', url); },
    post(url, body) { return this.request('POST', url, body); },
    put(url, body) { return this.request('PUT', url, body); },
    del(url) { return this.request('DELETE', url); },

    setToken(token) {
        this.token = token;
        localStorage.setItem('mcpanel_token', token);
    },

    clearToken() {
        this.token = null;
        localStorage.removeItem('mcpanel_token');
        localStorage.removeItem('mcpanel_user');
    },

    // Upload files
    async upload(url, formData) {
        const opts = {
            method: 'POST',
            headers: {},
            body: formData,
        };
        if (this.token) opts.headers['Authorization'] = `Bearer ${this.token}`;
        const res = await fetch(`/api${url}`, opts);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        return data;
    },
};
