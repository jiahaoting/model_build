// 精确测量：地面坡度/排座/楼板/包围盒
import fs from 'fs';
const nodes = JSON.parse(fs.readFileSync('_theater_nodes.json', 'utf8'));
const OFF = [-3.43, 0.25, -8.36];
const w = (p) => [p[0] + OFF[0], p[1] + OFF[1], p[2] + OFF[2]];
const ctr = (n) => [(n.min[0] + n.max[0]) / 2, (n.min[1] + n.max[1]) / 2, (n.min[2] + n.max[2]) / 2];
const size = (n) => [n.max[0] - n.min[0], n.max[1] - n.min[1], n.max[2] - n.min[2]];

// 0) 模型世界包围盒 + z 最大处的大件（后墙）
let mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9];
for (const n of nodes) { const c0 = w(n.min), c1 = w(n.max);
    for (let i=0;i<3;i++){ mn[i]=Math.min(mn[i],c0[i]); mx[i]=Math.max(mx[i],c1[i]); } }
console.log('世界包围盒 min', mn.map(v=>+v.toFixed(2)), 'max', mx.map(v=>+v.toFixed(2)));
console.log('\nz>16 的大件（后墙/门厅）:');
for (const n of nodes) { const c = w(ctr(n)), s = size(n);
    if (c[2] > 16 && (s[0] > 3 || s[1] > 3)) console.log(' ', n.name.slice(0,44), 'ctr', c.map(v=>+v.toFixed(2)).join(','), 'size', s.map(v=>+v.toFixed(2)).join(','));
}

// 1) 座椅扶手全量（世界坐标）
const arms = nodes.filter(n => /seat_arm stand/i.test(n.name)).map(n => {
    const c = w(ctr(n)); return { x: c[0], y: c[1], z: c[2] };
});
// 分层：池座 y<2 / 楼座1 y 2.5~7.3 / 楼座2 y>7.3
const L0 = arms.filter(a => a.y < 2), L1 = arms.filter(a => a.y >= 2.5 && a.y < 7.3), L2 = arms.filter(a => a.y >= 7.3);
console.log('\n扶手分层: 池座', L0.length, '楼座1', L1.length, '楼座2', L2.length);

function fitRake(arr, label) {
    // 线性拟合 y = a + b*z
    const n = arr.length; let sz=0, sy=0, szz=0, szy=0;
    for (const a of arr) { sz+=a.z; sy+=a.y; szz+=a.z*a.z; szy+=a.z*a.y; }
    const b = (n*szy - sz*sy)/(n*szz - sz*sz), a = (sy - b*sz)/n;
    console.log(`${label}: armY = ${a.toFixed(3)} + ${b.toFixed(4)}*z   (floor≈armY-0.305)`);
    return { a, b };
}
fitRake(L0, '池座');
fitRake(L1, '楼座1');
fitRake(L2, '楼座2');

// 2) 行聚类（按 y 桶 + z 间隙）→ 每排：z 中位、y 中位、x 范围、扶手数、x 间隙模式
function rowsOf(level, label) {
    const byY = {};
    for (const a of level) { const k = a.y.toFixed(1); (byY[k]=byY[k]||[]).push(a); }
    const rows = [];
    for (const arr of Object.values(byY)) {
        arr.sort((p,q)=>p.z-q.z);
        let cur = [arr[0]];
        for (let i=1;i<arr.length;i++) {
            if (arr[i].z - arr[i-1].z > 0.6) { rows.push(cur); cur=[]; }
            cur.push(arr[i]);
        }
        rows.push(cur);
    }
    console.log(`\n${label}: ${rows.length} 排`);
    rows.sort((p,q)=>med(p.map(a=>a.z))-med(q.map(a=>a.z)));
    for (const r of rows) {
        const zs = r.map(a=>a.z), ys = r.map(a=>a.y), xs = r.map(a=>a.x).sort((p,q)=>p-q);
        // x 相邻间隙样本（验证配对假设）
        const gaps = []; for (let i=1;i<xs.length;i++) gaps.push(xs[i]-xs[i-1]);
        const gAlt = gaps.slice(0,8).map(g=>g.toFixed(2)).join(' ');
        console.log(`  n=${String(r.length).padStart(3)} zMed=${med(zs).toFixed(2)} zRange=[${Math.min(...zs).toFixed(2)},${Math.max(...zs).toFixed(2)}] yMed=${med(ys).toFixed(2)} x=[${xs[0].toFixed(2)},${xs[xs.length-1].toFixed(2)}] gaps: ${gAlt}`);
    }
    return rows;
}
function med(a){ const s=[...a].sort((p,q)=>p-q); return s[Math.floor(s.length/2)]; }
const R0 = rowsOf(L0, '池座');
const R1 = rowsOf(L1, '楼座1');
const R2 = rowsOf(L2, '楼座2');

// 3) 楼板大件：x>14, z>6, y厚<5, 中心 z 0~14, y 0~13（倾斜看台的包围盒 y 跨度大）
console.log('\n=== 看台楼板候选 ===');
for (const n of nodes) { const c = w(ctr(n)), s = size(n);
    if (s[0] > 14 && s[2] > 6 && c[2] > -1 && c[2] < 14 && c[1] > 0.5 && c[1] < 13 && s[1] < 6)
        console.log(' ', n.name.slice(0,46), 'ctr', c.map(v=>+v.toFixed(2)).join(','), 'size', s.map(v=>+v.toFixed(2)).join(','));
}

// 4) 楼座走道板 G-Object.001 / 373 精确盒
for (const n of nodes) if (/^G-Object\.00?13?$|^G-Object\.373$|^G-Object\.001$/.test(n.name)) {
    console.log('走道板', n.name, 'min', w(n.min).map(v=>+v.toFixed(3)), 'max', w(n.max).map(v=>+v.toFixed(3)));
}
