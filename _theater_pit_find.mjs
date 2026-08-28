import fs from 'fs';
const nodes = JSON.parse(fs.readFileSync('_theater_nodes.json', 'utf8'));
function sz(o){return [o.max[0]-o.min[0],o.max[1]-o.min[1],o.max[2]-o.min[2]];}
function ctr(o){return o.min.map((v,i)=>(v+o.max[i])/2);}
function fmt(o){const s=sz(o).map(v=>v.toFixed(2)).join('x');const c=ctr(o).map(v=>v.toFixed(2)).join(',');return `${o.name} | ${s} | c=(${c}) | tris=${o.tris}`;}

// 舞台 (G-Object.9441: x -4.18..11.04, y -0.15..0.85, z -9.03..3.14) 前缘 z≈3.1 附近的低矮物体
console.log('=== near stage front (z in [2.5,7], y<1.5) ===');
nodes.filter(o=>{const c=ctr(o);return c[2]>2.5&&c[2]<7&&c[1]<1.5;}).sort((a,b)=>ctr(a)[2]-ctr(b)[2]).slice(0,40).forEach(o=>console.log(fmt(o)));

console.log('\n=== orchestra pit / floor slabs between stage and seats (z in [3,6], area>5) ===');
nodes.filter(o=>{const c=ctr(o);const s=sz(o);return c[2]>3&&c[2]<6&&s[0]*s[2]>5&&c[1]<2;}).forEach(o=>console.log(fmt(o)));

console.log('\n=== audience floor y around first seat rows: objects z in [4,8], y<1.2, big ===');
nodes.filter(o=>{const c=ctr(o);const s=sz(o);return c[2]>4&&c[2]<8&&c[1]<1.2&&s[0]>3;}).forEach(o=>console.log(fmt(o)));
