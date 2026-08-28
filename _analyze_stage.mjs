// 分析 eastman_theater.glb 舞台上（模型局部 footprint）的所有网格节点，
// 识别演出道具（三角钢琴/萨克斯/椅子/谱架/定音鼓/音箱/指挥台/管弦乐队摆台）的精确节点名，
// 以便用节点名精确剔除，替代宽泛的包围盒区域过滤（2128 件误删建筑细节）。
import fs from 'fs';

const buf = fs.readFileSync('assets/models/eastman_theater.glb');
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
  return [m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12], m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13], m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14]];
}
const IDENT = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];

function primBoundsWorld(prim, wm) {
  const acc = accessors[prim.attributes.POSITION];
  if (!acc.min || !acc.max) return null;
  const a = xform(wm, acc.min), b = xform(wm, acc.max);
  return { c: [(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2], size: [Math.abs(b[0]-a[0]),Math.abs(b[1]-a[1]),Math.abs(b[2]-a[2])] };
}

// 舞台 footprint（模型局部坐标，与 STAGE_PROP_REGION 一致）
const REG = { x0: -4.18, x1: 11.04, z0: -9.03, z1: 3.15 };

// 收集：名字（净化后）-> { count, 中心范围, 尺寸范围 }
const agg = new Map();
function walk(idx, pm) {
  const n = nodes[idx];
  const m = n.matrix ? mul(pm, n.matrix)
    : mul(pm, compose(n.translation||[0,0,0], n.rotation||[0,0,0,1], n.scale||[1,1,1]));
  if (n.mesh != null) {
    for (const p of meshes[n.mesh].primitives) {
      const b = primBoundsWorld(p, m);
      if (!b) continue;
      const [cx, cy, cz] = b.c;
      if (cx < REG.x0 || cx > REG.x1 || cz < REG.z0 || cz > REG.z1) continue;
      const name = (n.name || '').replace(/\s/g, '_').replace(/[\[\].:\/]/g, '');
      const base = name.replace(/\.?\d+$/, '');
      const e = agg.get(base) || { count: 0, c: b.c, size: b.size };
      e.count++;
      agg.set(base, e);
    }
  }
  for (const ch of n.children || []) walk(ch, m);
}
for (const root of json.scenes[json.scene ?? 0].nodes) walk(root, IDENT);

console.log('舞台上（模型局部 footprint）网格节点按名字分组：');
console.log('count | name | center(x,y,z) | size(dx,dy,dz)');
const rows = [...agg.entries()].sort((a, b) => b[1].count - a[1].count);
for (const [name, e] of rows) {
  console.log(String(e.count).padStart(5), '|', name, '|',
    e.c.map(v => +v.toFixed(2)).join(','), '|',
    e.size.map(v => +v.toFixed(2)).join(','));
}
console.log('总节点名种类=', rows.length, '总网格实例=', rows.reduce((s, r) => s + r[1].count, 0));