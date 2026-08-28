import fs from 'fs';
const buf = fs.readFileSync('assets/models/eastman_theater.glb');
const j = JSON.parse(buf.slice(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
const attrSets = new Set();
let withT2 = 0, withT1 = 0, total = 0;
for (const m of j.meshes) for (const p of m.primitives) {
  total++;
  const keys = Object.keys(p.attributes).sort().join(',');
  attrSets.add(keys);
  if ('TEXCOORD_2' in p.attributes) withT2++;
  if ('TEXCOORD_1' in p.attributes) withT1++;
}
console.log('prims:', total, 'with TEXCOORD_1:', withT1, 'with TEXCOORD_2:', withT2);
console.log('attr sets:'); for (const s of attrSets) console.log(' ', s);
// 材质各贴图 texCoord 分布
const tc = {};
for (const m of j.materials) {
  const slots = [m.pbrMetallicRoughness?.baseColorTexture, m.pbrMetallicRoughness?.metallicRoughnessTexture, m.normalTexture, m.occlusionTexture, m.emissiveTexture];
  for (const t of slots) if (t) { const k = t.texCoord ?? 0; tc[k] = (tc[k] || 0) + 1; }
}
console.log('material texture texCoord distribution:', tc);
