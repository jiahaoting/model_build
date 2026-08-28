// 分析 opera_house_opt.glb：节点名分布 + 关键 mesh 世界包围盒 + 场景总包围盒
import fs from 'fs';

const file = 'assets/models/opera_house_opt.glb';
const fd = fs.openSync(file, 'r');
const header = Buffer.alloc(20);
fs.readSync(fd, header, 0, 20, 0);
const jsonLen = header.readUInt32LE(12);
const jsonBuf = Buffer.alloc(jsonLen);
fs.readSync(fd, jsonBuf, 0, jsonLen, 20);
const json = JSON.parse(jsonBuf.toString('utf8'));
fs.closeSync(fd);

const { nodes = [], meshes = [], accessors = [], scenes = [] } = json;

function compose(t, r, s) {
  const [x, y, z, w] = r;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const [sx, sy, sz] = s;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz - wx) * sy, 0,
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
  return [m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12], m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13], m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14]];
}
const IDENT = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];

// 遍历 scene，累计每个 mesh 实例的世界包围盒（primitive 用 accessor min/max）
const records = [];  // { nodeName, center, size, meshName }
const sceneBox = { min: [1e9,1e9,1e9], max: [-1e9,-1e9,-1e9] };
function boxOf(prim, wm) {
  const acc = accessors[prim.attributes.POSITION];
  if (!acc.min || !acc.max) return null;
  const a = xform(wm, acc.min), b = xform(wm, acc.max);
  return { c: [(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2], size: [Math.abs(b[0]-a[0]),Math.abs(b[1]-a[1]),Math.abs(b[2]-a[2])] };
}
function walk(idx, pm) {
  const n = nodes[idx];
  const m = n.matrix ? mul(pm, n.matrix) : mul(pm, compose(n.translation||[0,0,0], n.rotation||[0,0,0,1], n.scale||[1,1,1]));
  if (n.mesh != null) {
    const mesh = meshes[n.mesh];
    for (const p of mesh.primitives) {
      const b = boxOf(p, m);
      if (!b) continue;
      const [c] = b.c;
      for (let k = 0; k < 3; k++) {
        sceneBox.min[k] = Math.min(sceneBox.min[k], b.c[k] - b.size[k]/2);
        sceneBox.max[k] = Math.max(sceneBox.max[k], b.c[k] + b.size[k]/2);
      }
      records.push({
        nodeName: n.name || '(unnamed)',
        meshName: mesh.name || '(unnamed mesh)',
        center: b.c.map(v => +v.toFixed(2)),
        size: b.size.map(v => +v.toFixed(2))
      });
    }
  }
  for (const ch of n.children || []) walk(ch, m);
}
const rootNodes = scenes[0]?.nodes || [];
for (const r of rootNodes) walk(r, IDENT);

console.log('场景总包围盒:');
console.log('  min', sceneBox.min.map(v=>+v.toFixed(1)), ' max', sceneBox.max.map(v=>+v.toFixed(1)));
const span = [0,1,2].map(k => (sceneBox.max[k]-sceneBox.min[k]).toFixed(1));
console.log('  尺寸 x/y/z =', span);

// 节点名分组
const nameCount = new Map();
for (const r of records) nameCount.set(r.nodeName, (nameCount.get(r.nodeName)||0)+1);
console.log('\n节点名分组（按 mesh 实例数，前 60）:');
for (const [n, c] of [...nameCount.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 60)) {
  console.log('  ', String(c).padStart(4), n);
}

// 关键：列出按名字匹配的 mesh 包围盒（钢琴、舞台、座椅、吊灯等）
console.log('\n关键物体包围盒（含名字关键词）:');
const KW = /piano|stage|chair|armchair|balcony|chandelier|curtain|seat|lamp|spotlight|floor|ceiling|wall|pillar|door|subwoofer|micro|note/i;
const seen = new Set();
for (const r of records) {
  if (!KW.test(r.nodeName) && !KW.test(r.meshName)) continue;
  const key = r.nodeName + '|' + r.meshName;
  if (seen.has(key)) continue;
  seen.add(key);
  console.log(`  ${r.nodeName} [${r.meshName}] center=${r.center.join(',')} size=${r.size.join(',')}`);
}