import fs from 'fs';
const nodes = JSON.parse(fs.readFileSync('_theater_nodes.json', 'utf8'));
// 舞台区（模型局部）：台体 G-Object.9441 中心(3.43,0.35,-2.94) 尺寸 15.22x1x12.17，台面 y=0.85
const ST = { x0: 3.43 - 15.22 / 2, x1: 3.43 + 15.22 / 2, z0: -2.94 - 12.17 / 2, z1: -2.94 + 12.17 / 2, top: 0.85 };
function ctr(o) { return o.min.map((v, i) => (v + o.max[i]) / 2); }
const onStage = nodes.filter(o => {
    const c = ctr(o);
    return c[0] > ST.x0 && c[0] < ST.x1 && c[2] > ST.z0 && c[2] < ST.z1 && c[1] > ST.top - 0.05;
});
// 按名称前缀聚合（去掉尾部 .NNN 序号与 #NNN）
function prefix(name) {
    return name.replace(/\.\d+$/, '').replace(/#\d+$/, '').replace(/ \(Loose Mesh\)$/, '');
}
const groups = new Map();
for (const o of onStage) {
    const p = prefix(o.name);
    let g = groups.get(p);
    if (!g) { g = { n: 0, tris: 0, ymin: 1e9, ymax: -1e9, sample: [] }; groups.set(p, g); }
    g.n++; g.tris += o.tris;
    g.ymin = Math.min(g.ymin, o.min[1]); g.ymax = Math.max(g.ymax, o.max[1]);
    if (g.sample.length < 3) g.sample.push(o.name);
}
const arr = [...groups.entries()].sort((a, b) => b[1].tris - a[1].tris);
console.log('stage region x', ST.x0.toFixed(2), '..', ST.x1.toFixed(2), ' z', ST.z0.toFixed(2), '..', ST.z1.toFixed(2));
console.log('objects on stage:', onStage.length, ' groups:', arr.length);
let tot = 0;
for (const [p, g] of arr) {
    tot += g.tris;
    console.log(`${String(g.n).padStart(5)}  tris=${String(g.tris).padStart(8)}  y=${g.ymin.toFixed(2)}..${g.ymax.toFixed(2)}  ${p}   [${g.sample.join(' | ')}]`);
}
console.log('total stage-prop tris =', tot);
