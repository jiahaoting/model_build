// ============================================================
// 极简标准 MIDI 文件（SMF，格式 0/1）解析器
// - 从 ArrayBuffer 提取音符事件，处理变速（tempo map）
// - 输出与项目谱面一致的「拍=秒」格式（bpm=60 使 beat 即秒），
//   可直接交给演奏器与钢琴键盘/发声系统同步演奏
// ============================================================

export function parseMidiFile(arrayBuffer, title = '上传曲目') {
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);
    let p = 0;

    const u8 = () => bytes[p++];
    const u16 = () => { const v = view.getUint16(p); p += 2; return v; };
    const u32 = () => { const v = view.getUint32(p); p += 4; return v; };
    const ascii = (n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(bytes[p++]); return s; };
    const varLen = () => { let v = 0, b; do { b = bytes[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };

    // —— 文件头 ——
    if (ascii(4) !== 'MThd') throw new Error('不是有效的 MIDI 文件（缺少 MThd 头）');
    const hdrLen = u32();
    u16();                       // format（格式 0/1/2，均可按多轨解析）
    const ntrks = u16();
    const division = u16();
    p += Math.max(0, hdrLen - 6);

    let ppq = 480;
    let smpte = null;                 // 帧时基换算（secondsPerTick）
    if (division & 0x8000) {
        // SMPTE 时基（tick 对帧，非对四分音符）：由「帧率 × 每帧 tick」还原秒/ tick。
        // 这类文件通常不含 tempo 元事件，直接按固定帧率线性换算，避免因不支持而解析失败。
        const fpsRaw = (division >> 8) & 0xff;   // 补码存储的负帧率，如 -24 → 0xE8
        const fps = 256 - fpsRaw;                // 还原 24/25/29/30
        const tpf = division & 0xff;             // 每帧 tick 数
        const f = fps || 24, t = tpf || 48;
        smpte = { fps: f, tpf: t, secondsPerTick: 1 / (f * t) };
        console.warn(`[midi] SMPTE 时基（${f}fps × ${t}tpf），按帧时基线性换算`);
    } else {
        ppq = division;
    }

    const noteEvents = [];    // { tick, type, midi, vel, ch }
    const tempoEvents = [];   // { tick, uspq }
    const sustainEvents = []; // { tick, val } 延音踏板 CC64 控制变更
    const programEvents = []; // { tick, ch, program } 通道音色变更（Program Change）

    for (let t = 0; t < ntrks; t++) {
        if (ascii(4) !== 'MTrk') throw new Error('无效的音轨块');
        const len = u32();
        const end = p + len;
        let running = 0;
        let abs = 0;

        while (p < end) {
            abs += varLen();
            let status = bytes[p];
            if (status < 0x80) status = running;      // 运行状态：数据字节沿用上一状态
            else p++;
            if (status < 0x80) throw new Error('MIDI 事件缺少状态字节');

            if (status === 0xff) {                    // Meta
                const type = u8();
                const mlen = varLen();
                if (type === 0x51 && mlen === 3) {
                    tempoEvents.push({ tick: abs, uspq: (bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2] });
                }
                p += mlen;
                running = 0;
                continue;
            }
            if (status === 0xf0 || status === 0xf7) { // Sysex
                p += varLen();
                running = 0;
                continue;
            }

            const hi = status & 0xf0;
            const ch = status & 0x0f;
            if (hi === 0x80 || hi === 0x90) {
                const midi = u8();
                const vel = u8();
                if (hi === 0x90 && vel > 0) noteEvents.push({ tick: abs, type: 'on', midi, vel, ch });
                else noteEvents.push({ tick: abs, type: 'off', midi, vel: 0, ch });
                running = status;
            } else if (hi === 0xb0) {
                // 控制变更（Control Change）：记录延音踏板 CC64 的踩/抬状态
                const cc = u8();
                const val = u8();
                if (cc === 64) sustainEvents.push({ tick: abs, val });
                running = status;
            } else if (hi === 0xa0 || hi === 0xe0) {
                p += 2; running = status;
            } else if (hi === 0xc0) {
                // Program Change：记录通道音色（程序号），用于区分钢琴 / 小提琴 / 其他乐器轨道
                const program = u8();
                programEvents.push({ tick: abs, ch, program });
                running = status;
            } else if (hi === 0xd0) {
                p += 1; running = status;
            } else {
                running = 0;
            }
        }
    }

    // —— 变速表：tick → 秒 ——
    tempoEvents.sort((a, b) => a.tick - b.tick);
    const tempos = [];
    {
        let lastTick = -1;
        for (const te of tempoEvents) {
            if (te.tick === lastTick) tempos[tempos.length - 1].uspq = te.uspq;
            else { tempos.push({ tick: te.tick, uspq: te.uspq }); lastTick = te.tick; }
        }
    }
    function tickToSeconds(tick) {
        if (smpte) return tick * smpte.secondsPerTick;   // 帧时基：tick 线性对应秒
        let sec = 0, cur = 0, tempo = 500000;
        for (const te of tempos) {
            if (te.tick > tick) break;
            sec += (te.tick - cur) / ppq * tempo / 1e6;
            cur = te.tick;
            tempo = te.uspq;
        }
        return sec + (tick - cur) / ppq * tempo / 1e6;
    }

    // —— 通道音色时间线：按通道记录 Program Change，用于识别每颗音符所属乐器轨道 ——
    programEvents.sort((a, b) => a.tick - b.tick);
    const progByCh = new Map();
    for (const pe of programEvents) {
        if (!progByCh.has(pe.ch)) progByCh.set(pe.ch, []);
        progByCh.get(pe.ch).push({ tick: pe.tick, program: pe.program });
    }
    // GM 音色号 → 乐器分类：钢琴类 / 弓弦类（小提琴等）/ 打击乐 / 其他
    // 注意：GM 规定第 10 通道（0-based 9）固定为打击乐鼓组，通道判定优先于音色号。
    function classifyNote(ch, program) {
        if (ch === 9) return 'percussion';          // GM 通道 10：鼓组打击乐（音高=不同鼓件）
        if (program == null) return null;           // 未设置音色：交由下游按钢琴处理
        if (program >= 0 && program <= 7) return 'piano';       // 0-7 各类钢琴/键盘
        if (program >= 40 && program <= 43) return 'violin';    // 40-43 小提琴/中提/大提/低音提（弓弦）
        if (program >= 8 && program <= 15) return 'percussion'; // 8-15 色彩打击乐（钟琴/颤音琴/木琴等）
        return 'other';
    }
    function programAt(ch, tick) {
        const list = progByCh.get(ch);
        let cur = null;
        if (list) for (const e of list) { if (e.tick > tick) break; cur = e.program; }
        return cur;
    }
    const instOf = (ch, tick) => (classifyNote(ch, programAt(ch, tick)) || 'piano');

    // —— 配对 noteOn/noteOff 生成音符（秒为时值单位） ——
    noteEvents.sort((a, b) => a.tick - b.tick || (a.type === 'on' ? -1 : 1));
    const open = new Map();   // `${ch}:${midi}` -> { midi, t0, vel, inst }
    const notes = [];
    for (const ev of noteEvents) {
        const key = `${ev.ch}:${ev.midi}`;
        if (ev.type === 'on') {
            const prev = open.get(key);
            if (prev) notes.push({ midi: prev.midi, t0: prev.t0, dur: Math.max(0.05, tickToSeconds(ev.tick) - prev.t0), vel: prev.vel, inst: prev.inst });
            open.set(key, { midi: ev.midi, t0: tickToSeconds(ev.tick), vel: Math.max(0.05, Math.min(1, ev.vel / 127)), inst: instOf(ev.ch, ev.tick) });
        } else {
            const prev = open.get(key);
            if (prev) {
                notes.push({ midi: prev.midi, t0: prev.t0, dur: Math.max(0.05, tickToSeconds(ev.tick) - prev.t0), vel: prev.vel, inst: prev.inst });
                open.delete(key);
            }
        }
    }
    // 结尾仍未释放的音符：给默认短时值
    for (const prev of open.values()) {
        notes.push({ midi: prev.midi, t0: prev.t0, dur: 0.5, vel: prev.vel, inst: prev.inst });
    }

    if (!notes.length) throw new Error('MIDI 中未找到任何音符');

    // —— 延音踏板（CC64）事件：值 >= 64 为踩下、< 64 为抬起（标准 MIDI 约定），连续同状态去重 ——
    const sustains = [];
    {
        const rawSust = sustainEvents.slice().sort((a, b) => a.tick - b.tick);
        let lastDown = false;
        for (const s of rawSust) {
            const down = s.val >= 64;
            if (down === lastDown) continue;
            sustains.push({ beat: tickToSeconds(s.tick), down });
            lastDown = down;
        }
    }

    return {
        title: title || '上传曲目',
        composer: '上传 MIDI',
        bpm: 60,   // 使 normalizeScore 的 spb=1，beat 数值即秒，保留原 MIDI 时值
        notes: notes.map(n => ({
            midi: Math.max(21, Math.min(108, Math.round(n.midi))),
            beat: n.t0,
            dur: n.dur,
            vel: n.vel,
            inst: n.inst
        })),
        sustains
    };
}