import * as THREE from 'three';
import { SETTINGS } from './config.js';

// ============================================================
// 🔊 空间音频管理（程序化生成，免外部资源）
// - 环境氛围音：循环的室内底噪 + 低频氛围垫（THREE.Audio 非定位）
// - 脚步声：短促滤波噪声，随奔跑改变音色
// - 钢琴触发音：正弦+泛音合成的音符（五声音阶随机）
// 遵守浏览器自动播放策略：首次用户交互后调用 resume() 解锁。
// 使用 THREE.AudioListener 挂载到相机，为未来 PositionalAudio 预留。
// ============================================================
export function createAudioManager() {
    const state = {
        enabled: false,
        masterVolume: SETTINGS.volume,
        ambientLevel: 0.45
    };

    let listener = null;      // THREE.AudioListener
    let ambient = null;       // THREE.Audio（环境声）
    let footstepBuffer = null;
    let _ctx = null;

    const PENTATONIC = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25];

    // —— 程序化音频缓冲生成 ——
    function buildAmbientBuffer(ctx) {
        const sr = ctx.sampleRate;
        const dur = 6;
        const len = Math.floor(sr * dur);
        const buf = ctx.createBuffer(2, len, sr);
        for (let ch = 0; ch < 2; ch++) {
            const d = buf.getChannelData(ch);
            let brown = 0;
            const phase = Math.random() * Math.PI * 2;
            for (let i = 0; i < len; i++) {
                const t = i / sr;
                brown = (brown + 0.02 * (Math.random() * 2 - 1)) / 1.02;
                const roomTone = brown * 0.55;
                const drone = Math.sin(2 * Math.PI * 55 * t + phase) * 0.5
                            + Math.sin(2 * Math.PI * 82.4 * t + phase * 0.7) * 0.28
                            + Math.sin(2 * Math.PI * 110 * t + phase * 0.5) * 0.12;
                const swell = 0.75 + 0.25 * Math.sin(2 * Math.PI * 0.08 * t + ch * Math.PI);
                d[i] = roomTone * 0.14 + drone * 0.09 * swell;
            }
        }
        return buf;
    }

    function buildFootstepBuffer(ctx) {
        const sr = ctx.sampleRate;
        const dur = 0.16;
        const len = Math.floor(sr * dur);
        const buf = ctx.createBuffer(1, len, sr);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
            const t = i / sr;
            d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 36);
        }
        return buf;
    }

    function synthPianoNote(ctx, freq) {
        const sr = ctx.sampleRate;
        const dur = 2.5;
        const len = Math.floor(sr * dur);
        const buf = ctx.createBuffer(1, len, sr);
        const d = buf.getChannelData(0);
        const harmonics = [
            { m: 1, a: 1.0 }, { m: 2, a: 0.5 }, { m: 3, a: 0.25 },
            { m: 4, a: 0.12 }, { m: 5, a: 0.06 }, { m: 6, a: 0.03 }
        ];
        for (let i = 0; i < len; i++) {
            const t = i / sr;
            const env = Math.exp(-t * 2.2) * (1 - Math.exp(-t * 60));
            let s = 0;
            for (const h of harmonics) s += Math.sin(2 * Math.PI * freq * h.m * t) * h.a;
            d[i] = s * 0.22 * env;
        }
        return buf;
    }

    function ensureReady(camera) {
        if (listener) { if (camera && listener.parent !== camera) camera.add(listener); return; }
        listener = new THREE.AudioListener();
        _ctx = listener.context;
        if (camera) camera.add(listener);

        ambient = new THREE.Audio(listener);
        ambient.setBuffer(buildAmbientBuffer(_ctx));
        ambient.setLoop(true);
        ambient.setVolume(state.masterVolume * state.ambientLevel);

        footstepBuffer = buildFootstepBuffer(_ctx);
    }

    function playOneShot(buffer, opts = {}) {
        if (!_ctx || !state.enabled) return;
        const now = _ctx.currentTime;
        const src = _ctx.createBufferSource();
        src.buffer = buffer;
        src.playbackRate.value = opts.rate || 1;

        const gain = _ctx.createGain();
        const peak = (opts.gain || 0.4) * state.masterVolume;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(peak, now + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + (opts.decay || 0.14));

        if (opts.filter && opts.filter !== 'none') {
            const filter = _ctx.createBiquadFilter();
            filter.type = opts.filter;
            filter.frequency.value = opts.frequency || 800;
            src.connect(filter); filter.connect(gain);
        } else {
            src.connect(gain);
        }
        gain.connect(_ctx.destination);
        src.start(now);
        src.stop(now + (opts.decay || 0.14) + 0.05);
    }

    return {
        get state() { return state; },

        // 挂载到相机并构建环境声（场景初始化时调用）
        attach(camera) { ensureReady(camera); },

        // 首个用户交互时调用
        resume() {
            ensureReady();
            state.enabled = true;
            if (_ctx && _ctx.state === 'suspended') _ctx.resume();
            if (ambient && !ambient.isPlaying) ambient.play();
        },

        setVolume(v) {
            state.masterVolume = Math.max(0, Math.min(1, v));
            if (ambient) ambient.setVolume(state.masterVolume * state.ambientLevel);
        },

        playFootstep(running = false) {
            playOneShot(footstepBuffer, {
                rate: 0.85 + Math.random() * 0.3,
                frequency: running ? 900 : 550,
                gain: running ? 0.5 : 0.35,
                decay: running ? 0.11 : 0.15
            });
        },

        playPianoNote() {
            if (!_ctx || !state.enabled) return;
            const freq = PENTATONIC[Math.floor(Math.random() * PENTATONIC.length)];
            playOneShot(synthPianoNote(_ctx, freq), {
                filter: 'none', gain: 0.5, decay: 2.4
            });
        }
    };
}