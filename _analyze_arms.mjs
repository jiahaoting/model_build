// 分析 eastman_theater.glb 中 "seat_arm stand" 网格实例：数量、世界中心分布、图元拆分情况
import fs from 'fs';

const file = 'assets/models/eastman_theater.glb';
const buf = fs.readFileSync(file);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
const { nodes = [], meshes = [], accessors = [] } = json;

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
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]
  ];
}
const IDENT = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];

// 读取 accessor 的 min/max（glTF 规范要求 POSITION accessor 带 min/max）
function primCenterWorld(prim, wm) {
  const acc = accessors[prim.attributes.POSITION];
  if (!acc.min || !acc.max) return null;
  const c = [(acc.min[0] + acc.max[0]) / 2, (acc.min[1] + acc.max[1]) / 2, (acc.min[2] + acc.max[2]) / 2];
  return xform(wm, c);
}

const ARM = /seat[_ ]arm[_ ]stand/i;
const results = [];
let meshNodeCount = 0, multiPrimNodes = 0;

function walk(idx, parentM) {
  const n = nodes[idx];
  let m = parentM;
  if (n.matrix) m = mul(parentM, n.matrix);
  else m = mul(parentM, compose(n.translation || [0,0,0], n.rotation || [0,0,0,1], n.scale || [1,1,1]));
  if (n.mesh != null && ARM.test(n.name || '')) {
    meshNodeCount++;
    const prims = meshes[n.mesh].primitives;
    if (prims.length > 1) multiPrimNodes++;
    for (let pi = 0; pi < prims.length; pi++) {
      const c = primCenterWorld(prims[pi], m);
      if (c) results.push({ node: n.name, prim: pi, c });
    }
  }
  for (const ch of n.children || []) walk(ch, m);
}
const sceneIdx = json.scene ?? 0;
for (const root of json.scenes[sceneIdx].nodes) walk(root, IDENT);

console.log('匹配节点数=', meshNodeCount, '多图元节点数=', multiPrimNodes, '图元总数=', results.length);

// 5cm 网格去重后剩多少
const seen = new Set();
for (const r of results) {
  const k = r.c.map(v => Math.round(v / 0.05)).join('|');
  seen.add(k);
}
console.log('5cm 网格去重后=', seen.size);

// 抽样：前 6 个节点的图元中心
const byNode = new Map();
for (const r of results) {
  if (!byNode.has(r.node)) byNode.set(r.node, []);
  byNode.get(r.node).push(r.c.map(v => +v.toFixed(3)));
}
let shown = 0;
for (const [name, list] of byNode) {
  if (shown++ >= 6) break;
  console.log(name, JSON.stringify(list));
}
// 相邻中心距离分布（抽 200 个点找最近邻）
let dsum = 0, dn = 0, dmin = 1e9, dmax = 0;
for (let i = 0; i < Math.min(200, results.length); i++) {
  let bd = 1e9;
  for (let j = 0; j < results.length; j++) {
    if (i === j) continue;
    const a = results[i].c, b = results[j].c;
    const d = Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);
    if (d < bd) bd = d;
  }
  dsum += bd; dn++;
  if (bd < dmin) dmin = bd;
  if (bd > dmax) dmax = bd;
}
console.log('最近邻距离 min=', dmin.toFixed(3), 'avg=', (dsum/dn).toFixed(3), 'max=', dmax.toFixed(3));
