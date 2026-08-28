// 直接解析 eastman_theater.glb（无依赖）：枚举节点世界包围盒，找舞台候选
import fs from 'fs';

const file = 'assets/models/eastman_theater.glb';
const buf = fs.readFileSync(file);
if (buf.readUInt32LE(0) !== 0x46546C67) throw new Error('not glb');
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));

const { nodes = [], meshes = [], accessors = [], scenes, scene: defScene = 0 } = json;

// --- 矩阵工具 ---
function compose(t, r, s) { // TRS -> mat4 (列主序数组16)
  const [x, y, z, w] = r;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const [sx, sy, sz] = s;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    t[0], t[1], t[2], 1
  ];
}
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function xform(m, v) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]
  ];
}
const IDENT = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];

const out = [];
function walk(ni, parentM) {
  const n = nodes[ni];
  let local = n.matrix ? n.matrix.slice() : compose(n.translation || [0,0,0], n.rotation || [0,0,0,1], n.scale || [1,1,1]);
  const world = mul(parentM, local);
  if (n.mesh !== undefined) {
    const mesh = meshes[n.mesh];
    let mn = [1e18,1e18,1e18], mx = [-1e18,-1e18,-1e18], prims = 0, tris = 0;
    for (const p of mesh.primitives || []) {
      const posAcc = accessors[p.attributes?.POSITION];
      if (!posAcc || !posAcc.min) continue;
      prims++;
      tris += (p.indices !== undefined ? accessors[p.indices].count : posAcc.count) / 3;
      const { min, max } = posAcc;
      for (const cx of [min[0], max[0]]) for (const cy of [min[1], max[1]]) for (const cz of [min[2], max[2]]) {
        const w = xform(world, [cx, cy, cz]);
        for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], w[i]); mx[i] = Math.max(mx[i], w[i]); }
      }
    }
    if (prims) out.push({ name: n.name || `node${ni}`, min: mn, max: mx, tris: Math.round(tris) });
  }
  for (const c of n.children || []) walk(c, world);
}
for (const root of scenes[defScene].nodes) walk(root, IDENT);

console.log('total mesh nodes:', out.length);

// 全场包围盒
const gmn = [1e18,1e18,1e18], gmx = [-1e18,-1e18,-1e18];
for (const o of out) for (let i = 0; i < 3; i++) { gmn[i] = Math.min(gmn[i], o.min[i]); gmx[i] = Math.max(gmx[i], o.max[i]); }
console.log('global bbox min', gmn.map(v=>v.toFixed(2)).join(','), 'max', gmx.map(v=>v.toFixed(2)).join(','));

// 名称含 stage/floor/platform 的
const kw = /stage|floor|platform|podium|deck|orchestra/i;
const named = out.filter(o => kw.test(o.name));
console.log('\n=== name-matched (stage/floor/platform) ===');
for (const o of named.slice(0, 40)) {
  const sz = o.max.map((v,i)=>(v-o.min[i]).toFixed(2)).join(' x ');
  console.log(`${o.name}  size=${sz}  center=${o.min.map((v,i)=>((v+o.max[i])/2).toFixed(2)).join(',')}  tris=${o.tris}`);
}

// 大面积薄板候选：X/Z 跨度>8m，Y 厚度<0.8m，Y 中心在 -1..3
console.log('\n=== large thin horizontal slabs (stage candidates) ===');
const slabs = out.filter(o => {
  const sx = o.max[0]-o.min[0], sy = o.max[1]-o.min[1], sz = o.max[2]-o.min[2];
  const cy = (o.min[1]+o.max[1])/2;
  return sx > 8 && sz > 5 && sy < 1.2 && cy > -1.5 && cy < 4;
}).sort((a,b)=>((b.max[0]-b.min[0])*(b.max[2]-b.min[2]))-((a.max[0]-a.min[0])*(a.max[2]-a.min[2])));
for (const o of slabs.slice(0, 25)) {
  const sz = o.max.map((v,i)=>(v-o.min[i]).toFixed(2)).join(' x ');
  console.log(`${o.name}  size=${sz}  center=${o.min.map((v,i)=>((v+o.max[i])/2).toFixed(2)).join(',')}  tris=${o.tris}`);
}

fs.writeFileSync('_theater_nodes.json', JSON.stringify(out.map(o=>({name:o.name,min:o.min,max:o.max,tris:o.tris})), null, 1));
console.log('\nwrote _theater_nodes.json');
