// ============================================================
// 大型音乐厅 · 声学模拟（程序化生成，免外部资源）
// - 程序化卷积混响：指数衰减噪声 IR，模拟大厅约 2.2s 中频混响（RT60）
// - 大厅环境声：低频暖底噪 + 轻微空调气流 + 观众席细微窸窣
// - 钢琴音符：多泛音 + 轻微失谐，经混响送回，舞台距离衰减
// - 脚步声：短促滤波噪声，经少量混响
// 遵守浏览器自动播放策略：首次交互后 resume() 解锁。
// ============================================================
import * as THREE from 'three';
import { createViolinEngine } from './violinEngine.js';

export function createConcertAudioManager() {
    const state = {
        enabled: false,
        masterVolume: 0.8,
        pedal: false           // 延音踏板状态
    };

    const PENTATONIC_MIDI = [60, 62, 64, 67, 69, 72, 76, 79];

    let ctx = null;
    let master = null;        // 总输出增益
    let convolver = null;     // 混响卷积节点（湿声）
    let reverbGain = null;    // 混响量
    let ambient = null;       // 环境声循环源
    let ambientGain = null;
    let footstepBuffer = null;
    let noteCache = new Map();   // MIDI -> 合成采样缓冲（懒加载缓存，回退用）
    let voices = new Map();      // MIDI -> 正在发声的音符节点
    let sustained = new Set();   // 延音踏板保持的 MIDI 集合
    let camera = null;

    // —— 高质量真实采样钢琴（smplr / Splendid Grand Piano，4 力度层） ——
    let smp = null;            // SplendidGrandPiano 实例
    let smpReady = false;
    let smpLoading = false;
    let smpFailed = false;     // 重试耗尽后的永久回退标记
    let smpFailCount = 0;      // 连续失败次数（有界重试用）
    let smpProgress = 0;       // 采样加载进度 0..1（用于 UI 状态显示）
    let smpDry = null;         // 采样干声母线（→ master 干声 + → 大厅混响发送）

    // —— 高品质真实采样小提琴（smplr / Soundfont，FluidR3_GM · Violin） ——
    let vln = null;            // smplr Soundfont 实例
    let vlnReady = false;
    let vlnLoading = false;
    let vlnFailed = false;     // 重试耗尽后的永久回退标记
    let vlnFailCount = 0;      // 连续失败次数（有界重试用）
    let vlnDry = null;         // 小提琴干声母线（→ master 干声 + → 大厅混响发送）
    const vlnVoices = new Set();   // 当前按住的小提琴 MIDI（同音重触发时清理旧声）
    const violinSynth = new Map(); // 小提琴合成回退音色的活动节点
    let vlnEngine = null;      // 原生采样声部引擎（支持揉弦/滑音/跳弓/颤音等逐声部调制）
    let vlnTrace = false;      // 首次小提琴发声时打印一次实际路径（排查「无声」用）
    let vlnEntryTrace = 0;     // 前几次调用打印入参/状态，确认 violinNoteOn 是否被触达

    // 采样引擎模块与样本均本地化，彻底绕开境外 CDN（unpkg / jsdelivr / GitHub Pages）访问不稳定问题。
    // 模块位于 src/vendor/smplr.js，样本位于 samples/splendid-grand-piano/（由 _download_samples.js 下载）。
    const SMP_MODULE_URL = './vendor/smplr.js';                    // smplr 引擎模块（本地）
    const SMP_SAMPLES_BASE_URL = '/samples/splendid-grand-piano/'; // 采样目录（本地）
    const SMP_SAMPLES_FORMATS = ['ogg'];                           // 本地仅下载了 OGG 格式
    const SMP_MAX_RETRIES = 3;       // 自动重试总次数（含首次）
    const SMP_RETRY_DELAY = 4000;    // 基础退避间隔（ms），随重试次数递增
    const VLN_SOUNDFONT_URL = '/samples/violin/violin-mp3.js';     // 本地 FluidR3_GM 小提琴采样（主源：MP3）
    const VLN_SOUNDFONT_OGG_URL = '/samples/violin/violin-ogg.js'; // 备用音源（OGG Vorbis，MP3 解码受限时回退）
    const VLN_MAX_RETRIES = 2;       // 小提琴采样自动重试总次数（含首次）
    const VLN_RETRY_DELAY = 3000;    // 小提琴采样基础退避间隔（ms）

    // —— IR：指数衰减噪声 + 早期稀疏反射 ——
    function buildReverbIR(sr) {
        const dur = 3.5;
        const len = Math.floor(sr * dur);
        const buf = ctx.createBuffer(2, len, sr);
        // 早期反射时间（秒），营造大厅「首次反射」空间感
        const early = [0.013, 0.020, 0.028, 0.037, 0.050, 0.068, 0.090, 0.118];
        for (let ch = 0; ch < 2; ch++) {
            const d = buf.getChannelData(ch);
            // 早期反射
            for (const t of early) {
                const idx = Math.floor(t * sr);
                if (idx < len) d[idx] += (Math.random() * 2 - 1) * 0.4;
            }
            // 晚期混响：低通程度更高的指数衰减噪声（音色偏暖）
            const k = 6.9 / 2.2; // 60dB 衰减对应 T=2.2s
            let prev = 0;
            for (let i = 0; i < len; i++) {
                const t = i / sr;
                const env = Math.exp(-t * k);
                const noise = Math.random() * 2 - 1;
                prev += (noise - prev) * 0.14;      // 单极点低通
                d[i] += prev * env * 0.85;
            }
        }
        return buf;
    }

    function buildAmbientBuffer(sr) {
        const dur = 8;
        const len = Math.floor(sr * dur);
        const buf = ctx.createBuffer(2, len, sr);
        for (let ch = 0; ch < 2; ch++) {
            const d = buf.getChannelData(ch);
            let brown = 0;
            const phase = ch * Math.PI * 0.7 + Math.random();
            for (let i = 0; i < len; i++) {
                const t = i / sr;
                brown = (brown + 0.02 * (Math.random() * 2 - 1)) / 1.02;
                // 大厅低频暖底
                const drone = Math.sin(2 * Math.PI * 38 * t + phase) * 0.32
                            + Math.sin(2 * Math.PI * 57 * t + phase * 0.6) * 0.18;
                // 空调气流（低频颤振）
                const hvac = Math.sin(2 * Math.PI * 0.12 * t + phase) * 0.5 + 0.5;
                // 观众席细微窸窣（高频极弱）
                const rustle = (Math.random() * 2 - 1) * 0.008;
                const swl = 0.8 + 0.2 * Math.sin(2 * Math.PI * 0.05 * t + ch * 1.7);
                d[i] = brown * 0.10 + drone * 0.05 * swl + hvac * 0.004 + rustle;
            }
            // 首尾淡化，避免循环咔哒
            const fade = Math.floor(sr * 0.05);
            for (let i = 0; i < fade; i++) {
                const g = i / fade;
                d[i] *= g;
                d[len - 1 - i] *= g;
            }
        }
        return buf;
    }

    function buildFootstepBuffer(sr) {
        const dur = 0.16;
        const len = Math.floor(sr * dur);
        const buf = ctx.createBuffer(1, len, sr);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
            const t = i / sr;
            d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 34);
        }
        return buf;
    }

    // 多泛音钢琴采样合成（真实钢琴声学模型：非谐拉伸 + 逐泛音衰减 + 击弦瞬态）
    function synthPianoNote(sr, freq) {
        const dur = 4.5;            // 足够长的余音窗口，配合延音踏板
        const len = Math.floor(sr * dur);
        const buf = ctx.createBuffer(1, len, sr);
        const d = buf.getChannelData(0);
        const B = 0.0004;           // 弦的非谐系数（高音轻微拉伸，贴近真实弦振）
        const N = 10;               // 泛音数量
        for (let i = 0; i < len; i++) {
            const t = i / sr;
            // 击弦瞬态（琴槌触弦的短促噪声，快速衰减）
            const hammer = (Math.random() * 2 - 1) * Math.exp(-t * 260) * 0.16;
            // 攻击 + 自然指数衰减包络
            const env = (1 - Math.exp(-t * 240)) * Math.exp(-t * 0.5);
            let s = 0;
            for (let n = 1; n <= N; n++) {
                const f = freq * n * Math.sqrt(1 + B * n * n);   // 非谐拉伸
                const decay = Math.exp(-t * (1.3 + n * 1.35));   // 高阶泛音衰减更快
                const amp = 1 / Math.pow(n, 1.15);                // 泛音幅度递减
                s += Math.sin(2 * Math.PI * f * t) * amp * decay;
            }
            d[i] = s * 0.22 * env + hammer;
        }
        return buf;
    }

    function getNoteBuffer(midi) {
        if (noteCache.has(midi)) return noteCache.get(midi);
        const freq = 440 * Math.pow(2, (midi - 69) / 12);
        const buf = synthPianoNote(ctx.sampleRate, freq);
        noteCache.set(midi, buf);
        return buf;
    }

    function noteOn(midi, velocity = 0.8) {
        if (!ctx || !state.enabled || !voices) return;
        if (midi == null || midi < 21 || midi > 108) return;

        // 优先使用真实采样钢琴（多力度层、自然泛音与动态）
        if (smpReady && smp) {
            if (voices.has(midi)) releaseVoice(midi, 0.03);   // 重击同键先快速释放旧声
            const vel127 = Math.max(1, Math.round(Math.min(1, velocity) * 127));
            try {
                const stopFn = smp.start({ note: midi, velocity: vel127, time: ctx.currentTime });
                voices.set(midi, { sampler: true, stopFn });
            } catch (err) {
                synthNoteOn(midi, velocity);   // 采样触发异常时回退
            }
            return;
        }

        synthNoteOn(midi, velocity);
    }

    function synthNoteOn(midi, velocity) {
        if (voices.has(midi)) releaseVoice(midi, 0.05);   // 重击同键先快速释放旧声

        const now = ctx.currentTime;
        const src = ctx.createBufferSource();
        src.buffer = getNoteBuffer(midi);

        // 力度 → 亮度（低通截止频率）+ 音量（强弱音表现力）
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 900 + velocity * 9000;
        filter.Q.value = 0.5;

        const gain = ctx.createGain();
        gain.gain.value = 0.14 + velocity * 0.5;

        src.connect(filter); filter.connect(gain); gain.connect(master);

        // 混响发送（大厅空间声学）
        const send = ctx.createGain();
        send.gain.value = 0.9;
        filter.connect(send); send.connect(convolver);

        src.start(now);
        const voice = { src, gain, filter, send, sampler: false };
        voices.set(midi, voice);
        src.onended = () => {
            try { gain.disconnect(); send.disconnect(); filter.disconnect(); } catch (e) {}
        };
    }

    function releaseVoice(midi, dur = 0.55) {
        if (!voices) return;
        const v = voices.get(midi);
        if (!v) return;
        voices.delete(midi);
        if (sustained) sustained.delete(midi);

        // 采样音色：调用 stop 触发自然释键衰减
        if (v.sampler) {
            try { if (v.stopFn) v.stopFn(); else if (smp) smp.stop(midi); } catch (e) {}
            return;
        }

        const now = ctx.currentTime;
        const g = v.gain.gain;
        g.cancelScheduledValues(now);
        g.setValueAtTime(Math.max(g.value, 0.0001), now);
        g.linearRampToValueAtTime(0.0001, now + dur);   // 按键释放的余音衰减
        try { v.src.stop(now + dur + 0.1); } catch (e) {}
    }

    function noteOff(midi) {
        if (!voices) return;
        if (midi == null || midi < 21 || midi > 108) return;
        if (state.pedal) { sustained.add(midi); }
        else releaseVoice(midi, 0.55);
    }

    function setSustain(on) {
        state.pedal = !!on;
        if (!on && sustained) {
            for (const m of [...sustained]) releaseVoice(m, 0.8);
            sustained.clear();
        }
    }

    function ensureReady() {
        if (ctx) return;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();

        master = ctx.createGain();
        master.gain.value = state.masterVolume;
        master.connect(ctx.destination);

        // 混响链（仅钢琴 / 脚步发湿声）
        convolver = ctx.createConvolver();
        convolver.buffer = buildReverbIR(ctx.sampleRate);
        reverbGain = ctx.createGain();
        reverbGain.gain.value = 0.85;
        convolver.connect(reverbGain);
        reverbGain.connect(master);

        // 环境声循环
        ambientGain = ctx.createGain();
        ambientGain.gain.value = 0.16;
        ambientGain.connect(master);
        ambient = ctx.createBufferSource();
        ambient.buffer = buildAmbientBuffer(ctx.sampleRate);
        ambient.loop = true;
        ambient.connect(ambientGain);

        footstepBuffer = buildFootstepBuffer(ctx.sampleRate);

        // 真实采样钢琴母线：干声入 master，同时发送到大厅卷积混响（与合成音色共用声学空间）
        smpDry = ctx.createGain();
        smpDry.gain.value = 1.0;
        smpDry.connect(master);
        const smpSend = ctx.createGain();
        smpSend.gain.value = 0.8;
        smpDry.connect(smpSend);
        smpSend.connect(convolver);

        // 真实采样小提琴母线：同样干声入 master + 发送大厅混响，弓弦乐器更依赖混响延音
        vlnDry = ctx.createGain();
        vlnDry.gain.value = 0.8;
        vlnDry.connect(master);
        const vlnSend = ctx.createGain();
        vlnSend.gain.value = 0.35;   // 混响发送量进一步拉低，弓弦音色干练、贴近真实近距离收音
        vlnDry.connect(vlnSend);
        vlnSend.connect(convolver);

        // 原生采样声部引擎：解码同一份 Soundfont，自建声部以获得逐声部技法调制能力
        vlnEngine = createViolinEngine(ctx, vlnDry);
    }

    // —— 加载本地真实采样钢琴（Splendid Grand Piano · Steinway 采样 · 4 力度层） ——
    // 模块与样本均已本地化；失败时先做有界重试，最终仍失败才静默回退到程序化合成。
    async function loadSampler() {
        if (!ctx || smpLoading || smpReady || smpFailed) return;
        smpLoading = true;
        smpProgress = 0;
        try {
            // —— 阶段 1：加载本地 smplr 采样引擎模块 ——
            const mod = await import(SMP_MODULE_URL);
            if (!mod || !mod.SplendidGrandPiano) {
                throw new Error('本地 smplr 采样引擎模块不可用');
            }

            // —— 阶段 2：构建实例并等待本地采样缓冲全部就绪 ——
            smp = new mod.SplendidGrandPiano(ctx, {
                destination: smpDry,
                volume: 100,
                baseUrl: SMP_SAMPLES_BASE_URL,
                formats: SMP_SAMPLES_FORMATS,
                onLoadProgress: ({ loaded, total }) => {
                    if (total) smpProgress = loaded / total;
                    if (loaded === total) console.log('[audio] 钢琴采样加载完成', loaded);
                }
            });
            await smp.load;   // v0.20.0 的加载 Promise 名称为 load（非 ready）
            smpReady = true;
            smpFailCount = 0;
            console.log('[audio] 本地真实采样钢琴已就绪');
        } catch (err) {
            smp = null;
            smpFailCount++;
            console.warn(`[audio] 真实采样加载失败（${smpFailCount}/${SMP_MAX_RETRIES} 次）`, err && err.message ? err.message : err);
            if (smpFailCount >= SMP_MAX_RETRIES) smpFailed = true;   // 重试耗尽，永久回退
        } finally {
            smpLoading = false;
        }
        // 有界退避重试：仍有剩余次数时，延迟后自动再次尝试
        if (!smpReady && !smpFailed) {
            setTimeout(loadSampler, SMP_RETRY_DELAY * smpFailCount);
        }
    }

    // 手动重试（例如断网恢复后）：清除失败标记并重新加载
    function retrySampler() {
        smpFailed = false;
        smpFailCount = 0;
        smp = null;
        loadSampler();
    }

    // —— 加载本地真实采样小提琴（FluidR3_GM · Violin）——
    async function loadViolinSampler() {
        if (!ctx || vlnLoading || vlnReady || vlnFailed) return;
        vlnLoading = true;
        try {
            const mod = await import(SMP_MODULE_URL);
            if (!mod || !mod.Soundfont) throw new Error('本地 smplr Soundfont 加载器不可用');
            vln = new mod.Soundfont(ctx, {
                instrumentUrl: VLN_SOUNDFONT_URL,
                destination: vlnDry,
                volume: 100,
                extraGain: 3
            });
            await vln.load;
            vlnReady = true;
            vlnFailCount = 0;
            console.log('[audio] 本地真实采样小提琴已就绪（FluidR3_GM · Violin）');
        } catch (err) {
            vln = null;
            vlnFailCount++;
            console.warn(`[audio] 小提琴采样加载失败（${vlnFailCount}/${VLN_MAX_RETRIES} 次）`, err && err.message ? err.message : err);
            if (vlnFailCount >= VLN_MAX_RETRIES) vlnFailed = true;   // 重试耗尽，永久回退
        } finally {
            vlnLoading = false;
        }
        if (!vlnReady && !vlnFailed) {
            setTimeout(loadViolinSampler, VLN_RETRY_DELAY * vlnFailCount);
        }
    }

    // —— 加载原生采样声部引擎（优先于 smplr：支持逐声部技法调制）——
    async function loadViolinEngine() {
        if (!ctx || !vlnEngine) return;
        await vlnEngine.load(VLN_SOUNDFONT_URL, VLN_SOUNDFONT_OGG_URL);
        if (vlnEngine.ready) {
            console.log('[audio] 小提琴技法声部引擎已就绪');
        } else {
            // 解码失败则回退到 smplr 采样 / 合成
            console.warn('[audio] 小提琴技法声部引擎不可用，回退 smplr/合成');
        }
    }

    // —— 小提琴合成回退：Karplus-Strong 弓弦物理模型（采样不可用时的兜底，保证有声且贴近弓弦音色） ——
    function violinSynthOn(midi, velocity) {
        violinSynthOff(midi);
        const freq = 440 * Math.pow(2, (midi - 69) / 12);
        const now = ctx.currentTime;

        // 弓毛摩擦激励：循环白噪声（宽带激励）
        const noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
        const nd = noiseBuf.getChannelData(0);
        for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
        const exciter = ctx.createBufferSource();
        exciter.buffer = noiseBuf;
        exciter.loop = true;

        // 弦振环：delay(1/freq) + 低通 + 反馈（Karplus-Strong）
        const delay = ctx.createDelay(1.0);
        delay.delayTime.value = 1 / freq;
        const loopLp = ctx.createBiquadFilter();
        loopLp.type = 'lowpass';
        loopLp.frequency.value = Math.max(2500, freq * 10);
        const feedback = ctx.createGain();
        feedback.gain.value = 0.955;

        const bowFilter = ctx.createBiquadFilter();   // 弓毛接触滤波，去除过亮噪声
        bowFilter.type = 'bandpass';
        bowFilter.frequency.value = Math.min(4200, freq * 6);
        bowFilter.Q.value = 0.8;

        exciter.connect(bowFilter);
        bowFilter.connect(delay);
        delay.connect(loopLp);
        loopLp.connect(feedback);
        feedback.connect(delay);

        // 揉弦：LFO 微调弦长（delay 时间）
        const vib = ctx.createOscillator();
        vib.frequency.value = 5.4;
        const vibG = ctx.createGain();
        vibG.gain.value = 0.004 / freq;
        vib.connect(vibG);
        vibG.connect(delay.delayTime);

        // 琴体低通 + 电平包络
        const body = ctx.createBiquadFilter();
        body.type = 'lowpass';
        body.frequency.value = 3600;
        body.Q.value = 1.0;
        const g = ctx.createGain();
        const v = Math.max(0.03, velocity);
        g.gain.setValueAtTime(0.0001, now);
        g.gain.linearRampToValueAtTime(v * 0.4, now + 0.05);
        g.gain.setTargetAtTime(v * 0.32, now + 0.05, 0.18);

        delay.connect(body);
        body.connect(g);
        g.connect(master);
        const send = ctx.createGain(); send.gain.value = 0.5; body.connect(send); send.connect(convolver);

        exciter.start(now);
        vib.start(now);
        violinSynth.set(midi, { exciter, vib, g });
    }

    function violinSynthOff(midi) {
        const s = violinSynth.get(midi);
        if (!s) return;
        const now = ctx.currentTime;
        try {
            s.g.gain.cancelScheduledValues(now);
            s.g.gain.setTargetAtTime(0.0001, now, 0.07);
        } catch (e) {}
        for (const n of [s.exciter, s.vib]) { try { n.stop(now + 0.4); } catch (e) {} }
        violinSynth.delete(midi);
    }

    function violinNoteOn(midi, velocity = 0.8, perf = null) {
        if (vlnEntryTrace < 5) {
            vlnEntryTrace++;
            console.log('[audio] violinNoteOn CALLED midi=' + midi +
                ' velocity=' + velocity +
                ' enabled=' + state.enabled + ' ctx=' + !!ctx +
                ' engineReady=' + !!(vlnEngine && vlnEngine.ready) +
                ' smplrReady=' + !!vlnReady);
        }
        if (!ctx || !state.enabled) return;
        if (midi == null || midi < 21 || midi > 108) return;

        let path = '合成回退';

        // 优先：原生技法声部引擎（逐声部调制揉弦/滑音/跳弓/颤音 + 琴体共鸣）
        if (vlnEngine && vlnEngine.ready) {
            try {
                if (vlnEngine.noteOn(midi, velocity, perf)) path = '原生声部引擎';
            } catch (err) {
                console.warn('[audio] 原生引擎发声异常，回退采样/合成', err && err.message ? err.message : err);
            }
        }

        // 回退：smplr Soundfont 采样
        if (path === '合成回退' && vlnReady && vln) {
            if (vlnVoices.has(midi)) { try { vln.stop(midi); } catch (e) {} }   // 同音重触发先释放旧声
            const vel127 = Math.max(1, Math.round(Math.min(1, velocity) * 127));
            try {
                vln.start({ note: midi, velocity: vel127, time: ctx.currentTime });
                vlnVoices.add(midi);
                path = 'smplr 采样';
            } catch (err) { /* 采样触发异常则回退 */ }
        }

        if (path === '合成回退') violinSynthOn(midi, velocity);

        // 首次发声打印实际路径，便于定位「小提琴无声」：engineReady / smplrReady / 最终路径
        if (!vlnTrace) {
            vlnTrace = true;
            console.log('[audio] 小提琴发声路径=' + path +
                ' (engineReady=' + !!(vlnEngine && vlnEngine.ready) +
                ', smplrReady=' + !!vlnReady + ')');
        }
    }

    function violinNoteOff(midi) {
        if (midi == null) return;
        if (vlnEngine && vlnEngine.ready) vlnEngine.noteOff(midi);
        if (vlnReady && vln) { try { vln.stop(midi); } catch (e) {} }
        vlnVoices.delete(midi);
        violinSynthOff(midi);
    }

    // —— 音色测试：覆盖完整音域、三个力度层级交替 ——
    let testEv = [];       // { t, type, midi, vel }
    let testIdx = 0;
    let testClock = 0;
    let testing = false;

    function testRun() {
        if (!ctx || !state.enabled) return;
        const ev = [];
        const vels = [36, 65, 92, 120];           // 与采样 4 力度层对应（pp / mp / mf / ff）
        let t = 0, v = 0;
        for (let m = 21; m <= 108; m += 2) {          // A0 → C8，全程隔一个半音
            const vel = vels[v % vels.length] / 127; v++;
            ev.push({ t, type: 'on', midi: m, vel });
            ev.push({ t: t + 0.34, type: 'off', midi: m });
            t += 0.24;
        }
        testEv = ev; testIdx = 0; testClock = ctx.currentTime; testing = true;
    }

    function stepTest() {
        if (!testing || testIdx >= testEv.length) { testing = false; return; }
        const el = ctx.currentTime - testClock;
        while (testIdx < testEv.length && testEv[testIdx].t <= el) {
            const e = testEv[testIdx++];
            if (e.type === 'on') noteOn(e.midi, e.vel);
            else noteOff(e.midi);
        }
    }

    function distanceGain() {
        if (!camera) return 1;
        // 舞台中心（钢琴位置）为声源参考点
        const dx = camera.position.x - 0;
        const dy = camera.position.y - 1.4;
        const dz = camera.position.z - (-13.0);
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const g = 1 / (1 + dist * dist / 120);
        return Math.max(0.05, Math.min(1, g));
    }

    function playThroughReverb(buffer, opts = {}) {
        if (!ctx || !state.enabled) return;
        const now = ctx.currentTime;

        const dry = ctx.createGain();
        dry.gain.setValueAtTime(0.0001, now);
        dry.gain.linearRampToValueAtTime((opts.gain || 0.4) * (opts.dist || 1), now + 0.006);

        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.playbackRate.value = opts.rate || 1;

        if (opts.filter) {
            const f = ctx.createBiquadFilter();
            f.type = opts.filter;
            f.frequency.value = opts.frequency || 800;
            src.connect(f); f.connect(dry);
        } else {
            src.connect(dry);
        }
        dry.connect(master);

        // 混响发送
        const send = ctx.createGain();
        send.gain.value = opts.reverb || 0.5;
        if (opts.filter) {
            const f2 = ctx.createBiquadFilter();
            f2.type = opts.filter; f2.frequency.value = (opts.frequency || 800);
            src.connect(f2); f2.connect(send);
        } else {
            src.connect(send);
        }
        send.connect(convolver);

        const dur = (opts.decay || 0.2) + 3.0; // 让混响尾巴完整
        src.start(now);
        src.stop(now + dur);
    }

    function updateListener() {
        if (!ctx || !camera) return;
        const l = ctx.listener;
        if (l.positionX) {
            l.positionX.value = camera.position.x;
            l.positionY.value = camera.position.y;
            l.positionZ.value = camera.position.z;
        } else if (l.setPosition) {
            l.setPosition(camera.position.x, camera.position.y, camera.position.z);
        }
        const v = new THREE.Vector3();
        camera.getWorldDirection(v);
        if (l.forwardX) {
            l.forwardX.value = v.x; l.forwardY.value = v.y; l.forwardZ.value = v.z;
            l.upX.value = camera.up.x; l.upY.value = camera.up.y; l.upZ.value = camera.up.z;
        } else if (l.setOrientation) {
            l.setOrientation(v.x, v.y, v.z, camera.up.x, camera.up.y, camera.up.z);
        }
    }

    return {
        get state() { return state; },

        // 当前音频时钟（秒），用于演奏定时器做到采样级精确同步
        now() { return ctx ? ctx.currentTime : 0; },
        get ready() { return !!(ctx && state.enabled); },
        // 采样引擎状态：idle=未启动 / loading=加载中(含重试) / ready=真实采样已就绪 / failed=回退合成音色
        get samplerStatus() {
            return smpReady ? 'ready'
                : (smpFailed ? 'failed'
                : (smpLoading || smpFailCount > 0 ? 'loading' : 'idle'));
        },
        get samplerProgress() { return smpProgress; },
        get testing() { return testing; },

        attach(cam) { camera = cam; ensureReady(); },

        resume() {
            ensureReady();
            if (!ctx) return;
            state.enabled = true;
            if (ctx.state === 'suspended') ctx.resume();
            if (ambient && ambient.onended === null) {
                try { if (!ambient.started) { ambient.start(); ambient.started = true; } } catch (e) {}
            }
            loadSampler();        // 首次交互后开始拉取钢琴真实采样（异步，失败回退）
            loadViolinSampler();   // 同上：拉取小提琴真实采样
            loadViolinEngine();    // 解码小提琴音源 → 技法声部引擎（揉弦/滑音/跳弓/颤音）
        },

        // 每帧调用，同步听者位置（用于距离衰减与未来空间化），并驱动音色测试事件
        update(cam) { camera = cam; updateListener(); stepTest(); },

        setVolume(v) {
            state.masterVolume = Math.max(0, Math.min(1, v));
            if (master) master.gain.setTargetAtTime(state.masterVolume, ctx.currentTime, 0.05);
        },

        playFootstep(running = false) {
            playThroughReverb(footstepBuffer, {
                rate: 0.85 + Math.random() * 0.3,
                filter: 'lowpass', frequency: running ? 950 : 600,
                gain: running ? 0.4 : 0.28,
                decay: running ? 0.11 : 0.15,
                reverb: 0.35,
                dist: 1
            });
        },

        // —— 钢琴演奏接口（键盘映射驱动）：按下 / 释放 / 延音踏板 ——
        noteOn(midi, velocity = 0.75) { noteOn(midi, velocity); },
        noteOff(midi) { noteOff(midi); },
        setSustain(on) { setSustain(on); },

        // —— 小提琴演奏接口（谱面乐器路由驱动）：按下 / 释放（可携带技法 performance 描述符）——
        violinNoteOn(midi, velocity = 0.8, perf = null) { violinNoteOn(midi, velocity, perf); },
        violinNoteOff(midi) { violinNoteOff(midi); },

        // 音色测试：覆盖 A0~C8 全音域、4 力度层级交替试听
        testRun() { testRun(); },

        // 手动重新加载采样（断网恢复后调用）
        retrySampler() { retrySampler(); },

        playPianoNote() {
            if (!ctx || !state.enabled) return;
            const midi = PENTATONIC_MIDI[Math.floor(Math.random() * PENTATONIC_MIDI.length)];
            const freq = 440 * Math.pow(2, (midi - 69) / 12);
            playThroughReverb(synthPianoNote(ctx.sampleRate, freq), {
                gain: 0.5,
                decay: 2.8,
                reverb: 0.9,
                dist: distanceGain()
            });
        }
    };
}