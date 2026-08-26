const fs = require('fs');
const buf = fs.readFileSync('assets/models/piano.glb');
let off = 12, jsonText = null, binStart = -1, binLen = 0;
while (off + 8 <= buf.length) {
  const len = buf.readUInt32LE(off);
  const type = buf.readUInt32LE(off + 4);
  const name = String.fromCharCode(type & 0xff, (type >> 8) & 0xff, (type >> 16) & 0xff, (type >> 24) & 0xff);
  if (name === 'JSON') jsonText = buf.slice(off + 8, off + 8 + len).toString('utf8');
  if (name === 'BIN\0') { binStart = off + 8; binLen = len; }
  off += 8 + len + (len % 4);
}
const gl = JSON.parse(jsonText);
const binBuf = buf.slice(binStart, binStart + binLen);

// 材质信息
console.log('=== MATERIALS ===');
(gl.materials || []).forEach((m, i) => {
  const pbr = m.pbrMetallicRoughness || {};
  const bc = pbr.baseColorFactor || 'texture';
  console.log(`mat[${i}] name="${m.name}" baseColorFactor=${JSON.stringify(bc)}`);
});

// 每个 prim 的材质索引
console.log('\n=== PRIMS (mesh -> material) ===');
(gl.meshes || []).forEach((m, mi) => {
  m.primitives.forEach((p, pi) => {
    const posAcc = p.attributes.POSITION;
    console.log(`mesh[${mi}] prim[${pi}] material=${p.material} POS@${posAcc}`);
  });
});

function readAccessor(idx) {
  const acc = gl.accessors[idx];
  const bv = gl.bufferViews[acc.bufferView];
  const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  if (acc.componentType === 5126) {
    return new Float32Array(binBuf.buffer, binBuf.byteOffset + base, acc.count * 3);
  }
  // indices: UNSIGNED_SHORT(5123) or UNSIGNED_INT(5125)
  if (acc.componentType === 5123) {
    return new Uint16Array(binBuf.buffer, binBuf.byteOffset + base, acc.count);
  }
  if (acc.componentType === 5125) {
    return new Uint32Array(binBuf.buffer, binBuf.byteOffset + base, acc.count);
  }
  return null;
}

// 并查集统计连通分量（独立键块数）
function countComponents(posAcc, idxAcc) {
  const pos = readAccessor(posAcc);
  const idx = readAccessor(idxAcc);
  const n = idx.length;
  const parent = new Array(n).fill(0).map((_, i) => i);
  function find(a) { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; }
  function union(a, b) { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }
  for (let i = 0; i < n; i += 3) {
    union(idx[i], idx[i+1]);
    union(idx[i+1], idx[i+2]);
  }
  const roots = new Set();
  for (let i = 0; i < n; i++) roots.add(find(idx[i]));
  return roots.size;
}

console.log('\n=== COMPONENT COUNTS (独立键块) ===');
console.log('WHITE keys components =', countComponents(2, 3));
console.log('BLACK keys components =', countComponents(4, 5));
console.log('body(prim0) components =', countComponents(0, 1));