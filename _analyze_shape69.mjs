// 分析 Shape69 节点：确认 63 个 Shape69_(C-Component52) 中，
// 非自发光的那部分到底是「壁灯灯座」还是「观众人偶」——避免把壁灯部件当人偶误删。
import fs from 'fs';

const buf = fs.readFileSync('assets/models/eastman_theater.glb');
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
const { nodes = [], meshes = [], materials = [], accessors = [] } = json;

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
const sanitize = (s) => (s || '').replace(/\s/g, '_').replace(/[\[\].:\/]/g, '');

function primInfo(prim, wm) {
  const acc = accessors[prim.attributes.POSITION];
  const c = acc.min && acc.max ? xform(wm, [(acc.min[0]+acc.max[0])/2,(acc.min[1]+acc.max[1])/2,(acc.min[2]+acc.max[2])/2]) : null;
  const m = materials[prim.material];
  const ef = m && m.emissiveFactor;
  const em = ef ? ef[0] + ef[1] + ef[2] : 0;
  return { c, em };
}

const hits = [];
function walk(idx, pm) {
  const n = nodes[idx];
  const m = n.matrix ? mul(pm, n.matrix) : mul(pm, compose(n.translation||[0,0,0], n.rotation||[0,0,0,1], n.scale||[1,1,1]));
  if (n.mesh != null && /Shape69/i.test(sanitize(n.name))) {
    for (const p of meshes[n.mesh].primitives) {
      const info = primInfo(p, m);
      hits.push({ name: sanitize(n.name), c: info.c, em: info.em });
    }
  }
  for (const ch of n.children || []) walk(ch, m);
}
for (const root of json.scenes[json.scene ?? 0].nodes) walk(root, IDENT);

console.log('Shape69 网格图元总数=', hits.length);
const emGroup = hits.filter(h => h.em > 0.3);
const darkGroup = hits.filter(h => h.em <= 0.3);
console.log('自发光(em>0.3) =', emGroup.length, ' 非自发光 =', darkGroup.length);

function range(list) {
  if (!list.length) return '空';
  const xs = list.map(h => h.c[0]), ys = list.map(h => h.c[1]), zs = list.map(h => h.c[2]);
  const r = (a) => [Math.min(...a).toFixed(2), Math.max(...a).toFixed(2)];
  return `x[${r(xs)}] y[${r(ys)}] z[${r(zs)}]`;
}
console.log('自发光位置范围:', range(emGroup));
console.log('非自发光位置范围:', range(darkGroup));

// 非自发光的前 20 个中心点
console.log('\n非自发光 Shape69 样本中心(x,y,z):');
for (const h of darkGroup.slice(0, 20)) console.log('  ', h.c.map(v => +v.toFixed(2)).join(','));
console.log('自发光 Shape69 样本中心(x,y,z):');
for (const h of emGroup.slice(0, 20)) console.log('  ', h.c.map(v => +v.toFixed(2)).join(','));