// 列出全部节点基础名 + 找门板/楼梯
import fs from 'fs';
const nodes = JSON.parse(fs.readFileSync('_theater_nodes.json', 'utf8'));
const OFF = [-3.43, 0.25, -8.36];
const w = (p) => [p[0] + OFF[0], p[1] + OFF[1], p[2] + OFF[2]];
const ctr = (n) => [(n.min[0] + n.max[0]) / 2, (n.min[1] + n.max[1]) / 2, (n.min[2] + n.max[2]) / 2];
const size = (n) => [n.max[0] - n.min[0], n.max[1] - n.min[1], n.max[2] - n.min[2]];

const nameCount = {};
for (const n of nodes) {
    const base = n.name.replace(/#?\d*$/,'').replace(/\.\d+$/,'').trim();
    nameCount[base] = (nameCount[base] || 0) + 1;
}
console.log('=== 全部基础名（按数量降序，前80） ===');
Object.entries(nameCount).sort((a,b)=>b[1]-a[1]).slice(0,80).forEach(([k,v])=>console.log(String(v).padStart(5), k));

// 门板：z 16~19，高 1.8~2.6，宽 0.7~1.3，厚 <0.2
console.log('\n=== 门板候选（z 15~19 薄高板） ===');
for (const n of nodes) {
    const s = size(n), c = w(ctr(n));
    if (c[2] > 15 && c[2] < 19 && s[1] > 1.8 && s[1] < 2.8 && s[2] < 0.25 && s[0] > 0.5 && s[0] < 1.5) {
        console.log(n.name.slice(0,50), 'ctr:', c.map(v=>+v.toFixed(2)).join(','), 'size:', s.map(v=>+v.toFixed(2)).join(','));
    }
}

// 台阶序列：小扁盒 y高 0.05~0.3, 深 0.15~0.6, 宽 0.8~4，按位置分组
console.log('\n=== 台阶样小构件（数量统计 by y 档） ===');
const steps = nodes.filter(n => {
    const s = size(n);
    return s[1] > 0.04 && s[1] < 0.35 && s[2] > 0.12 && s[2] < 0.7 && s[0] > 0.7 && s[0] < 5;
});
console.log('候选数:', steps.length);
const byXZ = {};
for (const n of steps) {
    const c = w(ctr(n));
    const k = `${Math.round(c[0]/2)*2},${Math.round(c[2]/2)*2}`;
    (byXZ[k] = byXZ[k] || []).push(c[1]);
}
// 打出有明显 y 梯度的组（>=5 个且 y 跨度 > 0.8m）→ 楼梯
for (const [k, ys] of Object.entries(byXZ)) {
    if (ys.length >= 5 && Math.max(...ys) - Math.min(...ys) > 0.8) {
        console.log('楼梯候选区 xz≈', k, 'n=', ys.length, 'y:', Math.min(...ys).toFixed(2), '→', Math.max(...ys).toFixed(2));
    }
}
