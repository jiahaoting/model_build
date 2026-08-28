// ============================================================
// 小提琴演奏模型（纯逻辑，无 DOM / 无音频 / 无 Three 依赖）
// ------------------------------------------------------------------
// · 把位模型：音高 ↔ 琴弦 ↔ 手指 ↔ 指板位置 的精确映射
// · 弓法模型：弓与弦的接触点 / 压力 / 速度 / 角度 物理参数
// · 技法模型：揉弦 Vibrato / 滑音 Portamento / 跳弓 Spiccato / 颤音（震音）Tremolo
//   基于音符时值、相邻音程、连奏关系等做确定性推断，并输出可供
//   音频引擎与 3D 可视化共同消费的 performance 描述符。
// ============================================================

// 四根空弦（真实小提琴定弦）：G3(55) / D4(62) / A4(69) / E5(76)
export const STRING_DEFS = [
    { name: 'G', midi: 55 },
    { name: 'D', midi: 62 },
    { name: 'A', midi: 69 },
    { name: 'E', midi: 76 },
];
const OPEN_MIDIS = STRING_DEFS.map(s => s.midi);

// 第一把位半音停位：开放弦、1指、2指、3指、4指 相对空弦的半音数
const FINGER_SEMITONES = [0, 2, 4, 5, 7];

// 技法判定阈值（秒），可按曲风/乐器微调
const CFG = {
    spiccatoMaxDur: 0.05,    // 短于此值才判跳弓；常规快音→连弓（连奏，避免断断续续）
    tremoloGap: 0.07,        // 同音相邻且间隔短于此值判为颤音（快速换弓）
    portamentoMaxGap: 0.08,  // 连奏间隔上限（超过则非滑音）
    portamentoMaxSemis: 7,   // 滑音最大半音跨度（更大视为换弓/跳进）
    portamentoMinDur: 0.30,  // 滑音最小音符时值：快音/短音不滑音（否则音未滑到位就换音，音准发虚）
    vibratoBaseRate: 5.2,    // 揉弦基准频率（Hz）
    vibratoBaseDepth: 12,    // 揉弦基准深度（音分）——下调，避免宽幅揉弦令音准发飘
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// —— 把位：音高 → 琴弦 + 手指 + 指位 ——
// position：0~1 表示按弦点沿「有效弦长」的归一化位置（0=空弦锚点侧，值越大越靠近琴码），
//           由 1 - 2^(-半音/12) 精确还原真实指板几何。
export function fingeringFor(midi, preferString = -1) {
    // 选最高空弦 ≤ 音高的弦（真实小提琴优先低把位原则）
    let str = 0;
    for (let i = 0; i < OPEN_MIDIS.length; i++) {
        if (OPEN_MIDIS[i] <= midi && OPEN_MIDIS[i] > OPEN_MIDIS[str]) str = i;
    }
    if (preferString >= 0 && OPEN_MIDIS[preferString] <= midi) str = preferString;

    const semis = Math.max(0, midi - OPEN_MIDIS[str]);
    const finger = nearestFinger(semis);
    const position = 1 - Math.pow(2, -semis / 12);   // 指板几何（映射到琴颈有效段）
    // 音准：默认十二平均律（A4=440）。小提琴家常用纯律/表现性音准，此处预留 cents 微调通道。
    const cents = 0;
    return { string: str, finger, position, cents, semis };
}

function nearestFinger(semis) {
    let best = 0, bd = Infinity;
    for (let f = 0; f < FINGER_SEMITONES.length; f++) {
        const d = Math.abs(semis - FINGER_SEMITONES[f]);
        if (d < bd) { bd = d; best = f; }
    }
    return best;
}

// —— 弓法物理参数：由音符力度 + 技法状态推导 ——
function bowFor(vel, tech) {
    const contact = clamp(0.18 + vel * 0.40, 0.08, 0.85);   // 触点靠近琴码 → 更亮
    const pressure = clamp(0.25 + vel * 0.60, 0.10, 1.00);
    let speed = clamp(0.30 + vel * 0.50, 0.20, 1.00);
    if (tech.spiccato) speed = Math.max(speed, 0.8);
    if (tech.tremolo) speed = 1.0;
    const angle = 0;                                        // 弓杆相对弦面的倾角（默认平行）
    return { contact, pressure, speed, angle };
}

// —— 演奏上下文：维护相邻音符状态以推断技法，产出 performance 描述符 ——
export function createViolinPerformance() {
    const state = { prev: null };   // { midi, t, dur, string }

    function nextNote(note) {
        // note: { midi, vel(0~1), dur(秒), t(秒) }
        const midi = Math.round(note.midi);
        const vel = clamp(note.vel || 0.7, 0, 1);
        const dur = Math.max(0.05, note.dur || 0.3);
        const t = note.t == null ? 0 : note.t;

        const fin = fingeringFor(midi);
        const prev = state.prev;
        const tech = { vibrato: null, portamento: null, spiccato: false, tremolo: null };

        const gap = prev ? t - (prev.t + prev.dur) : Infinity;
        const samePitch = !!prev && prev.midi === midi;
        const interval = prev ? midi - prev.midi : NaN;
        const sameString = !!prev && prev.string === fin.string;

        // 技法链：最淳朴拉法——仅保留基础揉弦（vibrato），去掉跳弓/颤音/滑音等复杂技法
        tech.vibrato = { rate: CFG.vibratoBaseRate + vel * 0.8, depth: CFG.vibratoBaseDepth + vel * 8 };

        const bow = bowFor(vel, tech);
        const perf = {
            midi, vel, dur, t,
            string: fin.string,
            finger: fin.finger,
            position: fin.position,
            cents: fin.cents,
            vibrato: tech.vibrato,
            portamento: tech.portamento,
            spiccato: tech.spiccato,
            tremolo: tech.tremolo,
            bow,
        };

        state.prev = { midi, t, dur, string: fin.string };
        return perf;
    }

    return { fingeringFor, nextNote };
}