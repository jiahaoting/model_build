import fs from 'fs';
const buf = fs.readFileSync('assets/models/opera_house_opt.glb');
let off = 12;
const clen = buf.readUInt32LE(off); off += 4; off += 4;
const json = JSON.parse(buf.toString('utf8', off, off + clen));
const { nodes = [], meshes = [], accessors = [] } = json;

for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.mesh == null) continue;
    const meshName = meshes[n.mesh]?.name || '';
    if (!/SceneCurtain/i.test(meshName) && !/SceneCurtain/i.test(n.name || '')) continue;
    console.log(`\n=== node#${i} ${n.name} [${meshName}] ===`);
    console.log('  translation=', n.translation);
    console.log('  rotation=', n.rotation);
    console.log('  scale=', n.scale);
    console.log('  has matrix=', !!n.matrix);
    for (const prim of meshes[n.mesh].primitives) {
        const acc = accessors[prim.attributes.POSITION];
        console.log('  POSITION accessor min=', acc && acc.min, ' max=', acc && acc.max);
    }
}