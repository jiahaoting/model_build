// 分析 opera_house.glb 结构（只读 header + JSON chunk，不加载 1.37GB 的 BIN 数据）
import fs from 'fs';

const file = 'assets/models/opera_house.glb';
const fd = fs.openSync(file, 'r');
const header = Buffer.alloc(20);
fs.readSync(fd, header, 0, 20, 0);
const magic = header.toString('ascii', 0, 4);
const version = header.readUInt32LE(4);
const totalLen = header.readUInt32LE(8);
const jsonLen = header.readUInt32LE(12);
const jsonType = header.toString('ascii', 16, 20);
console.log(`magic=${magic} version=${version} totalLen=${(totalLen/1e6).toFixed(1)}MB jsonLen=${(jsonLen/1e6).toFixed(2)}MB jsonType=${jsonType}`);

const jsonBuf = Buffer.alloc(jsonLen);
fs.readSync(fd, jsonBuf, 0, jsonLen, 20);
const json = JSON.parse(jsonBuf.toString('utf8'));
fs.closeSync(fd);

const fmt = (n) => n ? (n/1e6).toFixed(1) : '0';
console.log('nodes=', json.nodes?.length, 'meshes=', json.meshes?.length,
  'materials=', json.materials?.length, 'textures=', json.textures?.length,
  'images=', json.images?.length, 'accessors=', json.accessors?.length,
  'bufferViews=', json.bufferViews?.length, 'scenes=', json.scenes?.length);

// bufferView 总大小
let bvTotal = 0;
for (const bv of json.bufferViews || []) bvTotal += bv.byteLength || 0;
console.log('bufferViews 总大小 =', fmt(bvTotal), 'MB');

// 区分：image 数据占多少、其余(几何体等)占多少
let imgTotal = 0, imgCount = 0;
const imgMime = new Map();
for (const img of json.images || []) {
  if (img.bufferView == null) { imgMime.set('uri:' + (img.uri || 'unknown'), (imgMime.get('uri:'+(img.uri||'unknown'))||0)+1); continue; }
  imgTotal += json.bufferViews[img.bufferView]?.byteLength || 0;
  imgCount++;
  const m = img.mimeType || 'unknown';
  imgMime.set(m, (imgMime.get(m) || 0) + 1);
}
console.log('image 数据(内嵌) =', fmt(imgTotal), 'MB, 数量=', imgCount);
console.log('几何体+其余 =', fmt(bvTotal - imgTotal), 'MB');
console.log('--- image mimeType 分布 ---');
for (const [k, v] of [...imgMime.entries()].sort((a,b)=>b[1]-a[1])) console.log('  ', k, 'x', v);

// 每个 image 大小 top 20（内嵌的）
const imgSizes = (json.images || []).map((img, i) => ({
  i, name: img.name || '', mime: img.mimeType || 'uri',
  size: img.bufferView != null ? (json.bufferViews[img.bufferView]?.byteLength || 0) : 0
})).sort((a, b) => b.size - a.size);
console.log('--- 最大 20 个 image ---');
for (const s of imgSizes.slice(0, 20)) console.log('  ', s.i, s.name, s.mime, (s.size/1e6).toFixed(1) + 'MB');

// material 中用到 texture 的情况
let hasTextures = 0, totalMats = (json.materials || []).length;
for (const m of json.materials || []) {
  const keys = Object.keys(m).filter(k => k.includes('Texture') && m[k]?.index != null);
  if (keys.length) hasTextures++;
}
console.log('材质中有纹理引用的 =', hasTextures, '/', totalMats);