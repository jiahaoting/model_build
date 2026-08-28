// ============================================================
// 小提琴音色引擎（原生 Web Audio 采样声部）
// ------------------------------------------------------------------
// · 直接解码本地 MIDI.js Soundfont（samples/violin/violin-mp3.js），
//   用 AudioBufferSourceNode 自建「单音声部」，从而获得 smplr 不具备的
//   「逐声部连续音高/包络/滤波」控制能力。
// · 逐声部可实时调制：揉弦（detune LFO）、滑音（detune 斜坡）、
//   跳弓（短促包络）、颤音（幅度 LFO），并依据弓法参数（接触点/压力/速度）
//   映射音色亮度与强弱。
// · 共享「琴体共鸣箱」滤波器组，模拟小提琴琴体的共振着色。
// ============================================================

// 琴体/共鸣共振近似（小提琴主体固有模态，单位 Hz）—— 给采样叠加真实琴体染色
const BODY_MODES = [
    { f: 280, gain: 7, q: 6 },    // 空气腔 Helmholtz 共振
    { f: 470, gain: 5, q: 6 },
    { f: 680, gain: 4, q: 7 },
    { f: 1050, gain: 3, q: 8 },
    { f: 1650, gain: 2.5, q: 9 },
    { f: 2600, gain: 2, q: 10 },
    { f: 4200, gain: 1.5, q: 10 },
];

function noteNameToMidi(name) {
    const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(String(name).trim());
    if (!m) return null;
    const step = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase()];
    const alt = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
    return step + alt + 12 * (parseInt(m[3], 10) + 1);
}
function base64ToArrayBuffer(dataUrl) {
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
}

// —— 采样归一化：补偿不同音源录制电平差异，将每个采样按目标峰值等比例对齐。
//    FluidR3_GM 小提琴电平适中，目标峰值取保守值避免整体音量过高，同时强弱动态仍由 velocity 控制。
//    maxGain 封顶防止对异常静音/极弱采样过度放大。 ——
function normalizeBuffer(buf, targetPeak, maxGain) {
    const ch = buf.numberOfChannels || 1;
    let peak = 0;
    for (let c = 0; c < ch; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < d.length; i++) {
            const a = Math.abs(d[i]);
            if (a > peak) peak = a;
        }
    }
    if (!(peak > 0)) return;
    let gain = targetPeak / peak;
    if (gain > maxGain) gain = maxGain;
    if (gain <= 1.0) return;   // 已达到或超过目标峰值，无需放大
    for (let c = 0; c < ch; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < d.length; i++) d[i] *= gain;
    }
}

export function createViolinEngine(ctx, output) {
    if (!ctx) return null;

    const samples = new Map();   // midi -> AudioBuffer
    const voices = new Map();    // midi -> { src, filter, env, vib, vibG, trem, tremG, tremNode, spiccato }
    let ready = false;
    let loading = false;

    // —— 琴体共鸣箱（共享）——
    const bodyIn = ctx.createGain();
    const bodyOut = ctx.createGain();
    bodyIn.gain.value = 1.0;
    bodyOut.gain.value = 1.0;
    {
        let node = bodyIn;
        for (const mode of BODY_MODES) {
            const f = ctx.createBiquadFilter();
            f.type = 'peaking';
            f.frequency.value = mode.f;
            f.Q.value = mode.q;
            f.gain.value = mode.gain;
            node.connect(f);
            node = f;
        }
        // 高频空气感滚降，去除采样数码味
        const air = ctx.createBiquadFilter();
        air.type = 'lowpass';
        air.frequency.value = 9000;
        air.Q.value = 0.5;
        node.connect(air);
        air.connect(bodyOut);
    }
    bodyOut.connect(output);

    // —— 解码单个音频 ArrayBuffer：优先旧式三参 callback（全浏览器通用），
    //    异常/不返回 Promise 时回退现代 Promise 形式；返回 null 表示解码失败。 ——
    function decodeAudio(buf) {
        return new Promise((resolve) => {
            let settled = false;
            const done = (b) => { if (!settled) { settled = true; resolve(b || null); } };
            try {
                ctx.decodeAudioData(buf, done, () => done(null));
            } catch (e1) {
                try {
                    const p = ctx.decodeAudioData(buf);
                    if (p && typeof p.then === 'function') { p.then(done, () => done(null)); }
                    else done(null);
                } catch (e2) { done(null); }
            }
        });
    }

    // —— 下载并解码单个 Soundfont 源（MIDI.js 格式：{ "A3": "data:audio/...;base64,...", ... }）——
    // 返回成功解码的采样数量；失败时打印详细原因（下载/格式/JSON/解码）以便定位「无声」。
    async function decodeSoundfont(u) {
        let text;
        try {
            const resp = await fetch(u);
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            text = await resp.text();
        } catch (e) {
            console.warn('[violinEngine] 下载音源失败 ' + u + '：' + (e && e.message ? e.message : e));
            return 0;
        }

        // 提取 Soundfont 的 JSON 对象主体：定位赋值号后的 '{' 到文件末尾的 '}'。
        // 部分 Soundfont 最后一项会带「尾随逗号」（如 `"C8": "...",` 后直接 `}`），
        // 属非严格 JSON，须先剥离尾随逗号再 parse，否则 JSON.parse 抛错导致全部采样加载失败。
        const header = text.indexOf('MIDI.Soundfont.');
        if (header < 0) { console.warn('[violinEngine] ' + u + ' 非 MIDI.js Soundfont 格式'); return 0; }
        const eq = text.indexOf('=', header);
        const braceOpen = text.indexOf('{', eq);
        const braceClose = text.lastIndexOf('}');
        if (braceOpen < 0 || braceClose <= braceOpen) {
            console.warn('[violinEngine] ' + u + ' Soundfont JSON 对象提取失败');
            return 0;
        }
        const jsonText = text.slice(braceOpen, braceClose + 1).replace(/,\s*([}\]])/g, '$1');
        let obj;
        try {
            obj = JSON.parse(jsonText);
        } catch (e) {
            console.warn('[violinEngine] ' + u + ' JSON 解析失败：' + (e && e.message ? e.message : e));
            return 0;
        }

        const entries = Object.entries(obj).filter(([k]) => noteNameToMidi(k) != null);
        let ok = 0, fail = 0, firstErr = null;
        await Promise.all(entries.map(async ([name, dataUrl]) => {
            try {
                const midi = noteNameToMidi(name);
                const buf = await decodeAudio(base64ToArrayBuffer(dataUrl));
                if (buf && buf.duration > 0 && buf.length > 0) {
                    normalizeBuffer(buf, 0.6, 10);   // 对齐到适中峰值，避免整体音量过高
                    samples.set(midi, buf); ok++;
                }
                else { fail++; if (!firstErr) firstErr = new Error(name + ' 解码结果为空/无效'); }
            } catch (e) {
                fail++;
                if (!firstErr) firstErr = e;
            }
        }));
        console.log('[violinEngine] ' + u + ' 解码：成功 ' + ok + ' / 失败 ' + fail +
            (firstErr ? '（首错：' + (firstErr && firstErr.message ? firstErr.message : firstErr) + '）' : ''));

        // —— 静音检测：确认解码出的采样确实含有效音频，而非"解码成功但内容全零" ——
        {
            let silentCount = 0, peakMin = 1, peakMax = 0, peakMinMidi = null, peakMaxMidi = null;
            for (const [midi, buf] of samples) {
                const d = buf.getChannelData(0);
                let pk = 0;
                const step = Math.max(1, Math.floor(d.length / 4096));
                for (let i = 0; i < d.length; i += step) { const a = Math.abs(d[i]); if (a > pk) pk = a; }
                if (pk < 0.0005) silentCount++;
                if (pk < peakMin) { peakMin = pk; peakMinMidi = midi; }
                if (pk > peakMax) { peakMax = pk; peakMaxMidi = midi; }
            }
            console.log('[violinEngine] ' + u + ' 峰值检测：' + samples.size + ' 音中疑似静音 ' + silentCount +
                ' 个；peak=' + peakMin.toFixed(4) + '(midi ' + peakMinMidi + ') ~ ' + peakMax.toFixed(4) + '(midi ' + peakMaxMidi + ')');
        }
        return ok;
    }

    // —— 加载音源：优先主源（MP3），若一个采样都解不出则回退备用源（OGG Vorbis）——
    // 不同浏览器对 decodeAudioData 的支持有别：Chrome/Safari 支持 MP3，Firefox 解码 MP3 受限，
    // 用 OGG 兜底以覆盖主流浏览器的无声问题。
    async function load(url, oggUrl = null) {
        if (ready || loading) return true;
        loading = true;
        try {
            const candidates = oggUrl ? [url, oggUrl] : [url];
            for (const u of candidates) {
                const ok = await decodeSoundfont(u);
                if (ok > 0) break;   // 主源已出采样，无需再试备用源
            }
            ready = samples.size > 0;
            console.log('[violinEngine] 采样就绪，共 ' + samples.size + ' 个音高');
        } catch (err) {
            console.warn('[violinEngine] 采样加载失败', err && err.message ? err.message : err);
            ready = false;
        } finally {
            loading = false;
        }
        return ready;
    }

    function nearestSample(midi) {
        let best = null, bd = Infinity;
        for (const k of samples.keys()) {
            const d = Math.abs(k - midi);
            if (d < bd) { bd = d; best = k; }
        }
        return best;
    }

    function stopVoice(midi, release = 0.09) {
        const v = voices.get(midi);
        if (!v) return;
        voices.delete(midi);
        const now = ctx.currentTime;
        try {
            const g = v.env.gain;
            g.cancelScheduledValues(now);
            g.setValueAtTime(Math.max(g.value, 0.0001), now);
            g.linearRampToValueAtTime(0.0001, now + release);
            v.src.stop(now + release + 0.05);
        } catch (e) {}
    }

    function noteOn(midi, velocity = 0.8, perf = null) {
        if (!ready || midi == null || midi < 21 || midi > 108) return false;
        stopVoice(midi, 0.02);   // 同音重触发先释放旧声

        const sampleMidi = nearestSample(midi);
        if (sampleMidi == null) return false;
        const buffer = samples.get(sampleMidi);
        if (!buffer || !buffer.length || !buffer.duration) return false;  // 无效采样 → 交回上层回退

        const now = ctx.currentTime;
        const vel = Math.max(0.05, Math.min(1, velocity));
        const p = perf || {};
        const bow = p.bow || { contact: 0.5, pressure: 0.5, speed: 0.5, angle: 0 };
        const vib = p.vibrato || null;
        const port = p.portamento || null;
        const trem = p.tremolo || null;
        const spiccato = !!p.spiccato;

        // —— 声源：按目标音高放置（最近采样 + playbackRate 精确移调）——
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = false;                        // 一触发采样（保持与既有采样行为一致）
        src.playbackRate.value = Math.pow(2, (midi - sampleMidi) / 12);
        if (port) {
            src.detune.setValueAtTime(-port.semitones * 100, now);
            src.detune.linearRampToValueAtTime(0, now + port.time);
        } else {
            src.detune.setValueAtTime(0, now);
        }

        // —— 音色：弓接触点（sul tasto 暗 ↔ sul ponticello 亮）映射低通截止 ——
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 600 + bow.contact * 6500;
        filter.Q.value = 1.1;

        // —— 包络 ——
        const env = ctx.createGain();
        const attack = spiccato ? 0.006 : 0.02 + (1 - bow.pressure) * 0.06;
        const peak = (0.30 + vel * 0.55) * (0.55 + bow.pressure * 0.45) * 1.5;  // 整体增益下调，音量更收敛
        env.gain.setValueAtTime(0.0001, now);
        env.gain.linearRampToValueAtTime(peak, now + attack);
        if (spiccato) {
            env.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
        } else {
            env.gain.setTargetAtTime(peak * 0.72, now + attack, 0.12);  // 弓弦持续
        }

        // —— 揉弦：LFO → detune（音分）+ 延迟渐入（真实揉弦晚于起音出现）——
        let vibO = null, vibG = null;
        if (vib) {
            vibO = ctx.createOscillator();
            vibO.frequency.value = vib.rate;
            vibG = ctx.createGain();
            vibG.gain.setValueAtTime(0, now);
            vibG.gain.linearRampToValueAtTime(vib.depth, now + 0.18);
            vibO.connect(vibG);
            vibG.connect(src.detune);
            vibO.start(now);
        }

        // —— 颤音（震音）：幅度 LFO ——
        let tremO = null, tremG = null, tremNode = null;
        if (trem) {
            tremO = ctx.createOscillator();
            tremO.frequency.value = trem.rate;
            tremG = ctx.createGain();
            tremG.gain.value = trem.depth;
            tremNode = ctx.createGain();
            tremNode.gain.value = 1 - trem.depth;   // 基准，叠加 LFO 后 1-2*depth .. 1
            tremO.connect(tremG);
            tremG.connect(tremNode.gain);
            tremO.start(now);
        }

        // 信号链：src → filter → env → [tremolo] → 琴体 → 输出
        src.connect(filter);
        filter.connect(env);
        let tail = env;
        if (tremNode) { tail.connect(tremNode); tail = tremNode; }
        tail.connect(bodyIn);

        src.start(now);
        if (spiccato) src.stop(now + 0.25);

        voices.set(midi, { src, filter, env, vibO, vibG, tremO, tremNode, spiccato });
        return true;
    }

    function noteOff(midi) {
        if (midi == null || !voices.has(midi)) return;
        stopVoice(midi, 0.08);
    }

    return { load, noteOn, noteOff, get ready() { return ready; } };
}