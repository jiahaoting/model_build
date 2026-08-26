const fs = require('fs');
const buf = fs.readFileSync('assets/models/piano.glb');
const magic = buf.readUInt32LE(0);
if (magic !== 0x46546C67) { console.error('not glb'); process.exit(1); }
let off = 12;
let jsonText = null;
while (off + 8 <= buf.length) {
  const len = buf.readUInt32LE(off);
  const type = buf.readUInt32LE(off + 4);
  const name = String.fromCharCode(type & 0xff, (type >> 8) & 0xff, (type >> 16) & 0xff, (type >> 24) & 0xff);
  if (name === 'JSON') { jsonText = buf.slice(off + 8, off + 8 + len).toString('utf8'); break; }
  off += 8 + len + (len % 4);
}
const gl = JSON.parse(jsonText);

// quaternion to 4x4
function quatMatrix(q, m) {
  const [x, y, z, w] = q;
  const d = x * x + y * y + z * z + w * w || 1;
  const s = d === 1 ? 2 : 2 / d;
  const xy = x * y * s, xz = x * z * s, xw = x * w * s;
  const yz = y * z * s, yw = y * w * s, zw = z * w * s;
  const xx = x * x * s, yy = y * y * s, zz = z * z * s;
  m[0] = 1 - (yy + zz); m[1] = xy + zw;         m[2] = xz - yw;         m[3] = 0;
  m[4] = xy - zw;        m[5] = 1 - (xx + zz);  m[6] = yz + xw;         m[7] = 0;
  m[8] = xz + yw;        m[9] = yz - xw;        m[10] = 1 - (xx + yy);  m[11] = 0;
  m[12] = 0; m[13] = 0; m[14] = 0; m[15] = 1;
  return m;
}
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = 0;
    for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  }
  return o;
}
function localMatrix(node) {
  const m = new Array(16).fill(0); m[0] = m[5] = m[10] = m[15] = 1;
  if (node.matrix) { for (let i = 0; i < 16; i++) m[i] = node.matrix[i]; return m; }
  const T = new Array(16).fill(0); T[0] = T[5] = T[10] = T[15] = 1;
  if (node.translation) { T[12] = node.translation[0]; T[13] = node.translation[1]; T[14] = node.translation[2]; }
  let R = new Array(16).fill(0); R[0] = R[5] = R[10] = R[15] = 1;
  if (node.rotation) R = quatMatrix(node.rotation, R);
  const S = new Array(16).fill(0); S[0] = S[5] = S[10] = S[15] = 1;
  if (node.scale) { S[0] = node.scale[0]; S[5] = node.scale[1]; S[10] = node.scale[2]; }
  return mul(mul(T, R), S);
}

const nodes = gl.nodes || [];
const parents = new Array(nodes.length).fill(null);
nodes.forEach((n, i) => (n.children || []).forEach((c) => { parents[c] = i; }));

function worldMatrix(idx, cache) {
  if (cache[idx]) return cache[idx];
  const local = localMatrix(nodes[idx]);
  const p = parents[idx];
  const w = (p === null || p === undefined) ? local : mul(worldMatrix(p, cache), local);
  cache[idx] = w;
  return w;
}

function tx(p, m) {
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
  return [x, y, z];
}

const lines = [];
const cache = {};
lines.push('=== SCENE ===');
lines.push('scene.nodes=' + JSON.stringify(gl.scene));
lines.push('root children=' + JSON.stringify(gl.scenes[gl.scene].nodes));
lines.push('');
lines.push('=== NODES ===');
nodes.forEach((n, i) => {
  const wm = worldMatrix(i, cache);
  lines.push(`node[${i}] name="${n.name}" mesh=${n.mesh} children=${JSON.stringify(n.children || [])}`);
  lines.push(`    localT=${JSON.stringify(n.translation || null)} localR=${JSON.stringify(n.rotation || null)} localS=${JSON.stringify(n.scale || null)}`);
  lines.push(`    worldPos=${[wm[12], wm[13], wm[14]].map(v => v.toFixed(3)).join(',')}`);
});
lines.push('');
lines.push('=== MESHES ===');
(gl.meshes || []).forEach((m, mi) => {
  lines.push(`mesh[${mi}] name="${m.name}" prims=${m.primitives.length}`);
  m.primitives.forEach((p, pi) => {
    const a = p.attributes && p.attributes.POSITION;
    const acc = a != null ? gl.accessors[a] : null;
    const mn = acc && acc.min ? acc.min.map(v => v.toFixed(3)).join(',') : '?';
    const mx = acc && acc.max ? acc.max.map(v => v.toFixed(3)).join(',') : '?';
    lines.push(`   prim[${pi}] POS@${a} min=(${mn}) max=(${mx})`);
  });
});
fs.writeFileSync('_glb_report.txt', lines.join('\n'));
console.log('WROTE _glb_report.txt');