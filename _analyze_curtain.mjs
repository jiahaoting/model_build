// 查 SM_SceneCurtain（红色大幕）的实际包围盒尺寸（用于魔法屏贴合定位）
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read('assets/models/opera_house_opt.glb');
const root = doc.getRoot();
const meshes = root.listMeshes();
for (const mesh of meshes) {
  const name = mesh.getName();
  if (!/SceneCurtain|Curtain/i.test(name || '')) continue;
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    if (!pos) continue;
    const min = pos.getMin([]);
    const max = pos.getMax([]);
    console.log(`${name} prim: min=(${min[0].toFixed(2)},${min[1].toFixed(2)},${min[2].toFixed(2)}) max=(${max[0].toFixed(2)},${max[1].toFixed(2)},${max[2].toFixed(2)}) size=(${(max[0]-min[0]).toFixed(2)},${(max[1]-min[1]).toFixed(2)},${(max[2]-min[2]).toFixed(2)})`);
  }
}