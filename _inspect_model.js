const fs = require('fs');
const file = process.argv[2] || 'assets/models/michelle.glb';
const buf = fs.readFileSync(file);
const magic = buf.readUInt32LE(0);
if (magic !== 0x46546C67) { console.error('not glb'); process.exit(1); }
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

console.log('=== NODES (name | mesh | children) ===');
nodes.forEach((n, i) => {
  console.log(`[${i}] "${n.name}" mesh=${n.mesh} skin=${n.skin} children=${JSON.stringify(n.children || [])}`);
});

console.log('\n=== SKINS (joints count) ===');
(gl.skins || []).forEach((s, si) => {
  console.log(`skin[${si}] name="${s.name}" joints=${s.joints.length}`);
  console.log('  joint node names: ' + s.joints.map(j => nodes[j] && nodes[j].name).join(', '));
});

console.log('\n=== ANIMATIONS ===');
(gl.animations || []).forEach((a, ai) => {
  let dur = 0;
  a.channels.forEach(c => {
    const s = a.samplers[c.sampler];
    const inp = gl.accessors[s.input];
    if (inp && inp.max && inp.max[0] > dur) dur = inp.max[0];
  });
  console.log(`anim[${ai}] name="${a.name}" dur=${dur.toFixed(2)}s channels=${a.channels.length}`);
});

console.log('\n=== MESHES (name | prims | material) ===');
(gl.meshes || []).forEach((m, mi) => {
  console.log(`mesh[${mi}] name="${m.name}" prims=${m.primitives.length}`);
  m.primitives.forEach((p, pi) => {
    console.log(`   prim[${pi}] material=${p.material} joints=${p.attributes.JOINTS_0} weights=${p.attributes.WEIGHTS_0}`);
  });
});

console.log('\n=== MATERIALS ===');
(gl.materials || []).forEach((m, i) => {
  const pbr = m.pbrMetallicRoughness || {};
  console.log(`mat[${i}] name="${m.name}" baseColor=${JSON.stringify(pbr.baseColorFactor)} baseColorTex=${pbr.baseColorTexture ? pbr.baseColorTexture.index : null} normalTex=${m.normalTexture ? m.normalTexture.index : null}`);
});