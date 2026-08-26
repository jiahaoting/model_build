const fs = require('fs');
const file = process.argv[2] || 'assets/models/michelle.glb';
const buf = fs.readFileSync(file);
let off = 12, jsonStr = null;
while (off + 8 <= buf.length) {
  const len = buf.readUInt32LE(off);
  const type = buf.readUInt32LE(off + 4);
  const name = String.fromCharCode(type & 0xff, (type >> 8) & 0xff, (type >> 16) & 0xff, (type >> 24) & 0xff);
  if (name === 'JSON') { jsonStr = buf.slice(off + 8, off + 8 + len).toString('utf8'); break; }
  off += 8 + len + (len % 4);
}
const gl = JSON.parse(jsonStr);
const joints = gl.skins[0].joints;
console.log('关节数量:', joints.length);
const names = joints.map(j => gl.nodes[j].name);
console.log(names.join('\n'));
// 校验 BIND 中需要的名称是否存在
const needed = ['mixamorig:Hips','mixamorig:Spine','mixamorig:Spine2','mixamorig:Neck','mixamorig:Head',
'mixamorig:LeftShoulder','mixamorig:LeftArm','mixamorig:LeftForeArm','mixamorig:LeftHand',
'mixamorig:RightShoulder','mixamorig:RightArm','mixamorig:RightForeArm','mixamorig:RightHand',
'mixamorig:LeftUpLeg','mixamorig:LeftLeg','mixamorig:LeftFoot',
'mixamorig:RightUpLeg','mixamorig:RightLeg','mixamorig:RightFoot'];
console.log('\n--- BIND 名称校验 ---');
const set = new Set(names);
for (const n of needed) console.log((set.has(n) ? 'OK  ' : 'MISSING  ') + n);