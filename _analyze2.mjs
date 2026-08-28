// 分析 Eastman Theater 节点：座椅锚点 / 门 / 楼层（世界坐标 = 模型 + (-3.43, +0.25, -8.36)）
import fs from 'fs';
const nodes = JSON.parse(fs.readFileSync('_theater_nodes.json', 'utf8'));
const OFF = [-3.43, 0.25, -8.36];
const w = (p) => [p[0] + OFF[0], p[1] + OFF[1], p[2] + OFF[2]];
const ctr = (n) => [(n.min[0] + n.max[0]) / 2, (n.min[1] + n.max[1]) / 2, (n.min[2] + n.max[2]) / 2];
const size = (n) => [n.max[0] - n.min[0], n.max[1] - n.min[1], n.max[2] - n.min[2]];

// 1) 观众人偶候选名统计
const nameCount = {};
for (const n of nodes) {
    const base = n.name.replace(/#?\d*$/,'').replace(/\.\d+$/,'').trim();
    nameCount[base] = (nameCount[base] || 0) + 1;
}
const AUD = /Deco Sim|Guest|s4studio|Shape69|Sim \d| Sitting|Standing/i;
console.log('=== 人偶候选 ===');
let audTotal = 0;
for (const [k, v] of Object.entries(nameCount)) if (AUD.test(k)) { console.log(v, k); audTotal += v; }
console.log('合计人偶网格:', audTotal);

// 2) 座椅扶手节点 → 世界坐标聚类
const seats = nodes.filter(n => /seat_arm stand/i.test(n.name));
console.log('\n=== 座椅 ===  arm stand 数:', seats.length);
const sw = seats.map(n => { const c = w(ctr(n)); return { x: c[0], y: c[1], z: c[2], s: size(n) }; });
// 按 y 聚类（楼层）
const yCls = {};
for (const s of sw) { const k = s.y.toFixed(1); (yCls[k] = yCls[k] || []).push(s); }
const yKeys = Object.keys(yCls).sort((a, b) => a - b);
console.log('楼层(y) 档位数:', yKeys.length);
for (const k of yKeys) {
    const arr = yCls[k];
    const zs = arr.map(s => s.z).sort((a, b) => a - b);
    const xs = arr.map(s => s.x);
    console.log(`y=${k} n=${arr.length} z:[${zs[0].toFixed(1)},${zs[zs.length-1].toFixed(1)}] x:[${Math.min(...xs).toFixed(1)},${Math.max(...xs).toFixed(1)}]`);
}
// 扶手尺寸样本
const ss = sw[0].s; console.log('扶手尺寸样本:', ss.map(v => v.toFixed(2)));

// 3) 门
console.log('\n=== 门 ===');
const handles = nodes.filter(n => /Door Handle/i.test(n.name));
for (const h of handles) { const c = w(ctr(h)); console.log('handle', h.name.slice(0, 40), 'w:', c.map(v => +v.toFixed(2)).join(','), 'size:', size(h).map(v => +v.toFixed(2)).join(',')); }
// 门板候选：薄高板 z>20
const panels = nodes.filter(n => {
    const s = size(n); const c = w(ctr(n));
    return c[2] > 18 && s[1] > 1.8 && s[1] < 3 && (s[2] < 0.15 || s[0] < 0.15) && s[0] < 1.4 && s[2] < 1.4 && !/Handle/i.test(n.name);
});
console.log('门板候选:', panels.length);
for (const p of panels.slice(0, 30)) { const c = w(ctr(p)); console.log('panel', p.name.slice(0, 44), 'w:', c.map(v => +v.toFixed(2)).join(','), 'size:', size(p).map(v => +v.toFixed(2)).join(',')); }

// 4) 楼地板（大而薄的水平板）
console.log('\n=== 楼地板候选 ===');
const slabs = nodes.filter(n => {
    const s = size(n);
    return s[1] < 0.6 && s[0] > 4 && s[2] > 4;
});
for (const p of slabs) { const c = w(ctr(p)); const s = size(p); console.log('slab', p.name.slice(0, 40), 'ctr:', c.map(v => +v.toFixed(2)).join(','), 'size:', s.map(v => +v.toFixed(1)).join(',')); }

// 5) 楼梯候选名
console.log('\n=== 楼梯名候选 ===');
for (const [k, v] of Object.entries(nameCount)) if (/stair|step|梯/i.test(k)) console.log(v, k);
