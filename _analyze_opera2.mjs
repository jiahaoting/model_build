// 定位 opera_house_opt.glb 中所有关键物件：输出节点 world position（不依赖 accessor min/max）
import fs from 'fs';

const file = 'assets/models/opera_house_opt.glb';
const fd = fs.openSync(file, 'r');
const header = Buffer.alloc(20);
fs.readSync(fd, header, 0, 20, 0);
const jsonLen = header.readUInt32LE(12);
const jsonBuf = Buffer.alloc(jsonLen);
fs.readSync(fd, jsonBuf, 0, jsonLen, 20);
const json = JSON.parse(jsonBuf.toString('utf8'));
fs.closeSync(fd);
const { nodes = [], meshes = [], scenes = [] } = json;

function compose(t, r, s) {
  const [x, y, z, w] = r;
  const x2 = x+x, y2 = y+y, z2 = z+z;
  const xx = x*x2, xy = x*y2, xz = x*z2;
  const yy = y*y2, yz = y*z2, zz = z*z2;
  const wx = w*x2, wy = w*y2, wz = w*z2;
  const [sx, sy, sz] = s;
  return [(1-(yy+zz))*sx,(xy+wz)*sx,(xz-wy)*sx,0,(xy-wz)*sy,(1-(xx+zz))*sy,(yz-wx)*sy,0,(xz+wy)*sz,(yz-wx)*sz,(1-(xx+yy))*sz,0,t[0],t[1],t[2],1];
}
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c=0;c<4;c++) for(let r=0;r<4;r++) for(let k=0;k<4;k++) o[c*4+r]+=a[k*4+r]*b[c*4+k];
  return o;
}
function worldPos(m) { return [m[12], m[13], m[14]]; }
const IDENT = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];

const hits = [];
function walk(idx, pm) {
  const n = nodes[idx];
  const m = n.matrix ? mul(pm, n.matrix) : mul(pm, compose(n.translation||[0,0,0], n.rotation||[0,0,0,1], n.scale||[1,1,1]));
  if (n.mesh != null) {
    hits.push({ name: n.name || '(unnamed)', mesh: meshes[n.mesh]?.name || '', pos: worldPos(m) });
  }
  for (const ch of n.children || []) walk(ch, m);
}
for (const r of scenes[0]?.nodes || []) walk(r, IDENT);

function fmt(p) { return p.map(v => +v.toFixed(2)).join(','); }

// 关键分类
const categories = [
  ['钢琴', /piano/i],
  ['舞台', /stage/i],
  ['座椅/沙发', /chair|armchair|seat/i],
  ['吊灯', /chandelier/i],
  ['聚光灯', /spotlight/i],
  ['幕布', /curtain/i],
  ['地板', /floor/i],
  ['天花板', /ceiling/i],
  ['门', /door/i],
  ['音箱', /subwoofer|speaker/i],
  ['麦克风/谱架', /micro|note|stand/i],
  ['灯', /lamp/i],
];
for (const [label, re] of categories) {
  const list = hits.filter(h => re.test(h.name) || re.test(h.mesh));
  if (!list.length) continue;
  console.log(`\n== ${label} (${list.length}) ==`);
  const uniq = new Map();
  for (const h of list) {
    const key = h.name + '|' + h.mesh;
    if (!uniq.has(key)) uniq.set(key, { ...h, count: 1 });
    else uniq.get(key).count++;
  }
  for (const h of [...uniq.values()]) {
    console.log(`  ${h.name} [${h.mesh}] pos=${fmt(h.pos)}${h.count > 1 ? ' x' + h.count : ''}`);
  }
}