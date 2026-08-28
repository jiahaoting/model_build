// 修复 eastman_theater.glb：剥离无效贴图引用（texture 无 source 导致 GLTFLoader 崩溃）
import fs from 'fs';

const FILE = 'assets/models/eastman_theater.glb';
const buf = fs.readFileSync(FILE);
const magic = buf.readUInt32LE(0);
if (magic !== 0x46546C67) throw new Error('not glb');
const total = buf.readUInt32LE(8);
const jsonLen = buf.readUInt32LE(12);
const jsonChunkType = buf.readUInt32LE(16);
if (jsonChunkType !== 0x4E4F534A) throw new Error('first chunk not JSON');
const jsonBuf = buf.slice(20, 20 + jsonLen);
const rest = buf.slice(20 + jsonLen); // BIN chunk(s) 原样保留
const j = JSON.parse(jsonBuf.toString('utf8'));

// 1) 找出无 source 的 texture
const badTex = new Set();
(j.textures || []).forEach((t, i) => {
  const hasBase = t.source !== undefined;
  const hasWebp = t.extensions?.EXT_texture_webp?.source !== undefined;
  if (!hasBase && !hasWebp) badTex.add(i);
});
console.log('bad textures:', [...badTex]);

// 2) 遍历 materials，剥离引用这些 texture 的槽位
let stripped = 0;
function stripSlot(holder, key) {
  if (holder && holder[key] && badTex.has(holder[key].index)) {
    delete holder[key]; stripped++;
    console.log(`  stripped ${key}`);
  }
}
(j.materials || []).forEach((m, i) => {
  const pbr = m.pbrMetallicRoughness || {};
  if (pbr.baseColorTexture && badTex.has(pbr.baseColorTexture.index)) { console.log(`mat[${i}] ${m.name}: baseColor`); delete pbr.baseColorTexture; stripped++; }
  if (pbr.metallicRoughnessTexture && badTex.has(pbr.metallicRoughnessTexture.index)) { console.log(`mat[${i}] ${m.name}: mr`); delete pbr.metallicRoughnessTexture; stripped++; }
  if (m.normalTexture && badTex.has(m.normalTexture.index)) { console.log(`mat[${i}] ${m.name}: normal`); delete m.normalTexture; stripped++; }
  if (m.occlusionTexture && badTex.has(m.occlusionTexture.index)) { console.log(`mat[${i}] ${m.name}: occlusion`); delete m.occlusionTexture; stripped++; }
  if (m.emissiveTexture && badTex.has(m.emissiveTexture.index)) { console.log(`mat[${i}] ${m.name}: emissive`); delete m.emissiveTexture; stripped++; }
});
console.log('stripped refs:', stripped);

// 3) 顺带把无 source 的 texture 指向一张有效 image（避免任何 loader 仍然访问）
//    不删除 textures 本体，保持索引稳定；给它 source=0（有效图）作为兜底。
for (const i of badTex) {
  j.textures[i].source = 0;
  j.textures[i].sampler = j.textures[i].sampler ?? 0;
}

// 4) 重写 GLB（JSON chunk 4 字节对齐补齐空格）
let newJson = Buffer.from(JSON.stringify(j), 'utf8');
const pad = (4 - (newJson.length % 4)) % 4;
if (pad) newJson = Buffer.concat([newJson, Buffer.alloc(pad, 0x20)]);
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546C67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(20 + newJson.length + rest.length, 8);
header.writeUInt32LE(newJson.length, 12);
header.writeUInt32LE(0x4E4F534A, 16);
const out = Buffer.concat([header, newJson, rest]);
fs.writeFileSync(FILE, out);
console.log(`written ${FILE} ${(out.length / 1e6).toFixed(1)}MB (json ${jsonBuf.length} -> ${newJson.length})`);
