import fs from 'fs';
const nodes = JSON.parse(fs.readFileSync('_theater_nodes.json', 'utf8'));
function sz(o){return [o.max[0]-o.min[0],o.max[1]-o.min[1],o.max[2]-o.min[2]];}
function ctr(o){return o.min.map((v,i)=>(v+o.max[i])/2);}
function fmt(o){const s=sz(o).map(v=>v.toFixed(1)).join('x');const c=ctr(o).map(v=>v.toFixed(1)).join(',');return `${o.name} | ${s} | c=(${c}) | tris=${o.tris}`;}

console.log('=== high objects (cy>6), tris>300, by tris ===');
nodes.filter(o=>ctr(o)[1]>6 && o.tris>300).sort((a,b)=>b.tris-a.tris).slice(0,30).forEach(o=>console.log(fmt(o)));

console.log('\n=== name hints: chandelier|lamp|light|torch|crystal|ceiling|dome ===');
nodes.filter(o=>/chandel|lamp|light|torch|crystal|ceil|dome|pendant|sconce/i.test(o.name)).slice(0,30).forEach(o=>console.log(fmt(o)));

console.log('\n=== audience-area seat-like: z in [4,18], y in [0,8], count of similar ===');
const seats = nodes.filter(o=>{const c=ctr(o);const s=sz(o);return c[2]>4&&c[2]<18&&c[1]>0.2&&c[1]<9&&s[0]>0.3&&s[0]<2&&s[2]<2;});
console.log('seat-like count:', seats.length);
if (seats.length) {
  const ys = seats.map(o=>+ctr(o)[1].toFixed(1));
  const hist = {};
  ys.forEach(y=>hist[y]=(hist[y]||0)+1);
  console.log('y histogram:', JSON.stringify(hist));
}
