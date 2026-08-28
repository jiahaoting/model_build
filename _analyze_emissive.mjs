// 分析 eastman_theater.glb 中的自发光材质与使用它们的网格位置
import fs from 'fs';

const buf = fs.readFileSync('assets/models/eastman_theater.glb');
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
const { nodes = [], meshes = [], materials = [] } = json;

// 1) 列出自发光材质
const emissiveMats = new Set();
materials.forEach((m, i) => {
  const ef = m.emissiveFactor;
  const hasEmTex = m.emissiveTexture != null;
  const strong = ef && (ef[0] + ef[1] + ef[2]) > 0.3;
  if (hasEmTex || strong) {
    emissiveMats.add(i);
    console.log(`材质[${i}] "${m.name}" emissiveFactor=${JSON.stringify(ef)} emissiveTex=${hasEmTex}`);
  }
});
console.log('自发光材质数=', emissiveMats.size);

// 2) 找使用这些材质的节点（名字+平移位置）
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
const IDENT = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
const hit = new Map();
function walk(idx, pm) {
  const n = nodes[idx];
  const m = n.matrix ? mul(pm, n.matrix)
    : mul(pm, compose(n.translation || [0,0,0], n.rotation || [0,0,0,1], n.scale || [1,1,1]));
  if (n.mesh != null) {
    for (const p of meshes[n.mesh].primitives) {
      if (emissiveMats.has(p.material)) {
        const base = (n.name || '').replace(/\.?\d+$/, '');
        const key = base + '|mat' + p.material;
        if (!hit.has(key)) hit.set(key, { count: 0, pos: [m[12], m[13], m[14]] });
        hit.get(key).count++;
      }
    }
  }
  for (const ch of n.children || []) walk(ch, m);
}
for (const root of json.scenes[json.scene ?? 0].nodes) walk(root, IDENT);
console.log('\n--- 自发光网格节点（按名字聚合）---');
for (const [k, v] of [...hit.entries()].sort((a, b) => b[1].count - a[1].count)) {
  console.log(String(v.count).padStart(5), k, 'at', v.pos.map(x => +x.toFixed(1)).join(','));
}
