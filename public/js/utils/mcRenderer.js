/**
 * Minecraft MOTD Renderer
 * Converts strings with § codes into HTML spans.
 */
const MCRenderer = {
    render(text) {
        if (!text) return '';

        // Handle manual line breaks if any (some APIs return \n)
        const lines = text.split('\n');
        if (lines.length > 1) {
            return lines.map(line => this.render(line)).join('<div class="mc-line-break"></div>');
        }

        // Split by § codes
        const parts = text.split('§');
        let html = '';
        let currentClasses = new Set();
        let currentColor = '';

        // First part has no code (unless it started with §)
        html += this._escapeHtml(parts[0]);

        for (let i = 1; i < parts.length; i++) {
            const part = parts[i];
            if (part.length === 0) continue;

            const code = part[0].toLowerCase();
            const content = part.substring(1);

            if (this._isColor(code)) {
                currentColor = `mc-color-${code}`;
                currentClasses.clear();
                html += `</span><span class="${currentColor}">`;
            } else if (this._isFormat(code)) {
                if (code === 'r') {
                    currentColor = '';
                    currentClasses.clear();
                    html += `</span><span>`;
                } else {
                    currentClasses.add(`mc-format-${code}`);
                    const classes = [currentColor, ...currentClasses].filter(Boolean).join(' ');
                    html += `</span><span class="${classes}">`;
                }
            } else {
                html += this._escapeHtml('§' + part);
                continue;
            }

            html += this._escapeHtml(content);
        }

        return `<div class="mc-motd"><span>${html}</span></div>`;
    },

    _isColor(c) {
        return /[0-9a-f]/.test(c);
    },

    _isFormat(c) {
        return /[klmnor]/.test(c);
    },

    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = MCRenderer;
}
