import { readFileSync } from 'fs';
import { parseMidiFile } from './src/midiParser.js';

const file = 'C:/Users/jiaha/Downloads/Memory_Locked_Plum_3ch.mid';
const buf = readFileSync(file);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

// —— 原始结构扫描：轨道数 / 每通道 Program Change / 每通道音符数 ——
const bytes = new Uint8Array(ab);
const view = new DataView(ab);
let p = 0;
const u8 = () => bytes[p++];
const u16 = () => { const v = view.getUint16(p); p += 2; return v; };
const u32 = () => { const v = view.getUint32(p); p += 4; return v; };
const ascii = (n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(bytes[p++]); return s; };
const varLen = () => { let v = 0, b; do { b = bytes[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };

if (ascii(4) !== 'MThd') { console.log('NOT a valid MIDI'); process.exit(); }
u32();
const fmt = u16();
const ntrks = u16();
const div = u16();
console.log('格式 format=' + fmt + '，轨道数 ntrks=' + ntrks + '，division=' + div);

const chPrograms = new Map();
const chNotes = new Map();
const chRange = new Map();

for (let t = 0; t < ntrks; t++) {
    if (ascii(4) !== 'MTrk') { console.log('track ' + t + ' header invalid'); break; }
    const len = u32();
    const end = p + len;
    let running = 0, abs = 0;
    while (p < end) {
        abs += varLen();
        let status = bytes[p];
        if (status < 0x80) status = running; else p++;
        if (status === 0xff) { const ty = u8(); const ml = varLen(); p += ml; running = 0; continue; }
        if (status === 0xf0 || status === 0xf7) { p += varLen(); running = 0; continue; }
        const hi = status & 0xf0, ch = status & 0x0f;
        if (hi === 0x80 || hi === 0x90) {
            const midi = u8(); const vel = u8();
            const on = hi === 0x90 && vel > 0;
            if (on) {
                chNotes.set(ch, (chNotes.get(ch) || 0) + 1);
                const r = chRange.get(ch) || [128, -1];
                chRange.set(ch, [Math.min(r[0], midi), Math.max(r[1], midi)]);
            }
            running = status;
        } else if (hi === 0xb0) { u8(); u8(); running = status; }
        else if (hi === 0xa0 || hi === 0xe0) { p += 2; running = status; }
        else if (hi === 0xc0) { const pr = u8(); if (!chPrograms.has(ch)) chPrograms.set(ch, []); chPrograms.get(ch).push(pr); running = status; }
        else if (hi === 0xd0) { p += 1; running = status; }
        else running = 0;
    }
}

console.log('\n—— 每通道 Program Change（音色号）与音符统计 ——');
for (const [ch, progs] of chPrograms) {
    const notes = chNotes.get(ch) || 0;
    const r = chRange.get(ch);
    console.log('通道 ch=' + ch + '  音色号=[' + [...new Set(progs)].join(',') + ']  音符数=' + notes +
        (r ? '  音域= ' + r[0] + '~' + r[1] + ' (midi)' : ''));
}
for (const [ch, n] of chNotes) {
    if (!chPrograms.has(ch)) console.log('通道 ch=' + ch + '  (无Program Change!)  音符数=' + n);
}

// —— 用项目解析器看最终 inst 分类 ——
console.log('\n—— parseMidiFile 分类结果 ——');
try {
    const parsed = parseMidiFile(ab, 'test');
    const byInst = {};
    for (const n of parsed.notes) {
        byInst[n.inst] = (byInst[n.inst] || 0) + 1;
    }
    console.log('总音符数=' + parsed.notes.length);
    for (const [k, v] of Object.entries(byInst)) console.log('  inst=' + k + ' : ' + v + ' 个音符');
    const vn = parsed.notes.filter(n => n.inst === 'violin');
    if (vn.length) {
        const ms = vn.map(n => n.midi);
        console.log('  violin 音域=' + Math.min(...ms) + '~' + Math.max(...ms) + '，前5个音的 midi/beat=' +
            vn.slice(0, 5).map(n => n.midi + '@' + n.beat.toFixed(2)).join(', '));
    }
    // 各 inst 的通道分布
    const chByInst = {};
    // parseMidiFile 不返回 ch，仅从原始 stats 看
} catch (e) {
    console.log('parseMidiFile 抛出异常: ' + e.message);
}