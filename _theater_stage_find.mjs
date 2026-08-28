import fs from 'fs';
const nodes = JSON.parse(fs.readFileSync('_theater_nodes.json', 'utf8'));

function sz(o){return [o.max[0]-o.min[0],o.max[1]-o.min[1],o.max[2]-o.min[2]];}
function ctr(o){return o.min.map((v,i)=>(v+o.max[i])/2);}
function fmt(o){const s=sz(o).map(v=>v.toFixed(2)).join(' x ');const c=ctr(o).map(v=>v.toFixed(2)).join(', ');return `${o.name} | size=${s} | center=(${c}) | tris=${o.tris}`;}

// 1) 占地面积最大的 30 个
console.log('=== top 30 by XZ footprint ===');
const byArea = [...nodes].sort((a,b)=>{const A=(b.max[0]-b.min[0])*(b.max[2]-b.min[2]),B=(a.max[0]-a.min[0])*(a.max[2]-a.min[2]);return A-B;});
byArea.slice(0,30).forEach(o=>console.log(fmt(o)));

// 2) y 中心在 -1~2.5 之间、XZ 面积 > 20 的（地板/舞台候选）
console.log('\n=== floor-level slabs (cy in [-1,2.5], area>20) ===');
nodes.filter(o=>{const c=ctr(o);const s=sz(o);return c[1]>-1&&c[1]<2.5&&s[0]*s[2]>20;})
  .sort((a,b)=>sz(b)[0]*sz(b)[2]-sz(a)[0]*sz(a)[2])
  .slice(0,25).forEach(o=>console.log(fmt(o)));

// 3) 低处大物体顶部高度分布（找舞台台面 y）
console.log('\n=== objects with top in [0.3,1.5] and area>15 ===');
nodes.filter(o=>{const t=o.max[1];const s=sz(o);return t>0.3&&t<1.5&&s[0]*s[2]>15;})
  .sort((a,b)=>sz(b)[0]*sz(b)[2]-sz(a)[0]*sz(a)[2])
  .slice(0,20).forEach(o=>console.log(fmt(o)));

// 4) z<-5 的 z 负端大物体（舞台若在 -z 端）
console.log('\n=== big objects at -Z end (z center < -6, area>10) ===');
nodes.filter(o=>{const c=ctr(o);const s=sz(o);return c[2]<-6&&s[0]*s[2]>10;})
  .sort((a,b)=>sz(b)[0]*sz(b)[2]-sz(a)[0]*sz(a)[2])
  .slice(0,20).forEach(o=>console.log(fmt(o)));
