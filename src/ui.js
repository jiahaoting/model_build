// ============================================================
// 🎛 UI 管理（DOM 引用 + 基础交互提示 + 设置面板）
// ============================================================
export function initUI() {
    const el = (id) => document.getElementById(id);

    const ui = {
        loading: el('loading'),
        videoPanel: el('video-panel'),
        vpTitle: el('vp-title'),
        vpDesc: el('vp-desc'),
        modeText: el('mode-text'),
        controlsHint: el('controls-hint'),
        crosshair: el('crosshair'),

        // 设置面板
        settingsPanel: el('settings-panel'),
        btnSettings: el('btn-settings'),
        btnCloseSettings: el('btn-close-settings'),
        qualityButtons: {
            low: el('q-low'), medium: el('q-medium'), high: el('q-high')
        },
        volumeSlider: el('set-volume'),
        sensSlider: el('set-sensitivity'),
        showFps: el('set-fps'),
        fpsValue: el('fps-value'),
        fpsBadge: el('fps-badge'),

        hideLoading() { this.loading.style.display = 'none'; },

        setMode(text) { this.modeText.textContent = text; },

        setHint(html) { this.controlsHint.innerHTML = html; },

        showVideo(title, description) {
            this.vpTitle.textContent = title;
            this.vpDesc.textContent = description;
            this.videoPanel.style.display = 'block';
        },

        setCrosshair(on) { this.crosshair.style.display = on ? 'block' : 'none'; },

        toggleSettings(open) {
            const show = (open === undefined) ? (this.settingsPanel.style.display !== 'flex') : open;
            this.settingsPanel.style.display = show ? 'flex' : 'none';
        },

        setQuality(key) {
            for (const k in this.qualityButtons) {
                this.qualityButtons[k].classList.toggle('active', k === key);
            }
        },

        setFps(text) { this.fpsValue.textContent = text; }
    };

    ui.btnSettings.addEventListener('click', () => ui.toggleSettings());
    ui.btnCloseSettings.addEventListener('click', () => ui.toggleSettings(false));

    return ui;
}