import { readFileSync } from 'node:fs';
const rep = JSON.parse(readFileSync('_theater_report.json', 'utf8'));

// 按名称前缀聚合（去掉 .001 后缀与数字尾巴）
const groups = {};
for (const ob of rep.top_objects) {
    if (ob.type !== 'MESH') continue;
    const base = ob.name.replace(/\.\d+$/, '').replace(/[\d_]+$/, '') || ob.name;
    const g = groups[base] || (groups[base] = { count: 0, polys: 0, dims: ob.dim });
    g.count++;
    g.polys += ob.polys || 0;
}
const arr = Object.entries(groups).sort((a, b) => b[1].polys - a[1].polys);
console.log('=== 网格分组（按总面数排序，前 40）===');
let shown = 0;
for (const [name, g] of arr) {
    console.log(`${String(g.polys).padStart(9)} 面 | ${String(g.count).padStart(4)} 个 | ${name} | 尺寸 ${g.dims}`);
    if (++shown >= 40) break;
}
console.log('\n=== 非网格顶层对象类型统计 ===');
const types = {};
for (const ob of rep.top_objects) types[ob.type] = (types[ob.type] || 0) + 1;
console.log(types);
