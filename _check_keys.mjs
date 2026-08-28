import { readFileSync } from 'node:fs';
const rep = JSON.parse(readFileSync('_islands_report.json', 'utf8'));
const part = rep['Steinway_1003'];
const perm = {};
const samples = [];
for (const e of part.entries) {
    const d = e.dims.map(v => Math.round(v * 1000) / 1000);
    // 识别白键尺寸集 {0.021, 0.036, 0.184}
    const s = [...d].sort((a, b) => a - b);
    if (Math.abs(s[0] - 0.021) < 0.003 && Math.abs(s[1] - 0.036) < 0.003 && Math.abs(s[2] - 0.184) < 0.004) {
        const key = `x=${d[0]} y=${d[1]} z=${d[2]}`;
        perm[key] = (perm[key] || 0) + 1;
        if (samples.length < 3) samples.push(e);
    }
}
console.log('白键轴向排列统计:', perm);
console.log('样本:', JSON.stringify(samples, null, 1));
// 黑键
const permB = {};
for (const e of part.entries) {
    const d = e.dims.map(v => Math.round(v * 1000) / 1000);
    const s = [...d].sort((a, b) => a - b);
    if (Math.abs(s[0] - 0.010) < 0.003 && Math.abs(s[1] - 0.019) < 0.003 && Math.abs(s[2] - 0.111) < 0.004) {
        const key = `x=${d[0]} y=${d[1]} z=${d[2]}`;
        permB[key] = (permB[key] || 0) + 1;
    }
}
console.log('黑键轴向排列统计:', permB);
