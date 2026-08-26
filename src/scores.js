// ============================================================
// 钢琴曲谱数据（音符序列）
// 音符格式：{ midi, beat, dur, vel }
//   - midi : MIDI 音高（21 ~ 108）
//   - beat : 开始时刻（以四分音符为一拍，从 0 起）
//   - dur  : 时长（拍）
//   - vel  : 力度 0~1（强弱音）
// 将你的 MIDI 或音符序列整理成上述数组，配合 { title, composer, bpm }
// 即可接入演奏。bpm 为「一分钟四分音符数」。
// ============================================================

// C 大调音阶上下行（演示全音域与按键/手指/发声同步）
const cMajorScale = {
    id: 'c-major-scale',
    title: 'C 大调音阶练习',
    composer: '示例曲',
    bpm: 132,
    notes: []
};
{
    const scale = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60];
    scale.forEach((m, i) => {
        cMajorScale.notes.push({ midi: m, beat: i * 0.5, dur: 0.45, vel: 0.8 });
    });
    // 结尾主和弦
    cMajorScale.notes.push({ midi: 60, beat: scale.length * 0.5, dur: 1.0, vel: 0.85 });
    cMajorScale.notes.push({ midi: 64, beat: scale.length * 0.5, dur: 1.0, vel: 0.8 });
    cMajorScale.notes.push({ midi: 67, beat: scale.length * 0.5, dur: 1.0, vel: 0.8 });
}

// 曲库（新增曲目在此登记，或由外部传入）
const SCORES = [cMajorScale];

// 将音符序列按开始时间升序排序，并换算成秒（便于调度）
export function normalizeScore(score) {
    const spb = 60 / (score.bpm || 120);   // 每拍秒数
    const notes = score.notes
        .slice()
        .sort((a, b) => a.beat - b.beat)
        .map(n => ({
            midi: Math.round(n.midi),
            t0: n.beat * spb,
            dur: Math.max(0.06, (n.dur || 0.3) * spb),
            vel: Math.max(0.1, Math.min(1, n.vel == null ? 0.75 : n.vel)),
            inst: n.inst || 'piano'
        }));
    // 延音踏板（CC64）事件：与音符同按 beat 换算成秒，供演奏器驱动脚部动作与踏板动画
    const sustains = (score.sustains || [])
        .slice()
        .sort((a, b) => a.beat - b.beat)
        .map(s => ({ t0: s.beat * spb, down: !!s.down }));
    const duration = notes.reduce((m, n) => Math.max(m, n.t0 + n.dur), 0);
    return { title: score.title, composer: score.composer, notes, sustains, duration };
}

export function getScores() {
    return SCORES;
}

export function getScoreById(id) {
    return SCORES.find(s => s.id === id) || SCORES[0];
}