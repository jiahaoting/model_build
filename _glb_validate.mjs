import fs from 'fs';
const buf = fs.readFileSync('assets/models/eastman_theater.glb');
const jsonLen = buf.readUInt32LE(12);
const j = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));

console.log('counts: meshes=%d materials=%d textures=%d images=%d samplers=%d bufferViews=%d accessors=%d nodes=%d',
  j.meshes?.length, j.materials?.length, j.textures?.length, j.images?.length, j.samplers?.length, j.bufferViews?.length, j.accessors?.length, j.nodes?.length);
console.log('extensionsUsed:', j.extensionsUsed);
console.log('extensionsRequired:', j.extensionsRequired);

// 校验 textures 的 source / EXT_texture_webp source 索引是否越界
const nImg = (j.images || []).length;
let bad = 0;
(j.textures || []).forEach((t, i) => {
  const srcs = [];
  if (t.source !== undefined) srcs.push(['base', t.source]);
  if (t.extensions?.EXT_texture_webp?.source !== undefined) srcs.push(['webp', t.extensions.EXT_texture_webp.source]);
  for (const [kind, s] of srcs) {
    if (s < 0 || s >= nImg) { console.log(`BAD texture[${i}] ${kind} source=${s} (images=${nImg})`); bad++; }
  }
  if (!srcs.length) { console.log(`texture[${i}] has NO source`); bad++; }
});
console.log('bad textures:', bad);

// images 的 uri / bufferView 情况
const imgKinds = {};
(j.images || []).forEach((im, i) => {
  const k = im.uri ? 'uri' : (im.bufferView !== undefined ? 'bufferView' : 'NONE');
  imgKinds[k] = (imgKinds[k] || 0) + 1;
  if (k === 'NONE') console.log('image[%d] has neither uri nor bufferView', i);
});
console.log('image kinds:', imgKinds);

// materials 引用 texture 索引越界检查
const nTex = (j.textures || []).length;
let badM = 0;
function chkTex(idx, where) { if (idx !== undefined && (idx < 0 || idx >= nTex)) { console.log('BAD material tex ref', where, idx, 'of', nTex); badM++; } }
(j.materials || []).forEach((m, i) => {
  chkTex(m.pbrMetallicRoughness?.baseColorTexture?.index, `mat[${i}].baseColor`);
  chkTex(m.pbrMetallicRoughness?.metallicRoughnessTexture?.index, `mat[${i}].mr`);
  chkTex(m.normalTexture?.index, `mat[${i}].normal`);
  chkTex(m.occlusionTexture?.index, `mat[${i}].occl`);
  chkTex(m.emissiveTexture?.index, `mat[${i}].emis`);
});
console.log('bad material tex refs:', badM);

// samplers 越界
let badS = 0;
(j.textures || []).forEach((t, i) => { if (t.sampler !== undefined && t.sampler >= (j.samplers?.length || 0)) { console.log('BAD sampler ref texture', i); badS++; } });
console.log('bad sampler refs:', badS);
