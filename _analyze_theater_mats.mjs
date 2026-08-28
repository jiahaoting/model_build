import fs from 'fs';
const buf = fs.readFileSync('assets/models/opera_house_opt.glb');
let off = 12;
const clen = buf.readUInt32LE(off); off += 4; off += 4;
const json = JSON.parse(buf.toString('utf8', off, off + clen));
const { materials = [], textures = [], images = [], meshes = [], nodes = [] } = json;

console.log('== 材质（名字 + PBR 工作流 + 引用的纹理索引）==');
for (let i = 0; i < materials.length; i++) {
    const m = materials[i];
    const p = m.pbrMetallicRoughness || {};
    const s = m.extensions && m.extensions.KHR_materials_pbrSpecularGlossiness;
    const bt = p.baseColorTexture || (s && s.diffuseTexture);
    const nt = (s ? s.normalTexture?.index ?? s.specularGlossinessTexture?.index : undefined) ?? (p.metallicRoughnessTexture ? null : null);
    // 粗略提取
    const info = [];
    if (p.baseColorTexture) info.push(`baseColor→tex${p.baseColorTexture.index}`);
    if (p.metallicRoughnessTexture) info.push(`metalRough→tex${p.metallicRoughnessTexture.index}`);
    if (m.normalTexture) info.push(`normal→tex${m.normalTexture.index}`);
    if (m.occlusionTexture) info.push(`ao→tex${m.occlusionTexture.index}`);
    if (m.emissiveTexture) info.push(`emissive→tex${m.emissiveTexture.index}`);
    if (s) info.push(`(specGloss工作流)`);
    console.log(`#${i} "${m.name}"  ${info.join('  ')}`);
}

console.log('\n== 纹理/图片 ==');
for (let i = 0; i < images.length; i++) {
    const im = images[i];
    console.log(`image#${i} "${im.name||''}" ${im.mimeType||''}${im.uri ? ' uri=' + im.uri : ' embedded'}`);
}

// 材质 -> 被哪些 mesh 使用（按 material index 统计）
console.log('\n== 材质使用统计（材质索引 -> 引用的图元数）==');
const usage = new Map();
for (const mesh of meshes) {
    for (const prim of mesh.primitives) {
        if (prim.material != null) usage.set(prim.material, (usage.get(prim.material) || 0) + 1);
    }
}
for (const [mi, cnt] of [...usage.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`material#${mi} "${materials[mi]?.name}"  →  图元数 ${cnt}`);
}