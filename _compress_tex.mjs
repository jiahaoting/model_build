// 手动压缩 opera_house.glb 的纹理：强制 sRGB + 降采样 2048 + WebP，绕过 sharp 的 colourspace 崩溃
// 用法：node --max-old-space-size=8192 _compress_tex.mjs
import { NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';

const IN = 'assets/models/opera_house.glb';
const OUT = 'assets/models/opera_house_tex.glb';

console.log('reading', IN, '...');
const io = new NodeIO();
const doc = await io.read(IN);
const root = doc.getRoot();
const textures = root.listTextures();
console.log('textures=', textures.length);

let ok = 0, fail = 0, skipped = 0;
let sizeBefore = 0, sizeAfter = 0;
const failures = [];

for (let i = 0; i < textures.length; i++) {
  const tex = textures[i];
  const img = tex.getImage();
  if (!img) { skipped++; continue; }
  sizeBefore += img.byteLength;
  const mime = tex.getMimeType();
  if (mime !== 'image/png' && mime !== 'image/jpeg') { skipped++; continue; }
  const name = tex.getName() || tex.getURI() || `tex${i}`;
  try {
    const out = await sharp(img, { failOn: 'none', animated: false, limitInputPixels: false })
      .toColourspace('srgb')
      .rotate()
      .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 88, effort: 4 })
      .toBuffer();
    tex.setImage(out);
    tex.setMimeType('image/webp');
    sizeAfter += out.byteLength;
    ok++;
    if (i % 20 === 0) console.log(`  ${i}/${textures.length} ...`);
  } catch (e) {
    fail++;
    failures.push(name + ': ' + e.message);
    console.error('  FAIL', name, e.message);
  }
}

console.log(`\n== 纹理压缩完成 ==`);
console.log(`成功=${ok} 失败=${fail} 跳过=${skipped}`);
console.log(`纹理体积 ${(sizeBefore/1e6).toFixed(0)}MB -> ${(sizeAfter/1e6).toFixed(0)}MB`);
if (failures.length) console.log('失败明细:', failures.join('\n  '));

console.log('writing', OUT, '...');
await io.write(OUT, doc);
console.log('done');