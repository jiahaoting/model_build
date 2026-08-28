// 统计 AUDIENCE_REGEX 在剧院模型中匹配的节点名分布（确认 185 个被删网格是否都是人偶）
import fs from 'fs';

const buf = fs.readFileSync('assets/models/eastman_theater.glb');
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
const { nodes = [], meshes = [] } = json;

const AUDIENCE_REGEX = /Deco[ _]Sim|Guest[ _]Chat|Guest[ _]Deco|s4studio_mesh|Shape69/i;
// GLTFLoader sanitize: 空格→_，删除 [\].:/
const sanitize = (s) => (s || '').replace(/\s/g, '_').replace(/[\[\].:\/]/g, '');

const nameCount = new Map();
let meshCount = 0;
for (const n of nodes) {
  if (n.mesh == null) continue;
  const sName = sanitize(n.name);
  if (!AUDIENCE_REGEX.test(sName)) continue;
  const prims = meshes[n.mesh].primitives.length;
  meshCount += prims;
  const base = sName.replace(/\.?\d+$/, '');
  nameCount.set(base, (nameCount.get(base) || 0) + prims);
}
console.log('匹配网格总数（含多图元）=', meshCount);
for (const [name, cnt] of [...nameCount.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(String(cnt).padStart(5), name);
}

// 同时列出"疑似人偶但未匹配"的名字（含 Sim/Man/Woman/People/Person/Human/Chat/Guest 等）
const SUSPECT = /sim|man|woman|people|person|human|chat|guest|shape|figure|body|head|hair|cloth/i;
const miss = new Map();
for (const n of nodes) {
  if (n.mesh == null) continue;
  const sName = sanitize(n.name);
  if (AUDIENCE_REGEX.test(sName)) continue;
  if (!SUSPECT.test(sName)) continue;
  const prims = meshes[n.mesh].primitives.length;
  const base = sName.replace(/\.?\d+$/, '');
  miss.set(base, (miss.get(base) || 0) + prims);
}
console.log('\n--- 疑似人偶但未匹配 ---');
for (const [name, cnt] of [...miss.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(String(cnt).padStart(5), name);
}
