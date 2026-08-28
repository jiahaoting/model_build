import fs from 'fs';
const nodes = JSON.parse(fs.readFileSync('_theater_nodes.json', 'utf8'));
// 钢琴模型坐标（世界 0,1.1,-11.5 对应模型局部）：x=3.43, y≈0.85, z=-3.14
const P = [3.43, 0.85, -3.14];
function ctr(o){return o.min.map((v,i)=>(v+o.max[i])/2);}
function sz(o){return [o.max[0]-o.min[0],o.max[1]-o.min[1],o.max[2]-o.min[2]];}
const near = nodes.filter(o=>{
  const c = ctr(o);
  const dx = c[0]-P[0], dz = c[2]-P[2];
  const d = Math.hypot(dx, dz);
  return d < 3.0 && c[1] < 3.5;
}).map(o=>({name:o.name, d:+Math.hypot(ctr(o)[0]-P[0], ctr(o)[2]-P[2]).toFixed(2), c:ctr(o).map(v=>+v.toFixed(2)), s:sz(o).map(v=>+v.toFixed(2)), tris:o.tris})).sort((a,b)=>a.d-b.d);
console.log('objects within 3m of piano (model coords), count=', near.length);
for (const o of near) console.log(`${o.d}m  ${o.name}  c=${o.c} s=${o.s} tris=${o.tris}`);
