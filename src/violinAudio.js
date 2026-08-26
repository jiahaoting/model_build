// ============================================================
// 小提琴 · 高品质真实采样音源（Musyng Kite · Solo Violin）
// ------------------------------------------------------------------
// · 复用本地 smplr 引擎的 Soundfont 加载器，加载本地 midi.js 采样
//   samples/violin/violin-mp3.js（真实录制弓弦采样，由 _download_violin_soundfont.js 下载）
// · 内置小型大厅卷积混响，赋予弓弦乐器自然空间感与延音
// · 若真实采样加载失败，自动有界重试，最终回退到程序化弦乐合成（避免完全静音）
// · 暴露 noteOn/noteOff，已兼容 violin.js 的 onSound(midi, vel, type)
// ============================================================
import { Soundfont } from './vendor/smplr.js';

export function createViolinAudio() {
    const state = { enabled: false, volume: 0.9 };

    const SF_URL = '/samples/violin/violin-mp3.js';   // 本地采样（mp3 各浏览器均可解码）
    const MAX_RETRIES = 2;
    const RETRY_DELAY = 3000;

    let ctx = null;
    let master = null;
    let convolver = null;
    let reverbGain = null;
    let vln = null;            // Soundfont 实例
    let vlnDry = null;         // 采样干声母线
    let vlnReady = false;
    let vlnLoading = false;
    let vlnFailed = false;
    let vlnFailCount = 0;
    const fallbacks = new Map();   // midi -> [osc...]（回退音色活动节点）

    // 小型大厅混响 IR：早期反射 + 晚期指数衰减噪声
    function buildReverbIR(sr) {
        const dur = 1.5;
        const len = Math.floor(sr * dur);
        const buf = ctx.createBuffer(2, len, sr);
        const early = [0.013, 0.022, 0.034, 0.051];
        for (let ch = 0; ch < 2; ch++) {
            const d = buf.getChannelData(ch);
            for (const t of early) {
                const idx = Math.floor(t * sr);
                if (idx < len) d[idx] += (Math.random() * 2 - 1) * 0.35;
            }
            const k = 6.9 / 1.1;
            let prev = 0;
            for (let i = 0; i < len; i++) {
                const t = i / sr;
                const env = Math.exp(-t * k);
                const noise = Math.random() * 2 - 1;
                prev += (noise - prev) * 0.16;
                d[i] += prev * env * 0.8;
            }
        }
        return buf;
    }

    function ensureCtx() {
        if (ctx) return;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();

        master = ctx.createGain();
        master.gain.value = state.volume;
        master.connect(ctx.destination);

        convolver = ctx.createConvolver();
        convolver.buffer = buildReverbIR(ctx.sampleRate);
        reverbGain = ctx.createGain();
        reverbGain.gain.value = 0.55;
        convolver.connect(reverbGain);
        reverbGain.connect(master);

        vlnDry = ctx.createGain();
        vlnDry.gain.value = 1.0;
        vlnDry.connect(master);
        const send = ctx.createGain();
        send.gain.value = 0.7;
        vlnDry.connect(send);
        send.connect(convolver);
    }

    async function loadViolin() {
        if (!ctx || vlnLoading || vlnReady || vlnFailed) return;
        vlnLoading = true;
        try {
            vln = new Soundfont(ctx, {
                instrumentUrl: SF_URL,
                destination: vlnDry,
                volume: 100,
                extraGain: 3
            });
            await vln.load;
            vlnReady = true;
            vlnFailCount = 0;
            console.log('[violin-audio] 高品质小提琴采样已就绪（Musyng Kite · Solo Violin）');
        } catch (err) {
            vln = null;
            vlnFailCount++;
            console.warn(`[violin-audio] 小提琴采样加载失败（${vlnFailCount}/${MAX_RETRIES}）`, err && err.message ? err.message : err);
            if (vlnFailCount >= MAX_RETRIES) vlnFailed = true;
        } finally {
            vlnLoading = false;
        }
        if (!vlnReady && !vlnFailed) setTimeout(loadViolin, RETRY_DELAY * vlnFailCount);
    }

    function noteOn(midi, velocity = 0.8) {
        if (!ctx || !state.enabled) return;
        if (midi == null || midi < 21 || midi > 108) return;

        if (vlnReady && vln) {
            const vel = Math.max(1, Math.round(Math.min(1, velocity) * 127));
            try {
                vln.start({ note: midi, velocity: vel, time: ctx.currentTime });
                return;
            } catch (err) { /* 触发异常则回退 */ }
        }
        fallbackOn(midi, velocity);
    }

    function noteOff(midi) {
        if (!ctx) return;
        if (vlnReady && vln) { try { vln.stop(midi); } catch (e) {} return; }
        fallbackOff(midi);
    }

    // —— 回退：程序化弓弦乐音色（仅在真实采样不可用时触发）——
    function fallbackOn(midi, velocity) {
        fallbackOff(midi);
        const freq = 440 * Math.pow(2, (midi - 69) / 12);
        const now = ctx.currentTime;

        const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = freq;
        const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = freq * 2;
        const o2g = ctx.createGain(); o2g.gain.value = 0.3;
        const vib = ctx.createOscillator(); vib.frequency.value = 5.4;
        const vibGain = ctx.createGain(); vibGain.gain.value = freq * 0.004;
        vib.connect(vibGain); vibGain.connect(o1.frequency);

        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2600; f.Q.value = 1.2;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, now);
        g.gain.linearRampToValueAtTime(Math.max(0.02, velocity) * 0.18, now + 0.08);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);

        o1.connect(f); o2.connect(o2g); o2g.connect(f); f.connect(g); g.connect(master);
        o1.start(now); o2.start(now); vib.start(now);
        o1.stop(now + 1.15); o2.stop(now + 1.15); vib.stop(now + 1.15);
        fallbacks.set(midi, [o1, o2, vib]);
    }

    function fallbackOff(midi) {
        const nodes = fallbacks.get(midi);
        if (!nodes) return;
        for (const n of nodes) { try { n.stop(); } catch (e) {} }
        fallbacks.delete(midi);
    }

    function resume() {
        ensureCtx();
        if (!ctx) return;
        state.enabled = true;
        if (ctx.state === 'suspended') ctx.resume();
        loadViolin();   // 首次交互后开始加载真实采样（失败有界重试，最终回退）
    }

    return {
        get state() { return state; },
        get ready() { return !!(ctx && state.enabled); },
        get sampleReady() { return vlnReady; },

        resume,
        noteOn(midi, velocity = 0.8) { noteOn(midi, velocity); },
        noteOff(midi) { noteOff(midi); },

        setVolume(v) {
            state.volume = Math.max(0, Math.min(1, v));
            if (master && ctx) master.gain.setTargetAtTime(state.volume, ctx.currentTime, 0.05);
        },
    };
}