const fs = require('fs');
const file = process.argv[2] || 'assets/models/michelle.glb';
const buf = fs.readFileSync(file);
let off = 12, jsonText = null;
while (off + 8 <= buf.length) {
  const len = buf.readUInt32LE(off);
  const type = buf.readUInt32LE(off + 4);
  const name = String.fromCharCode(type & 0xff, (type >> 8) & 0xff, (type >> 16) & 0xff, (type >> 24) & 0xff);
  if (name === 'JSON') { jsonText = buf.slice(off + 8, off + 8 + len).toString('utf8'); break; }
  off += 8 + len + (len % 4);
}
const gl = JSON.parse(jsonText);
const nodes = gl.nodes || [];

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
const parents = new Array(nodes.length).fill(null);
nodes.forEach((n, i) => (n.children || []).forEach((c) => { parents[c] = i; }));
const cache = {};
function worldMatrix(idx) {
  if (cache[idx]) return cache[idx];
  const local = localMatrix(nodes[idx]);
  const p = parents[idx];
  const w = (p === null || p === undefined) ? local : mul(worldMatrix(p), local);
  cache[idx] = w;
  return w;
}
function pos(idx) {
  const w = worldMatrix(idx);
  return [w[12], w[13], w[14]];
}

const key = ['mixamorig:Hips','mixamorig:Spine','mixamorig:Spine1','mixamorig:Spine2','mixamorig:Neck','mixamorig:Head','mixamorig:HeadTop_End',
  'mixamorig:LeftShoulder','mixamorig:LeftArm','mixamorig:LeftForeArm','mixamorig:LeftHand',
  'mixamorig:LeftHandThumb1','mixamorig:LeftHandIndex1','mixamorig:LeftHandMiddle1','mixamorig:LeftHandRing1','mixamorig:LeftHandPinky1',
  'mixamorig:LeftHandIndex4','mixamorig:LeftHandMiddle4',
  'mixamorig:RightShoulder','mixamorig:RightArm','mixamorig:RightForeArm','mixamorig:RightHand',
  'mixamorig:LeftUpLeg','mixamorig:LeftLeg','mixamorig:LeftFoot','mixamorig:LeftToeBase',
  'mixamorig:RightUpLeg','mixamorig:RightLeg','mixamorig:RightFoot','mixamorig:RightToeBase'];
const byName = {};
nodes.forEach((n, i) => byName[n.name] = i);
for (const k of key) {
  const i = byName[k];
  if (i === undefined) { console.log(k, 'NOT FOUND'); continue; }
  const p = pos(i);
  console.log(`${k}  =>  x=${p[0].toFixed(3)} y=${p[1].toFixed(3)} z=${p[2].toFixed(3)}`);
}