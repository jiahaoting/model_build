import fs from 'fs';
const buf = fs.readFileSync('assets/models/opera_house_opt.glb');
let off = 12;
const clen = buf.readUInt32LE(off); off += 4; off += 4;
const json = JSON.parse(buf.toString('utf8', off, off + clen));
const materials = json.materials || [];

// 找出所有使用 texCoord !== undefined 且 !== 0 的纹理引用（即 TEXCOORD_1 / UV1 通道）
const hit = [];
for (let i = 0; i < materials.length; i++) {
    const m = materials[i];
    const refs = [];
    const p = m.pbrMetallicRoughness || {};
    if (p.baseColorTexture && p.baseColorTexture.texCoord) refs.push('baseColor@' + p.baseColorTexture.texCoord);
    if (p.metallicRoughnessTexture && p.metallicRoughnessTexture.texCoord) refs.push('metalRough@' + p.metallicRoughnessTexture.texCoord);
    if (m.normalTexture && m.normalTexture.texCoord) refs.push('normal@' + m.normalTexture.texCoord);
    if (m.occlusionTexture && m.occlusionTexture.texCoord) refs.push('ao@' + m.occlusionTexture.texCoord);
    if (m.emissiveTexture && m.emissiveTexture.texCoord) refs.push('emissive@' + m.emissiveTexture.texCoord);
    if (refs.length) hit.push(`#${i} "${m.name}"  ${refs.join(' ')}`);
}
console.log('== 使用 texCoord!=0（UV1 通道）的纹理引用 ==');
console.log(hit.length ? hit.join('\n') : '(无)');