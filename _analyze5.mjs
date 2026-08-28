// 直接解析 GLB JSON chunk：输出节点层级（名称/父子/mesh 标记）
import fs from 'fs';
const buf = fs.readFileSync('assets/models/eastman_theater.glb');
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
const nodes = json.nodes || [];
const childrenOf = new Map();
nodes.forEach((n, i) => (n.children || []).forEach(c => childrenOf.set(c, i)));
function pathOf(i) {
    const parts = [];
    let cur = i;
    while (cur !== undefined) { parts.unshift(nodes[cur].name || `#${cur}`); cur = childrenOf.get(cur); }
    return parts.join(' / ');
}
// 目标：名字含 seat_arm / Door Handle / Component#10 / Deco Sim 的节点及其 mesh 后代
const PATS = [/seat_arm stand\.?0*1$/i, /Door Handle/i, /Component#10/i, /Deco Sim 22/i];
let shown = 0;
for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!PATS.some(p => p.test(n.name || ''))) continue;
    const hasMesh = n.mesh !== undefined;
    console.log(`node[${i}] "${n.name}" mesh=${hasMesh ? n.mesh : '-'} children=${(n.children||[]).length}`);
    if (shown++ > 8) break;
}
// 打印第一个 seat_arm stand 的完整子树路径与 mesh 节点名
for (let i = 0; i < nodes.length; i++) {
    if (/seat_arm stand/i.test(nodes[i].name || '')) {
        console.log('\n样例路径:', pathOf(i));
        // 找其 mesh 后代
        const stack = [i];
        while (stack.length) {
            const c = stack.pop();
            const nn = nodes[c];
            if (nn.mesh !== undefined) console.log('  mesh后代:', `"${nn.name}"`, 'mesh=', nn.mesh);
            (nn.children || []).forEach(x => stack.push(x));
        }
        break;
    }
}
// 统计：有多少 mesh 节点的祖先名含 seat_arm stand
const parentOf = childrenOf;
function ancMatch(i, pat) {
    let cur = i;
    while (cur !== undefined) { if (pat.test(nodes[cur].name || '')) return true; cur = parentOf.get(cur); }
    return false;
}
let armMesh = 0, doorPanelMesh = 0, handleMesh = 0, audMesh = 0;
for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].mesh === undefined) continue;
    if (ancMatch(i, /seat_arm stand/i)) armMesh++;
    if (ancMatch(i, /Component#10/i)) doorPanelMesh++;
    if (ancMatch(i, /Door Handle/i)) handleMesh++;
    if (ancMatch(i, /Deco Sim|Guest Chat|Guest Deco|s4studio_mesh|Shape69/i)) audMesh++;
}
console.log(`\nmesh节点统计（祖先匹配）: 扶手=${armMesh} 门板=${doorPanelMesh} 把手=${handleMesh} 人偶=${audMesh}`);
console.log('总节点数:', nodes.length, ' 含mesh节点:', nodes.filter(n=>n.mesh!==undefined).length);
