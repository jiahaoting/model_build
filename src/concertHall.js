import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as CANNON from 'cannon-es';
import { FallingNotesController } from './fallingNotes.js';

// ============================================================
// 大型音乐厅 · 空间与灯光配置（配置驱动，独立于展览馆场景）
// 经典「鞋盒式」演奏厅（shoebox hall）：
// - 观众席沿 Z 轴逐渐升高（阶梯式看台）
// - 舞台位于 -Z 端，木质地面、管风琴装饰墙
// - 暖色观众席灯光 vs 舞台冷亮聚光，形成色温对比
// ============================================================
export const CONCERT = {
    hallW: 26,   // 厅宽（X）
    hallD: 38,   // 厅深（Z）: z ∈ [-19, 19]
    hallH: 15,   // 厅高（Y）

    stage: { x0: 15, x1: 21, z0: -12, z1: 12, topY: 1.7 },

    // Cinema Opera House：舞台在 +X（观众席在 -X），台面 y=1.7，钢琴置于舞台中央。
    // 钢琴「侧对观众」：键盘前缘朝 +Z（键位沿世界 X 横向排列）。rotation.y = rotY - π/2，
    // 取 rotY = 0 时模型 +X（键前缘）旋到世界 +Z，琴体（尾部）朝 -Z。
    // 演奏者就坐于键盘前方 +Z 侧（白/黑键一侧）、面向 -Z（朝琴体/琴键）。
    piano: { x: 18, z: 0, rotY: 0 },
    bench: { x: 18, z: 1.35, rotY: 0 },

    // 台口（舞台前缘）到看台的中部阶梯
    stairs: { x0: -3.5, x1: 3.5, zFloor: -4.4, zStage: -6.8 },

    // 观众席看台（梯形：前窄后宽，座位数逐排递增，并加大与舞台间距；
    // 增大排间距与排间高差，拓宽中央过道，并在每排看台内侧面新增连接过道的楼梯）
    seating: {
        rows: 10,
        rowSpacing: 2.0,     // 排与排水平间距（满足行走需求）
        frontZ: -1.5,
        riserDepth: 1.4,
        riserStep: 0.34,     // 排与排竖直高差（台阶式看台升高量）
        riserBase: 0.22,
        frontHalfW: 7.0,
        backHalfW: 11.0,
        aisleHalf: 1.6,      // 中央过道半宽（加宽，保证通行）
        seatPitch: 0.66,
        seatInset: 0.5
    },
    // 二层悬空观看台（贴后墙与侧墙，向前悬挑；台面下方仅靠墙牛腿支撑，呈悬空感）
    balcony: {
        floorY: 5.5,         // 台面高度（悬空于一层看台上方，留出后排净空）
        frontZ: 9.0,         // 前缘（向舞台方向悬挑的开放边）
        backZ: 19.0,         // 后缘贴合后墙
        halfW: 13.0,         // 侧向贴合侧墙（全宽）
        seats: 3,
        seatPitch: 0.66
    }
};

// 色温（暖色观众席 / 冷亮舞台）
const T_WARM_HOUSE = 0xffd7a3;   // 观众席暖白 ≈ 3200K
const T_PIANO      = 0xf5e2c0;   // 钢琴聚光 ≈ 3400K
const T_GOLD       = 0xffc266;   // 金色点缀

// 站立眼高（米），与第一人称玩家的眼高保持一致，用于坐下/起身落点换算
const STAND_EYE = 1.7;

// ============================================================
// 程序化木质纹理（墙板 / 地板，暖棕胡桃木）
// ============================================================
function createWoodTexture(size = 512) {
    const cCanvas = document.createElement('canvas');
    cCanvas.width = cCanvas.height = size;
    const c = cCanvas.getContext('2d');
    const grad = c.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, '#6b4a2c');
    grad.addColorStop(0.5, '#7a5634');
    grad.addColorStop(1, '#61422a');
    c.fillStyle = grad; c.fillRect(0, 0, size, size);

    // 木纹细长纹理
    for (let i = 0; i < 900; i++) {
        const y = Math.random() * size;
        const a = Math.random() * 0.12;
        c.strokeStyle = `rgba(${30 + Math.random() * 30},${18 + Math.random() * 18},${8 + Math.random() * 10},${a})`;
        c.lineWidth = 0.5 + Math.random() * 1.4;
        c.beginPath(); c.moveTo(0, y); c.lineTo(size, y + (Math.random() - 0.5) * 8); c.stroke();
    }
    // 板条接缝
    const plank = size / 6;
    for (let i = 1; i < 6; i++) {
        c.strokeStyle = 'rgba(20,10,4,0.55)'; c.lineWidth = 3;
        c.beginPath(); c.moveTo(0, i * plank); c.lineTo(size, i * plank); c.stroke();
    }
    for (let i = 0; i < 4000; i++) {
        const v = Math.random();
        c.fillStyle = `rgba(${30 + v * 40},${18 + v * 30},${8 + v * 16},${Math.random() * 0.06})`;
        c.fillRect(Math.random() * size, Math.random() * size, 2, 2);
    }
    const colorTex = new THREE.CanvasTexture(cCanvas);
    colorTex.wrapS = colorTex.wrapT = THREE.RepeatWrapping;
    colorTex.colorSpace = THREE.SRGBColorSpace;

    // 凹凸
    const bCanvas = document.createElement('canvas');
    bCanvas.width = bCanvas.height = size;
    const b = bCanvas.getContext('2d');
    b.fillStyle = '#808080'; b.fillRect(0, 0, size, size);
    for (let i = 0; i < 900; i++) {
        const y = Math.random() * size;
        b.strokeStyle = `rgba(${70 + Math.random() * 30},${70 + Math.random() * 30},${70 + Math.random() * 30},0.25)`;
        b.lineWidth = 0.5 + Math.random() * 1.4;
        b.beginPath(); b.moveTo(0, y); b.lineTo(size, y + (Math.random() - 0.5) * 8); b.stroke();
    }
    const bumpTex = new THREE.CanvasTexture(bCanvas);
    bumpTex.wrapS = bumpTex.wrapT = THREE.RepeatWrapping;
    return { colorTex, bumpTex };
}

// ============================================================
// 程序化黑色墙面纹理（哑光黑 + 细腻颗粒 + 织物细丝，深度与触感）
// ============================================================
function createBlackWallTexture(size = 512) {
    const cCanvas = document.createElement('canvas');
    cCanvas.width = cCanvas.height = size;
    const c = cCanvas.getContext('2d');
    const grad = c.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, '#0c0c0f');
    grad.addColorStop(0.5, '#131316');
    grad.addColorStop(1, '#0a0a0c');
    c.fillStyle = grad; c.fillRect(0, 0, size, size);

    // 细腻噪点（触感颗粒）
    for (let i = 0; i < 14000; i++) {
        const v = 10 + Math.random() * 22;
        c.fillStyle = `rgba(${v},${v},${v + 4},${Math.random() * 0.1})`;
        c.fillRect(Math.random() * size, Math.random() * size, 1, 1);
    }
    // 横向织物细丝
    for (let i = 0; i < size; i += 2) {
        c.fillStyle = `rgba(255,255,255,${Math.random() * 0.015})`;
        c.fillRect(0, i, size, 1);
    }
    // 深色斑块（不规则哑光层次）
    for (let i = 0; i < 500; i++) {
        const v = Math.random();
        c.fillStyle = `rgba(${5 + v * 8},${5 + v * 8},${7 + v * 10},${Math.random() * 0.07})`;
        c.fillRect(Math.random() * size, Math.random() * size, 24 + v * 36, 24 + v * 36);
    }
    const colorTex = new THREE.CanvasTexture(cCanvas);
    colorTex.wrapS = colorTex.wrapT = THREE.RepeatWrapping;
    colorTex.colorSpace = THREE.SRGBColorSpace;

    // 凹凸（颗粒与织物深浅）
    const bCanvas = document.createElement('canvas');
    bCanvas.width = bCanvas.height = size;
    const b = bCanvas.getContext('2d');
    b.fillStyle = '#808080'; b.fillRect(0, 0, size, size);
    for (let i = 0; i < 14000; i++) {
        const v = 70 + Math.random() * 60;
        b.fillStyle = `rgba(${v - 30},${v - 30},${v - 30},${Math.random() * 0.12})`;
        b.fillRect(Math.random() * size, Math.random() * size, 1, 1);
    }
    for (let i = 0; i < size; i += 2) {
        b.fillStyle = `rgba(${60 + Math.random() * 30},${60 + Math.random() * 30},${60 + Math.random() * 30},0.2)`;
        b.fillRect(0, i, size, 1);
    }
    const bumpTex = new THREE.CanvasTexture(bCanvas);
    bumpTex.wrapS = bumpTex.wrapT = THREE.RepeatWrapping;
    return { colorTex, bumpTex };
}

// ============================================================
// 程序化幕布纹理（深红丝绒，竖向褶皱明暗）
// ============================================================
function createCurtainTexture(size = 256) {
    const cCanvas = document.createElement('canvas');
    cCanvas.width = cCanvas.height = size;
    const c = cCanvas.getContext('2d');
    const grad = c.createLinearGradient(0, 0, size, 0);
    grad.addColorStop(0, '#5c161d');
    grad.addColorStop(0.5, '#8a2230');
    grad.addColorStop(1, '#5c161d');
    c.fillStyle = grad; c.fillRect(0, 0, size, size);
    // 竖向褶皱阴影条纹
    for (let x = 0; x < size; x += 3) {
        const shade = Math.sin((x / size) * Math.PI * 9) * 0.5 + 0.5;
        c.fillStyle = `rgba(${10 + shade * 26},${6 + shade * 16},${8 + shade * 22},0.55)`;
        c.fillRect(x, 0, 2, size);
    }
    // 织物颗粒
    for (let i = 0; i < 20000; i++) {
        const v = Math.random();
        c.fillStyle = `rgba(${130 + v * 40},${44 + v * 16},${46 + v * 18},${Math.random() * 0.05})`;
        c.fillRect(Math.random() * size, Math.random() * size, 1, 1);
    }
    const tex = new THREE.CanvasTexture(cCanvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

// ============================================================
// 程序化巴洛克金饰浮雕纹理（gilded rococo relief）
// 以卷草莨苕纹 + 涡卷 + 莨苕叶层层叠加，叠加高光与阴影制造鎏金浮雕立体感。
// 输出 color / roughness / bump 三张图，供包厢立面、拱框、穹顶线脚使用。
// ============================================================
function createGoldOrnamentTexture(size = 512) {
    const cCanvas = document.createElement('canvas');
    cCanvas.width = cCanvas.height = size;
    const c = cCanvas.getContext('2d');

    // 底色：暖金渐变（中心略亮，模拟受光）
    const grad = c.createRadialGradient(size/2, size/2, size*0.1, size/2, size/2, size*0.75);
    grad.addColorStop(0, '#caa64f');
    grad.addColorStop(0.5, '#a9813a');
    grad.addColorStop(1, '#7d5a26');
    c.fillStyle = grad; c.fillRect(0, 0, size, size);

    // 工具：画一枚莨苕涡卷（螺旋 + 叶尖），cx/cy 中心、r 半径、rot 朝向
    function acanthus(cx, cy, r, rot, tone) {
        c.save(); c.translate(cx, cy); c.rotate(rot);
        // 螺旋卷须
        c.strokeStyle = `rgba(${tone},${tone*0.72},${tone*0.32},0.9)`;
        c.lineWidth = r * 0.16; c.lineCap = 'round';
        c.beginPath();
        for (let a = 0; a < Math.PI * 2.6; a += 0.12) {
            const rr = r * (1 - a / (Math.PI * 3.2));
            const px = Math.cos(a) * rr, py = Math.sin(a) * rr * 0.8;
            if (a === 0) c.moveTo(px, py); else c.lineTo(px, py);
        }
        c.stroke();
        // 卷心亮核
        c.fillStyle = `rgba(255,236,180,0.85)`;
        c.beginPath(); c.arc(0, 0, r * 0.16, 0, Math.PI * 2); c.fill();
        // 三片叶尖
        for (let k = -1; k <= 1; k++) {
            const la = k * 0.5;
            c.save(); c.rotate(la);
            c.fillStyle = `rgba(${tone*1.05},${tone*0.78},${tone*0.4},0.8)`;
            c.beginPath();
            c.ellipse(r * 0.85, 0, r * 0.5, r * 0.2, 0, 0, Math.PI * 2);
            c.fill();
            c.restore();
        }
        c.restore();
    }

    // 沿边一圈主纹样（涡卷 + 叶）镜像排布
    const margin = size * 0.12;
    const half = size / 2;
    for (let i = 0; i < 8; i++) {
        const t = i / 8;
        const x = margin + (size - margin * 2) * t;
        const rot = (i % 2 ? -1 : 1) * 0.5;
        acanthus(x, margin, size * 0.05, rot, 235);
        acanthus(x, size - margin, size * 0.05, Math.PI - rot, 235);
        acanthus(margin, x, size * 0.05, -Math.PI/2 + rot, 235);
        acanthus(size - margin, x, size * 0.05, Math.PI/2 - rot, 235);
    }
    // 四角大涡卷
    for (const [qx, qy, r0] of [[margin, margin, 0], [size-margin, margin, Math.PI/2],
                                 [size-margin, size-margin, Math.PI], [margin, size-margin, -Math.PI/2]]) {
        acanthus(qx, qy, size * 0.085, r0, 250);
    }
    // 中心团花
    acanthus(half, half, size * 0.11, 0, 255);
    for (let k = 0; k < 6; k++) acanthus(half, half, size * 0.07, k * Math.PI / 3, 240);

    // 细颗粒金箔噪点 + 高光闪点
    for (let i = 0; i < 9000; i++) {
        const v = Math.random();
        c.fillStyle = `rgba(${200+v*55},${160+v*70},${70+v*60},${Math.random()*0.08})`;
        c.fillRect(Math.random()*size, Math.random()*size, 1.5, 1.5);
    }
    for (let i = 0; i < 500; i++) {
        c.fillStyle = `rgba(255,246,214,${0.25+Math.random()*0.5})`;
        c.fillRect(Math.random()*size, Math.random()*size, 1, 1);
    }
    const colorTex = new THREE.CanvasTexture(cCanvas);
    colorTex.wrapS = colorTex.wrapT = THREE.RepeatWrapping;
    colorTex.colorSpace = THREE.SRGBColorSpace;

    // roughness：浮雕凸起处更亮（金属高光），凹处更哑
    const rCanvas = document.createElement('canvas');
    rCanvas.width = rCanvas.height = size;
    const r = rCanvas.getContext('2d');
    r.drawImage(cCanvas, 0, 0);
    r.globalCompositeOperation = 'saturation';
    r.fillStyle = '#4a4a4a'; r.fillRect(0, 0, size, size);
    const roughTex = new THREE.CanvasTexture(rCanvas);
    roughTex.wrapS = roughTex.wrapT = THREE.RepeatWrapping;

    // bump：复用明度作为高度
    const bCanvas = document.createElement('canvas');
    bCanvas.width = bCanvas.height = size;
    const b = bCanvas.getContext('2d');
    b.drawImage(cCanvas, 0, 0);
    b.globalCompositeOperation = 'luminosity';
    b.fillStyle = '#808080'; b.fillRect(0, 0, size, size);
    const bumpTex = new THREE.CanvasTexture(bCanvas);
    bumpTex.wrapS = bumpTex.wrapT = THREE.RepeatWrapping;
    return { colorTex, roughTex, bumpTex };
}

// ============================================================
// 程序化大理石纹理（暖米色卡拉拉，含柔和灰金脉络）——墙裙 / 柱身 / 台阶
// ============================================================
function createMarbleTexture(size = 512) {
    const cCanvas = document.createElement('canvas');
    cCanvas.width = cCanvas.height = size;
    const c = cCanvas.getContext('2d');
    const grad = c.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, '#e9ddc6');
    grad.addColorStop(0.5, '#f2e9d6');
    grad.addColorStop(1, '#e2d3b8');
    c.fillStyle = grad; c.fillRect(0, 0, size, size);

    // 分形脉络：多条蜿蜒半透明灰金线
    for (let v = 0; v < 26; v++) {
        const gold = Math.random() < 0.3;
        c.strokeStyle = gold
            ? `rgba(${150+Math.random()*40},${110+Math.random()*30},${50+Math.random()*20},${0.10+Math.random()*0.16})`
            : `rgba(${120+Math.random()*30},${112+Math.random()*26},${100+Math.random()*22},${0.08+Math.random()*0.14})`;
        c.lineWidth = 0.6 + Math.random() * 2.2;
        c.beginPath();
        let x = Math.random() * size, y = Math.random() * size;
        c.moveTo(x, y);
        let ang = Math.random() * Math.PI * 2;
        for (let s = 0; s < 40; s++) {
            ang += (Math.random() - 0.5) * 0.9;
            x += Math.cos(ang) * (6 + Math.random() * 10);
            y += Math.sin(ang) * (6 + Math.random() * 10);
            c.lineTo(x, y);
        }
        c.stroke();
    }
    // 细腻晶体颗粒
    for (let i = 0; i < 12000; i++) {
        const v = 210 + Math.random() * 45;
        c.fillStyle = `rgba(${v},${v-6},${v-18},${Math.random()*0.05})`;
        c.fillRect(Math.random()*size, Math.random()*size, 1, 1);
    }
    const colorTex = new THREE.CanvasTexture(cCanvas);
    colorTex.wrapS = colorTex.wrapT = THREE.RepeatWrapping;
    colorTex.colorSpace = THREE.SRGBColorSpace;

    const bCanvas = document.createElement('canvas');
    bCanvas.width = bCanvas.height = size;
    const b = bCanvas.getContext('2d');
    b.drawImage(cCanvas, 0, 0);
    b.globalCompositeOperation = 'luminosity';
    b.fillStyle = '#8a8a8a'; b.fillRect(0, 0, size, size);
    const bumpTex = new THREE.CanvasTexture(bCanvas);
    bumpTex.wrapS = bumpTex.wrapT = THREE.RepeatWrapping;
    return { colorTex, bumpTex };
}

// ============================================================
// 世界构建
// ============================================================
export function createConcertWorld(app) {
    const { scene } = app;
    const colliders = app.colliders || (app.colliders = []);
    const H = CONCERT.hallH;
    const HW = CONCERT.hallW / 2;    // 13
    const HD = CONCERT.hallD / 2;    // 19

    app.dustSystems = app.dustSystems || [];
    app.pianoKeys = app.pianoKeys || [];   // { midi, white, mesh, restY, pressY, down }

    // ============================================================
    // 物理引擎（cannon-es）：为可交互物体建立真实碰撞体积，并提供指尖接触检测与按压反馈
    // ============================================================
    const physWorld = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
    physWorld.broadphase = new CANNON.SAPBroadphase(physWorld);
    physWorld.allowSleep = true;
    const physFingers = [];   // 10 个指尖传感器（kinematic 球）
    const physKeyBodies = []; // 88 键逐键 static 碰撞体（精确接触检测）
    let physReady = false;

    function addStaticBox(obj, name) {
        if (!obj) return null;
        const box = new THREE.Box3().setFromObject(obj);
        if (box.isEmpty()) return null;
        const c = box.getCenter(new THREE.Vector3());
        const s = box.getSize(new THREE.Vector3());
        const body = new CANNON.Body({
            mass: 0,
            type: CANNON.Body.STATIC,
            shape: new CANNON.Box(new CANNON.Vec3(s.x / 2, s.y / 2, s.z / 2)),
            position: new CANNON.Vec3(c.x, c.y, c.z)
        });
        body.name = name;
        physWorld.addBody(body);
        return body;
    }

    function buildPhysics() {
        // 钢琴体 / 踏板为 static 碰撞体积。世界 AABB 已含 GLB 缩放与旋转，轴对齐包围碰撞体即为真实阻挡范围。
        scene.updateMatrixWorld(true);
        addStaticBox(app.piano, 'pianoBody');
        addStaticBox(app.sustainPedal && app.sustainPedal.pedal, 'sustainPedal');

        // 88 键逐键 static 碰撞体：贴合每个琴键的独立世界包围盒，实现指尖与「具体琴键」的精准接触检测。
        // 相比整体键盘单一大包围盒，可区分触碰的是哪一根键、给出对应键的按压反馈。
        const tmpBox = new THREE.Box3();
        const tmpC = new THREE.Vector3();
        const tmpS = new THREE.Vector3();
        for (const key of app.pianoKeys) {
            const mesh = key.mesh;
            if (!mesh) continue;
            tmpBox.setFromObject(mesh);
            if (tmpBox.isEmpty()) continue;
            tmpBox.getCenter(tmpC); tmpBox.getSize(tmpS);
            const body = new CANNON.Body({
                mass: 0, type: CANNON.Body.STATIC,
                shape: new CANNON.Box(new CANNON.Vec3(tmpS.x / 2, tmpS.y / 2, tmpS.z / 2)),
                position: new CANNON.Vec3(tmpC.x, tmpC.y, tmpC.z)
            });
            body.name = 'key' + key.midi;
            body._key = key;                // 反向引用，供接触检测直接定位到对应琴键
            physWorld.addBody(body);
            physKeyBodies.push(body);
            key.physicsTouch = 0;           // 该键的指尖接触反馈计时（秒）
        }

        // 10 根指尖传感器：kinematic 小球，位置由演奏者每帧同步，用于真实接触检测
        for (let i = 0; i < 10; i++) {
            const finger = new CANNON.Body({
                mass: 0,
                type: CANNON.Body.KINEMATIC,
                shape: new CANNON.Sphere(0.012),
                position: new CANNON.Vec3(0, -100, 0)
            });
            finger.name = 'finger' + i;
            physWorld.addBody(finger);
            physFingers.push(finger);
        }
        physReady = true;
    }

    function syncPhysics(dt) {
        if (!physReady) {
            // 懒初始化：延后到首次渲染帧，此时场景矩阵已就绪，可准确量取各物体世界包围盒。
            buildPhysics();
        }
        // 指尖传感器同步（演奏者上一帧的指尖世界坐标，滞后 1 帧忽略不计）
        const fw = app.fingertipsWorld;
        if (fw) {
            for (let i = 0; i < 10 && i < fw.length; i++) {
                const p = fw[i];
                if (p) physFingers[i].position.set(p.x, p.y, p.z);
            }
        }
        // 逐键接触反馈计时衰减
        for (const key of app.pianoKeys) {
            if (key.physicsTouch > 0) key.physicsTouch -= dt;
        }
        physWorld.step(1 / 60, dt, 3);
        // 真实接触检测：指尖传感器与「具体琴键」碰撞体接触 → 该键触发按压反馈
        for (const c of physWorld.contacts) {
            const a = c.bi, b = c.bj;
            const aIsKey = a.name && a.name.indexOf('key') === 0;
            const bIsKey = b.name && b.name.indexOf('key') === 0;
            const aIsFinger = a.name && a.name.indexOf('finger') === 0;
            const bIsFinger = b.name && b.name.indexOf('finger') === 0;
            if ((aIsKey && bIsFinger) || (bIsKey && aIsFinger)) {
                const keyBody = aIsKey ? a : b;
                if (keyBody._key) keyBody._key.physicsTouch = 0.06;
            }
        }
    }

    // —— 碰撞 ——
    // minY/maxY：碰撞体竖直范围（玩家按脚下高度过滤，支持多层楼面互不干扰）
    function addBoxCollider(id, minX, maxX, minZ, maxZ, minY = 0, maxY = H) {
        const c = { id, enabled: true, box: new THREE.Box3(
            new THREE.Vector3(minX, minY, minZ), new THREE.Vector3(maxX, maxY, maxZ)
        ) };
        colliders.push(c);
        return c;
    }

    // —— 地面高度（Opera House：观众席 -X 缓坡，舞台 +X 平层）——
    // 观众席地板由 FloorTile 实测：后部 x≈-17 y≈1.95，前部 x≈11 y≈0.55，缓坡斜率 ≈ -0.058。
    const STEP_UP = 0.55;   // 可迈上的最大高差
    function groundY(x, z, refY = 0) {
        const S = CONCERT.stage;
        let best = -Infinity;
        const consider = (h) => { if (h <= refY + STEP_UP && h > best) best = h; };
        // 舞台（x ∈ [15,21]，台面 y=1.7）
        if (x >= S.x0 && x <= S.x1 && z >= S.z0 && z <= S.z1) consider(S.topY);
        // 观众席缓坡（x ∈ [-24,15)，y 从后部 1.95 降到台口 0.55）
        if (x >= -24 && x < S.x0 && z >= -16 && z <= 16) {
            consider(Math.max(0.55, Math.min(1.95, 1.21 - 0.058 * x)));
        }
        return best === -Infinity ? refY : best;
    }

    // ============================================================
    // 材质
    // ============================================================
    const { colorTex: woodColor, bumpTex: woodBump } = createWoodTexture();
    woodColor.anisotropy = app.maxAnisotropy || 4;
    woodBump.anisotropy = app.maxAnisotropy || 4;

    const woodFloorMat = new THREE.MeshStandardMaterial({
        map: woodColor, bumpMap: woodBump, bumpScale: 0.02,
        roughness: 0.4, metalness: 0.05, envMapIntensity: 0.7
    });

    // 高质感黑色墙面 / 深色天花板 / 幕布
    const { colorTex: blackColor, bumpTex: blackBump } = createBlackWallTexture();
    blackColor.anisotropy = app.maxAnisotropy || 4;
    blackBump.anisotropy = app.maxAnisotropy || 4;
    const blackWallMat = new THREE.MeshStandardMaterial({
        map: blackColor, bumpMap: blackBump, bumpScale: 0.035,
        roughness: 0.82, metalness: 0.03, envMapIntensity: 0.35
    });
    blackWallMat.map.repeat.set(2, 2); blackWallMat.map.needsUpdate = true;
    blackWallMat.bumpMap.repeat.set(2, 2); blackWallMat.bumpMap.needsUpdate = true;

    const darkCeilMat = new THREE.MeshStandardMaterial({
        color: 0x0c0c10, roughness: 0.95, metalness: 0.02, envMapIntensity: 0.2
    });
    const curtainTex = createCurtainTexture();
    curtainTex.anisotropy = app.maxAnisotropy || 4;
    const curtainMat = new THREE.MeshStandardMaterial({
        map: curtainTex, roughness: 0.78, metalness: 0.0,
        envMapIntensity: 0.3, side: THREE.DoubleSide
    });

    // —— 巴洛克鎏金浮雕材质（包厢立面 / 拱框 / 穹顶线脚） ——
    const { colorTex: ornColor, roughTex: ornRough, bumpTex: ornBump } = createGoldOrnamentTexture();
    ornColor.anisotropy = app.maxAnisotropy || 4;
    ornBump.anisotropy = app.maxAnisotropy || 4;
    const goldOrnMat = new THREE.MeshStandardMaterial({
        map: ornColor, roughnessMap: ornRough, bumpMap: ornBump, bumpScale: 0.6,
        roughness: 1.0, metalness: 0.85, envMapIntensity: 1.5,
        emissive: 0x1a1204, emissiveIntensity: 0.12
    });

    // —— 暖米色大理石（墙裙 / 柱身 / 台阶） ——
    const { colorTex: marColor, bumpTex: marBump } = createMarbleTexture();
    marColor.anisotropy = app.maxAnisotropy || 4;
    const marbleMat = new THREE.MeshStandardMaterial({
        map: marColor, bumpMap: marBump, bumpScale: 0.02,
        roughness: 0.34, metalness: 0.06, envMapIntensity: 0.9
    });

    const trimMat = new THREE.MeshStandardMaterial({
        color: 0x2a1a10, roughness: 0.5, metalness: 0.2
    });
    const velvetMat = new THREE.MeshStandardMaterial({
        color: 0x7c1f24, roughness: 0.92, metalness: 0.0, envMapIntensity: 0.2
    });
    const velvetDarkMat = new THREE.MeshStandardMaterial({
        color: 0x5a1419, roughness: 0.95, metalness: 0.0
    });
    const goldMat = new THREE.MeshStandardMaterial({
        color: 0xd4b06a, roughness: 0.32, metalness: 0.85, envMapIntensity: 1.35,
        emissive: 0x140e06, emissiveIntensity: 0.18
    });
    const darkTrimMat = new THREE.MeshStandardMaterial({
        color: 0x120c08, roughness: 0.55, metalness: 0.3
    });

    // ============================================================
    // 厅体（地板 / 天花板 / 四面墙）
    // ============================================================
    function buildShell() {
        // 地板
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(CONCERT.hallW, CONCERT.hallD), woodFloorMat);
        floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, 0);
        floor.receiveShadow = true; scene.add(floor);

        // —— 天花板：深色基底 + 鎏金藻井网格 + 环形穹顶 + 周边线脚 ——
        const ceil = new THREE.Mesh(new THREE.PlaneGeometry(CONCERT.hallW, CONCERT.hallD), darkCeilMat);
        ceil.rotation.x = Math.PI / 2; ceil.position.set(0, H, 0);
        ceil.receiveShadow = true; scene.add(ceil);

        // 鎏金藻井（coffered）：纵横金色井字格，格心点缀团花方块
        const coffMat = goldOrnMat;
        const beamY = H - 0.05;
        for (let bx = -HW + 2; bx <= HW - 2; bx += 3.25) {
            const beam = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.10, CONCERT.hallD), goldMat);
            beam.position.set(bx, beamY, 0); scene.add(beam);
        }
        for (let bz = -HD + 2; bz <= HD - 2; bz += 3.25) {
            const beam = new THREE.Mesh(new THREE.BoxGeometry(CONCERT.hallW, 0.10, 0.20), goldMat);
            beam.position.set(0, beamY, bz); scene.add(beam);
        }
        // 藻井格心团花方块（间隔布置，避免过密）
        for (let gx = -HW + 3.6; gx <= HW - 3; gx += 3.25) {
            for (let gz = -HD + 3.6; gz <= HD - 3; gz += 3.25) {
                const rose = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.5), coffMat);
                rose.position.set(gx, beamY - 0.02, gz); scene.add(rose);
            }
        }

        // 周边鎏金线脚（檐口）：四面各一条，金色压边
        const corniceH = 0.42;
        for (const [w, d, px, pz, ry] of [
            [CONCERT.hallW, 0, 0, -HD + 0.05, 0],
            [CONCERT.hallW, 0, 0, HD - 0.05, 0],
            [0, CONCERT.hallD, -HW + 0.05, 0, 0],
            [0, CONCERT.hallD, HW - 0.05, 0, 0]
        ]) {
            const cor = new THREE.Mesh(new THREE.BoxGeometry(w || 0.16, corniceH, d || 0.16), goldOrnMat);
            cor.position.set(px, H - corniceH / 2, pz); cor.rotation.y = ry; scene.add(cor);
        }

        // 环形穹顶采光口（厅中央上方，叠层金环 + 内凹发光穹面）
        const domeRings = [
            { r: 6.4, y: H - 0.06, t: 0.16 },
            { r: 5.2, y: H - 0.10, t: 0.14 },
            { r: 4.0, y: H - 0.16, t: 0.12 },
            { r: 2.8, y: H - 0.24, t: 0.10 }
        ];
        for (const dr of domeRings) {
            const ring = new THREE.Mesh(new THREE.TorusGeometry(dr.r, dr.t, 10, 72), goldOrnMat);
            ring.rotation.x = Math.PI / 2; ring.position.set(0, dr.y, 0); scene.add(ring);
        }
        // 内凹穹面（发光暖金，营造天窗透光感，参考图中穹顶暖光）
        const domeGlow = new THREE.Mesh(
            new THREE.SphereGeometry(3.2, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
            new THREE.MeshStandardMaterial({ color: 0xf7e7bf, emissive: 0xffe6ae, emissiveIntensity: 0.9, roughness: 0.6, metalness: 0.0, side: THREE.BackSide })
        );
        domeGlow.position.set(0, H - 0.1, 0); scene.add(domeGlow);

        // 后墙（舞台后）
        const back = new THREE.Mesh(new THREE.PlaneGeometry(CONCERT.hallW, H), blackWallMat);
        back.position.set(0, H / 2, -HD); back.receiveShadow = true; scene.add(back);
        // 前墙（观众席后）
        const front = new THREE.Mesh(new THREE.PlaneGeometry(CONCERT.hallW, H), blackWallMat);
        front.position.set(0, H / 2, HD); front.rotation.y = Math.PI; front.receiveShadow = true; scene.add(front);
        // 左右墙：黑色纹理墙面 + 大理石墙裙 + 科林斯壁柱 + 拱形壁龛 + 鎏金饰线
        for (const side of [-1, 1]) {
            const faceRot = side > 0 ? -Math.PI / 2 : Math.PI / 2;
            const inward = -side;              // 指向厅内的 X 方向
            const wallX = side * HW;

            const lower = new THREE.Mesh(new THREE.PlaneGeometry(CONCERT.hallD, H * 0.5), blackWallMat);
            lower.position.set(wallX, H * 0.25, 0);
            lower.rotation.y = faceRot; lower.receiveShadow = true; scene.add(lower);
            const upper = new THREE.Mesh(new THREE.PlaneGeometry(CONCERT.hallD, H * 0.5), blackWallMat);
            upper.position.set(wallX, H * 0.75, 0);
            upper.rotation.y = faceRot; upper.receiveShadow = true; scene.add(upper);

            // —— 大理石墙裙（底部 1.1m，向厅内凸出，顶部鎏金压线） ——
            const wainH = 1.1, wainT = 0.08;
            const wain = new THREE.Mesh(new THREE.BoxGeometry(wainT, wainH, CONCERT.hallD), marbleMat);
            wain.position.set(wallX + inward * wainT / 2, wainH / 2, 0); wain.receiveShadow = true; scene.add(wain);
            const wainCap = new THREE.Mesh(new THREE.BoxGeometry(wainT + 0.04, 0.06, CONCERT.hallD), goldMat);
            wainCap.position.set(wallX + inward * (wainT / 2), wainH + 0.03, 0); scene.add(wainCap);

            // —— 科林斯壁柱（沿墙分布，柱础+柱身+鎏金柱头，撑起上檐） ——
            const colZ = [-15, -10.5, -6, -1.5, 3, 7.5, 12, 16.5];
            for (const cz of colZ) {
                buildPilaster(wallX, cz, side);
            }

            // —— 拱形壁龛（壁柱之间，内凹 + 鎏金拱框 + 壁灯位） ——
            for (let k = 0; k < colZ.length - 1; k++) {
                const nz = (colZ[k] + colZ[k + 1]) / 2;
                buildNiche(wallX, nz, side);
            }

            // 楼层交界处鎏金饰线
            const rail = new THREE.Mesh(new THREE.BoxGeometry(CONCERT.hallD, 0.10, 0.10), goldMat);
            rail.position.set(wallX, H * 0.5, 0); scene.add(rail);
        }

        // 周界碰撞
        addBoxCollider('back', -HW, HW, -HD - 0.4, -HD + 0.4);
        addBoxCollider('front', -HW, HW, HD - 0.4, HD + 0.4);
        addBoxCollider('left', -HW - 0.4, -HW + 0.4, -HD, HD);
        addBoxCollider('right', HW - 0.4, HW + 0.4, -HD, HD);
    }

    // —— 科林斯壁柱：大理石柱身 + 鎏金莨苕柱头 + 柱础，贴墙凸出 ——
    function buildPilaster(wallX, z, side) {
        const inward = -side;
        const g = new THREE.Group();
        const colH = H - 1.1;                 // 自墙裙顶至檐口
        const colR = 0.20;

        // 柱础（多级方座）
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.18, 0.44), marbleMat);
        base.position.y = 0.09; g.add(base);
        const base2 = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.36), goldMat);
        base2.position.y = 0.24; g.add(base2);

        // 柱身（大理石，略带收分）
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(colR * 0.86, colR, colH - 0.9, 18), marbleMat);
        shaft.position.y = 1.1 + (colH - 0.9) / 2; shaft.castShadow = true; g.add(shaft);
        // 柱身鎏金凹槽线（竖向装饰）
        for (let f = 0; f < 8; f++) {
            const a = (f / 8) * Math.PI * 2;
            const flute = new THREE.Mesh(new THREE.BoxGeometry(0.02, colH - 1.0, 0.02), goldMat);
            flute.position.set(Math.cos(a) * colR * 0.9, 1.1 + (colH - 0.9) / 2, Math.sin(a) * colR * 0.9);
            g.add(flute);
        }

        // 柱颈环
        const neck = new THREE.Mesh(new THREE.TorusGeometry(colR * 0.92, 0.04, 8, 24), goldMat);
        neck.rotation.x = Math.PI / 2; neck.position.y = H - 0.78; g.add(neck);

        // 科林斯柱头：双层莨苕叶 + 鎏金顶板
        const capLow = new THREE.Mesh(new THREE.CylinderGeometry(colR * 1.3, colR * 0.9, 0.24, 12), goldOrnMat);
        capLow.position.y = H - 0.6; g.add(capLow);
        const capBell = new THREE.Mesh(new THREE.CylinderGeometry(colR * 1.55, colR * 1.2, 0.22, 12), goldOrnMat);
        capBell.position.y = H - 0.38; g.add(capBell);
        const abacus = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.12, 0.62), goldOrnMat);
        abacus.position.y = H - 0.18; g.add(abacus);

        g.position.set(wallX + inward * (colR + 0.05), 0, z);
        scene.add(g);
    }

    // —— 拱形壁龛：内凹龛洞 + 鎏金拱框线脚 + 龛内雕塑感台座 ——
    function buildNiche(wallX, z, side) {
        const inward = -side;
        const g = new THREE.Group();
        const nicheW = 1.5, nicheH = 2.6, nicheD = 0.22;
        const baseY = 1.2;

        // 龛洞（深色内凹，形成纵深阴影）
        const recess = new THREE.Mesh(
            new THREE.BoxGeometry(nicheD, nicheH, nicheW),
            new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.95, metalness: 0.0 })
        );
        recess.position.set(-inward * nicheD / 2, baseY + nicheH / 2, 0); g.add(recess);

        // 鎏金拱框（两侧立柱 + 半圆拱券）
        for (const s of [-1, 1]) {
            const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.06, nicheH, 0.10), goldOrnMat);
            jamb.position.set(inward * 0.02, baseY + nicheH / 2, s * nicheW / 2); g.add(jamb);
        }
        const arch = new THREE.Mesh(new THREE.TorusGeometry(nicheW / 2, 0.055, 8, 32, Math.PI), goldOrnMat);
        arch.position.set(inward * 0.02, baseY + nicheH, 0);
        arch.rotation.y = Math.PI / 2; g.add(arch);
        // 拱顶鎏金匙心石
        const keystone = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.14), goldMat);
        keystone.position.set(inward * 0.03, baseY + nicheH + nicheW / 2 + 0.05, 0); g.add(keystone);

        // 龛内台座 + 小型奖杯状陈设（呼应音乐厅奖杯/半身像传统）
        const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.20, 0.5, 12), marbleMat);
        plinth.position.set(0, baseY + 0.25, 0); g.add(plinth);
        const urn = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), goldMat);
        urn.position.set(0, baseY + 0.62, 0); urn.scale.y = 1.3; g.add(urn);
        const urnTop = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 10), goldMat);
        urnTop.position.set(0, baseY + 0.86, 0); g.add(urnTop);

        g.position.set(wallX, 0, z);
        g.rotation.y = 0;
        scene.add(g);
    }

    // ============================================================
    // 舞台（抬升平台 + 台唇 + 阶梯 + 栏板）
    // ============================================================
    function buildStage() {
        const S = CONCERT.stage;
        const w = S.x1 - S.x0, d = S.z1 - S.z0;
        const stage = new THREE.Mesh(new THREE.BoxGeometry(w, S.topY, d), woodFloorMat);
        stage.position.set(0, S.topY / 2, (S.z0 + S.z1) / 2);
        stage.castShadow = true; stage.receiveShadow = true; scene.add(stage);

        // —— 舞台表面光亮漆层（高反射，聚光下呈现明亮高光） ——
        const glossMat = new THREE.MeshPhysicalMaterial({
            map: woodColor.clone(),
            roughness: 0.12, metalness: 0.05,
            clearcoat: 0.9, clearcoatRoughness: 0.06,
            envMapIntensity: 1.4
        });
        glossMat.map.repeat.set(1.5, 1.0); glossMat.map.needsUpdate = true;
        const stageGloss = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.4, d - 0.4), glossMat);
        stageGloss.rotation.x = -Math.PI / 2;
        stageGloss.position.set(0, S.topY + 0.005, (S.z0 + S.z1) / 2);
        stageGloss.receiveShadow = true; scene.add(stageGloss);

        // 台唇金色饰条
        const lip = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 0.06, 0.06), goldMat);
        lip.position.set(0, S.topY - 0.02, S.z1); scene.add(lip);

        // 舞台前缘侧栏板（中央留阶梯口）
        for (const [x0, x1] of [[S.x0, CONCERT.stairs.x0], [CONCERT.stairs.x1, S.x1]]) {
            const seg = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, S.topY, 0.1), darkTrimMat);
            seg.position.set((x0 + x1) / 2, S.topY / 2, S.z1);
            seg.castShadow = true; scene.add(seg);
            addBoxCollider('stageFront', x0 - 0.1, x1 + 0.1, S.z1 - 0.25, S.z1 + 0.25);
        }
        // 舞台两侧栏板
        for (const side of [-1, 1]) {
            const seg = new THREE.Mesh(new THREE.BoxGeometry(0.1, S.topY, d), darkTrimMat);
            seg.position.set(side * S.x1, S.topY / 2, (S.z0 + S.z1) / 2);
            scene.add(seg);
            addBoxCollider('stageSide', side * S.x1 - 0.25, side * S.x1 + 0.25, S.z0 - 0.25, S.z1 + 0.25);
        }

        // 中央阶梯（上升方向：观众席地面 → 舞台，与 groundY 严格对齐）
        const st = CONCERT.stairs;
        const stW = st.x1 - st.x0, stD = st.zFloor - st.zStage;
        const nSteps = 6;
        for (let i = 0; i < nSteps; i++) {
            const frac = (i + 0.5) / nSteps;
            const step = new THREE.Mesh(
                new THREE.BoxGeometry(stW, S.topY * ((i + 1) / nSteps), stD / nSteps),
                woodFloorMat
            );
            step.position.set(0, S.topY * ((i + 1) / nSteps) / 2, st.zFloor - stD * frac);
            step.castShadow = true; step.receiveShadow = true; scene.add(step);
        }

        // 舞台后部魔法钢琴可视化屏幕（替代原管风琴装饰墙）
        buildMagicScreen();

        // —— 台口鎏金拱框（proscenium arch）：两侧壁柱 + 顶部横楣 + 拱心饰，框定舞台 ——
        buildProscenium();
    }

    // —— 台口拱框：在舞台前沿竖起鎏金门框，营造歌剧院式「画框舞台」 ——
    function buildProscenium() {
        const S = CONCERT.stage;
        const topY = H - 1.0;             // 拱顶高度（留出穹顶净空）
        const halfSpan = S.x1 - 0.4;      // 略窄于舞台宽

        for (const side of [-1, 1]) {
            const px = side * halfSpan;
            // 主壁柱（大理石柱身 + 鎏金柱头/柱础）
            const shaftH = topY - 1.0;
            const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.40, shaftH, 20), marbleMat);
            shaft.position.set(px, S.topY + shaftH / 2, S.z1 - 0.1);
            shaft.castShadow = true; shaft.receiveShadow = true; scene.add(shaft);
            const base = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 0.9), marbleMat);
            base.position.set(px, S.topY + 0.25, S.z1 - 0.1); scene.add(base);
            const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.38, 0.5, 16), goldOrnMat);
            cap.position.set(px, topY - 0.6, S.z1 - 0.1); scene.add(cap);
            // 柱身鎏金竖棱
            for (let f = 0; f < 10; f++) {
                const a = (f / 10) * Math.PI * 2;
                const flute = new THREE.Mesh(new THREE.BoxGeometry(0.04, shaftH - 0.4, 0.04), goldMat);
                flute.position.set(px + Math.cos(a) * 0.37, S.topY + shaftH / 2, S.z1 - 0.1 + Math.sin(a) * 0.37);
                scene.add(flute);
            }
        }

        // 顶部横楣（鎏金浮雕带 + 线脚 + 中央拱心奖章）
        const lintel = new THREE.Mesh(new THREE.BoxGeometry(halfSpan * 2 + 1.0, 0.9, 0.5), goldOrnMat);
        lintel.position.set(0, topY - 0.1, S.z1 - 0.1); lintel.castShadow = true; scene.add(lintel);
        const lintelCornice = new THREE.Mesh(new THREE.BoxGeometry(halfSpan * 2 + 1.3, 0.18, 0.62), goldMat);
        lintelCornice.position.set(0, topY + 0.42, S.z1 - 0.1); scene.add(lintelCornice);
        // 横楣下沿线脚
        const soffit = new THREE.Mesh(new THREE.BoxGeometry(halfSpan * 2 + 1.0, 0.14, 0.56), goldMat);
        soffit.position.set(0, topY - 0.62, S.z1 - 0.1); scene.add(soffit);
        // 中央拱心奖章（团花圆牌 + 月桂冠环）
        const medallion = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.12, 24), goldOrnMat);
        medallion.rotation.x = Math.PI / 2;
        medallion.position.set(0, topY - 0.1, S.z1 + 0.16); scene.add(medallion);
        const wreath = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.08, 10, 32), goldMat);
        wreath.position.set(0, topY - 0.1, S.z1 + 0.16); scene.add(wreath);

        // —— 台口垂花檐幕（swag valance）：多层红丝绒叠褶，自横楣垂落，营造歌剧院帷幔感 ——
        const swag = new THREE.Group();
        const swagLen = halfSpan * 2 - 0.5;
        const swagH = 1.4, swagD = 0.65;
        const swagSegs = 18;
        for (let i = 0; i < swagSegs; i++) {
            const t0 = i / swagSegs, t1 = (i + 1) / swagSegs;
            const cx = -swagLen / 2 + swagLen * (t0 + t1) / 2;
            const f = (t0 + t1) / 2;
            // 正弦波垂坠：两侧高（悬挂点），中央低（垂折最深）
            const drop = Math.sin(f * Math.PI) * swagD * 0.55;
            const seg = new THREE.Mesh(new THREE.BoxGeometry(swagLen / swagSegs, swagH - drop * 0.3, swagD - drop * 0.5), velvetMat);
            seg.position.set(cx, topY - 0.2 - drop * 0.35, S.z1 + 0.18);
            swag.add(seg);
            // 垂折金流苏
            if (i % 3 === 0) {
                const tassel = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.30, 8), goldMat);
                tassel.position.set(cx, topY - 0.65 - drop * 0.5, S.z1 + 0.35); tassel.rotation.x = Math.PI; swag.add(tassel);
            }
        }
        scene.add(swag);
    }

    // ============================================================
    // 魔法钢琴可视化屏幕（舞台后方幕布 → 实时琴键状态镜像）
    // - CanvasTexture 逐帧绘制：88 键键盘条 + 按下琴键的光柱（力度）/ 持续光环（时长）
    // - 后台星辰闪烁 + 漂浮金色微尘 + 按下冲击波 / 释放火花等魔法粒子
    // ============================================================
    let magic = null;   // { W,H, MARGIN, keyW, keyTop, keyBottom, ctx, tex, clock, stars, motes, bursts }

    function isWhiteMidi(midi) { return [0, 2, 4, 5, 7, 9, 11].indexOf(midi % 12) >= 0; }

    function buildMagicScreen() {
        // 分辨率降至 800×400（原 1600×800 每帧全量重绘并上传 GPU 是画面卡顿主因），
        // 静态背景预渲染到离屏层，主画布每帧仅 drawImage 复制，省去逐星逐帧重绘。
        const W = 800, H = 400, MARGIN = 26;
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;

        magic = {
            W, H, MARGIN, ctx, tex,
            keyW: (W - MARGIN * 2) / 88,
            keyTop: H - 96,      // 键盘条顶部（画布纵坐标）
            keyBottom: H - 26,   // 键盘条底部
            fallHorizon: 3.5,    // 下落音符条的提前量（秒）
            fallPxPerSec: (H - 132) / 3.5,  // 下落速率（像素/秒）：时间→竖直长度统一刻度
            barH: 2,             // 下落音符条的最小高度（像素）：仅保证极短音可见，不强行拉长
            clock: 0,
            stars: [],
            motes: [],
            bursts: []
        };

        // 下落音符块控制器（独立模块：职责是色块投放 + 落地涟漪反馈，此处仅装配依赖）
        magic.fallCtl = new FallingNotesController(
            {
                keyW: magic.keyW,
                keyTop: magic.keyTop,
                fallHorizon: magic.fallHorizon,
                fallPxPerSec: magic.fallPxPerSec,
                barH: magic.barH
            },
            () => app.pianoSchedule,
            (midi) => magicKeyX(midi)
        );

        // 离屏静态背景：深蓝紫渐变 + 固定远景星辰（仅渲染一次）
        magic.bg = document.createElement('canvas');
        magic.bg.width = W; magic.bg.height = H;
        const bctx = magic.bg.getContext('2d');
        const bgGrad = bctx.createLinearGradient(0, 0, 0, H);
        bgGrad.addColorStop(0, '#0a0714');
        bgGrad.addColorStop(0.6, '#060411');
        bgGrad.addColorStop(1, '#0b0816');
        bctx.fillStyle = bgGrad;
        bctx.fillRect(0, 0, W, H);
        for (let i = 0; i < 90; i++) {
            const x = Math.random() * W, y = Math.random() * (H - 60);
            const r = 0.6 + Math.random() * 1.4, a = 0.10 + Math.random() * 0.35;
            bctx.fillStyle = `rgba(210,200,255,${a})`;
            bctx.beginPath(); bctx.arc(x, y, r, 0, Math.PI * 2); bctx.fill();
        }

        // 近景闪烁星辰（少量，每帧绘制，保留呼吸闪烁）
        for (let i = 0; i < 40; i++) {
            magic.stars.push({
                x: Math.random() * W, y: Math.random() * (H - 70),
                r: 0.6 + Math.random() * 1.6,
                phase: Math.random() * Math.PI * 2,
                speed: 0.6 + Math.random() * 1.8,
                base: 0.20 + Math.random() * 0.5
            });
        }
        // 漂浮金色微尘（缓慢上浮，循环）——数量克制、亮度压低，仅作氛围点缀
        for (let i = 0; i < 8; i++) {
            magic.motes.push({
                x: Math.random() * W, y: Math.random() * (H - 60),
                vy: 8 + Math.random() * 22, r: 0.9 + Math.random() * 1.6,
                phase: Math.random() * Math.PI * 2
            });
        }

        // 屏幕面板（自发光，不参与光照，保证画面色彩鲜艳） + 金色边框
        // Eastman Theater 实测：舞台后红色大幕位于世界 z≈-13.6，屏幕悬于大幕正前方、
        // 钢琴尾后（尾端 z≈-12.25），宽 10m 居中于台口，避让两侧演奏者上下场通道。
        const screenW = 10.6, screenH = 7.3, centerY = 5.35;  // 底部贴地(Y=1.7)、顶部上延至 Y≈9，被上方檐幕盖住；横向 10.6 保持
        // Opera House：红色幕布（SM_SceneCurtain*）由「顶檐幕 + 左右两侧幕」组成。
        // 实测世界包围盒：檐幕 X 22.36~22.78 / Y 6.66~10.83 / Z -9.81~5.97；
        // 左侧幕 Z -11.25~-7.14（Y 1.7~10.42），右侧幕 Z 3.05~9.66。中空开口 Z[-7.14,3.05]。
        // 屏幕置于幕布「后方」X≈23.2，横向略大于开口使侧幕各盖住一点，纵向自地面向上延伸，
        // 顶部深入檐幕区域被盖住，不留缝隙、不陷入地板。
        const CURTAIN_X = 23.1;          // 幕布后方（加深，避免与幕布 z-fighting / 重叠）
        const CURTAIN_GAP_Z = -2.04;     // 左右侧幕之间空档的 Z 中心
        const screenGroup = new THREE.Group();
        screenGroup.position.set(CURTAIN_X, centerY, CURTAIN_GAP_Z);
        screenGroup.rotation.y = -Math.PI / 2;   // PlaneGeometry 默认面向 +Z，旋转后面向 -X（观众）
        const panel = new THREE.Mesh(
            new THREE.PlaneGeometry(screenW, screenH),
            new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, fog: false })
        );
        screenGroup.add(panel);

        const frameT = 0.14;
        const addFrame = (w, h, x, y) => {
            const f = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.18), goldMat);
            f.position.set(x, y, -0.02);
            screenGroup.add(f);
        };
        addFrame(screenW + frameT * 2, frameT, 0, screenH / 2 + frameT / 2);   // 顶
        addFrame(screenW + frameT * 2, frameT, 0, -screenH / 2 - frameT / 2);  // 底
        addFrame(frameT, screenH, -(screenW / 2 + frameT / 2), 0);             // 左
        addFrame(frameT, screenH, (screenW / 2 + frameT / 2), 0);              // 右
        scene.add(screenGroup);

        app.magicScreen = magic;
    }

    function magicKeyX(midi) {
        return magic.MARGIN + ((midi - 21) + 0.5) * magic.keyW;
    }

    // 按下瞬间：键位迸出 3~4 颗克制火花（参考 Piano Tiles 的极简反馈，避免喧宾夺主）
    function magicNoteOn(midi, vel) {
        if (!magic) return;
        const x = magicKeyX(midi);
        for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + Math.random() * 0.6;
            const sp = 40 + vel * 120;
            magic.bursts.push({
                x, y: magic.keyTop - 5,
                vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                life: 0, maxLife: 0.25 + vel * 0.25,
                r: 0.8 + Math.random() * 1.4 * (0.5 + vel),
                color: `hsl(${44 + Math.random() * 20}, 80%, ${62 + Math.random() * 14}%)`
            });
        }
    }

    // 释放瞬间：键位向上逸出 2~3 颗微小青火花，克制且短促
    function magicNoteOff(midi) {
        if (!magic) return;
        const x = magicKeyX(midi);
        for (let i = 0; i < 3; i++) {
            const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.2;
            const sp = 30 + Math.random() * 70;
            magic.bursts.push({
                x, y: magic.keyTop - 4,
                vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30,
                life: 0, maxLife: 0.25 + Math.random() * 0.3,
                r: 0.7 + Math.random() * 1.4,
                color: `hsl(${170 + Math.random() * 50}, 70%, 68%)`
            });
        }
    }

    function drawMagicBeam(ctx, x, y0, h, vel) {
        // 光柱自按键向上延伸，接近键盘处（底部）渐隐至完全透明，避免遮挡钢琴与相邻元素
        const gw = 2.5 + vel * 5;
        const top = y0 - h;
        const grad = ctx.createLinearGradient(0, y0, 0, top);
        const a = 0.35 + vel * 0.6;
        grad.addColorStop(0.0, 'rgba(140,140,255,0)');                 // 底部（键盘处）完全淡出
        grad.addColorStop(0.40, `rgba(150,140,255,${0.75 * a})`);      // 中段最亮
        grad.addColorStop(0.75, `rgba(90,90,220,${0.30 * a})`);
        grad.addColorStop(1.0, 'rgba(90,90,220,0)');                   // 顶端透明
        ctx.fillStyle = grad;
        ctx.fillRect(x - gw, y0 - h, gw * 2, h);
    }

    function drawMagicKeyboard(ctx) {
        const { W, H, MARGIN, keyW, keyTop, keyBottom } = magic;
        const pk = app.pianoKeys || [];
        const byMidi = new Map();
        for (const k of pk) byMidi.set(k.midi, k);

        // 键盘底座（提亮，使琴键区域明显）
        ctx.fillStyle = 'rgba(70,58,92,0.35)';
        ctx.fillRect(MARGIN - 8, keyTop - 8, W - MARGIN * 2 + 16, keyBottom - keyTop + 16);

        const keyH = keyBottom - keyTop;
        // 白键：连续满高的一整片象牙白，不加分隔描边（黑键下方自然露出白色延伸，键面合为一整体）
        for (let midi = 21; midi <= 108; midi++) {
            const x = MARGIN + (midi - 21) * keyW;
            const st = byMidi.get(midi);
            const isBlk = !isWhiteMidi(midi);
            ctx.fillStyle = 'rgba(240,234,220,0.60)';
            ctx.fillRect(x, keyTop, keyW, keyH);
            if (isBlk) continue;
            // 白键按下暖金高亮（仅覆盖本白键一列，连续键面中仍可辨识被按下的键）
            if (st && st.down) {
                ctx.fillStyle = `rgba(255,224,150,${0.72 + (st.vel || 0.75) * 0.28})`;
                ctx.fillRect(x, keyTop, keyW, keyH);
            }
        }
        // 黑键：压在白键之上、长度短于白键 0.55（真实钢琴黑键仅为白键全长前段，下方为白键延伸）
        for (let midi = 21; midi <= 108; midi++) {
            if (isWhiteMidi(midi)) continue;
            const x = MARGIN + (midi - 21) * keyW;
            const st = byMidi.get(midi);
            const down = st && st.down;
            const bw = keyW * 0.56, bx = x + (keyW - bw) / 2;
            const bh = keyH * 0.55;
            ctx.fillStyle = down
                ? `rgba(170,225,255,${0.72 + (st.vel || 0.75) * 0.28})`
                : 'rgba(22,20,32,0.97)';
            ctx.fillRect(bx, keyTop, bw, bh);
            ctx.strokeStyle = down ? 'rgba(200,240,255,0.95)' : 'rgba(90,84,110,0.9)';
            ctx.lineWidth = 1;
            ctx.strokeRect(bx, keyTop, bw, bh);
            // 底部前缘阴影：向下淡出，强化「黑键短于白键」的立体纵深与长度对比
            const shH = 6;
            const sh = ctx.createLinearGradient(0, keyTop + bh, 0, keyTop + bh + shH);
            sh.addColorStop(0, 'rgba(0,0,0,0.30)');
            sh.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = sh;
            ctx.fillRect(bx, keyTop + bh, bw, shH);
        }
    }

    function updateMagicBursts(ctx, dt) {
        const list = magic.bursts;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let i = list.length - 1; i >= 0; i--) {
            const p = list[i];
            p.life += dt;
            if (p.life >= p.maxLife) { list.splice(i, 1); continue; }
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy += 26 * dt;                       // 轻微重力，火花自然回落
            const k = 1 - p.life / p.maxLife;
            ctx.globalAlpha = k;
            ctx.fillStyle = p.color;
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r * k + 0.4, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
        ctx.globalAlpha = 1;
    }

    function drawMagicScreen(dt) {
        if (!magic) return;
        magic.clock += dt;
        magic.fallCtl.update(dt);
        const { W, H, ctx } = magic;
        const t = performance.now() / 1000;
        const now = performance.now();

        // 背景：直接复制预渲染的静态层（渐变 + 远景星辰），避免每帧重建渐变与逐星绘制
        ctx.drawImage(magic.bg, 0, 0);

        // 近景星辰闪烁
        for (const s of magic.stars) {
            const a = s.base * (0.55 + 0.45 * Math.sin(t * s.speed + s.phase));
            ctx.fillStyle = `rgba(210,200,255,${a})`;
            ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
        }
        // 漂浮金色微尘（上浮循环）
        for (const m of magic.motes) {
            m.y -= m.vy * dt;
            if (m.y < 0) { m.y = H - 40; m.x = Math.random() * W; }
            const tw = 0.35 + 0.35 * Math.sin(t * 1.5 + m.phase);
            ctx.fillStyle = `rgba(255,225,160,${tw * 0.28})`;
            ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); ctx.fill();
        }

        // 下落音符条：绘制在键盘层之下，落地即被键盘遮挡（钢琴始终保持完整可见）
        magic.fallCtl.renderBlocks(ctx);

        // 键盘条（钢琴层，位于所有下落色块之上）
        drawMagicKeyboard(ctx);

        // 落地涟漪反馈（触键点上方扩散淡出环）
        magic.fallCtl.renderRipples(ctx);

        // 按下琴键：光柱（接近键盘处渐隐，不遮挡钢琴）+ 持续光环（时长→半径）
        for (const key of (app.pianoKeys || [])) {
            if (!key.down) continue;
            const x = magicKeyX(key.midi);
            const vel = (key.vel == null) ? 0.75 : key.vel;
            const bh = 16 + vel * 80;
            drawMagicBeam(ctx, x, magic.keyTop - 2, bh, vel);
            const hold = (now - (key.onTime || now)) / 1000;
            const r = 3 + Math.min(hold, 2.0) * 7;
            ctx.strokeStyle = `rgba(150,140,255,${Math.max(0, 0.45 - r * 0.01)})`;
            ctx.lineWidth = 1.4;
            ctx.beginPath(); ctx.arc(x, magic.keyTop - 6, r, 0, Math.PI * 2); ctx.stroke();
        }

        // 冲击波 / 释放火花
        updateMagicBursts(ctx, dt);

        magic.tex.needsUpdate = true;
    }

    // ============================================================
    // 舞台前缘左右两侧全长幕布（深红丝绒，竖向褶皱，填补空旷）
    // ============================================================
    function buildCurtains() {
        const S = CONCERT.stage;
        const innerX = 7.0;              // 幕布内侧边缘（靠近舞台中央）
        const width = HW - innerX;       // 幕布宽度：由内侧边缘精确延伸至侧墙，与墙面无缝隙贴合
        const height = H - 0.1;          // 幕布高度：恰贴天花板与地面

        function makeCurtain(cx) {
            const geo = new THREE.PlaneGeometry(width, height, 44, 12);
            const pos = geo.attributes.position;
            for (let i = 0; i < pos.count; i++) {
                const x = pos.getX(i);
                const y = pos.getY(i);
                const t = (x / width) + 0.5;            // 0..1 幕布宽度方向
                const bottom = (height / 2 - y) / height; // 顶部 0 -> 底部 1
                pos.setZ(i, Math.sin(t * Math.PI * 13) * (0.06 + bottom * 0.12));
            }
            geo.computeVertexNormals();
            const curtain = new THREE.Mesh(geo, curtainMat);
            curtain.position.set(cx, height / 2, S.z1 + 0.30);
            curtain.castShadow = true; curtain.receiveShadow = true;
            scene.add(curtain);
            return curtain;
        }

        // 幕布中心：使外侧边缘精确落于 ±HW（侧墙），内侧边缘落于 ±innerX
        makeCurtain(-(HW + innerX) / 2);
        makeCurtain((HW + innerX) / 2);
    }

    // ============================================================
    // 钢琴（复用 GLB，不改动原模型资产；失败回退程序化示意）
    // ============================================================
    // 程序化标准 88 键键盘（52 白键 + 36 黑键）。
    // 按真实音乐会三角钢琴比例：白键键宽 23.5mm、可见长度 150mm、键厚 12mm；
    // 黑键宽约 58% 白键、可见长度 95mm、高出白键约 11mm。用于修正简模钢琴
    // 键数不足、键块过粗过高、黑键塌陷（无抬升）等异常。
    // sx/sy/sz 为钢琴归一化到真实尺寸时的各轴缩放系数；键盘单键跨度需除以
    // 对应轴缩放，从而在世界空间还原真实物理尺寸，并与琴体比例协调一致。
    function buildPianoKeyboard(sx, sy, sz, keyFrontX, keyBedY, keyCenterZ) {
        const g = new THREE.Group();

        // —— 键盘锚点（GLB 局部坐标，由实测原始键床包围盒推导） ——
        // keyFrontX：白键前端（朝向演奏者，= 键床 X 最大端）
        // keyBedY：  键床顶面 Y（= 白键底面，与琴体键盘框架完全贴合）
        // keyCenterZ：键盘左右中心（= 原始键床 Z 中值，非琴体整包围盒中轴）

        // —— 真实世界尺寸（米） ——
        const WHITE_PITCH  = 0.0235;   // 白键中心距
        const WHITE_DEPTH  = 0.150;    // 白键可见长度
        const WHITE_THICK  = 0.012;    // 白键厚度
        const BLACK_DEPTH  = 0.095;    // 黑键可见长度
        const BLACK_LIFT   = 0.011;    // 黑键高出白键
        const BLACK_WIDTH_RATIO = 0.58; // 黑键宽 ≈ 白键中心距的 58%

        // —— 换算到 GLB 局部坐标 ——
        const wPitch = WHITE_PITCH / sz;
        const wDepth = WHITE_DEPTH / sx;
        const wThick = WHITE_THICK / sy;
        const bWidth = WHITE_PITCH * BLACK_WIDTH_RATIO / sz;
        const bDepth = BLACK_DEPTH / sx;
        const bLift  = BLACK_LIFT / sy;
        const gapZ = 0.001 / sz;        // 1mm 键缝

        // 白 / 黑键纵向范围（X：front 朝向演奏者，back 朝向琴体）
        const wFront  = keyFrontX;
        const wBack   = keyFrontX - wDepth;
        const wBottom = keyBedY;                    // 白键底面 = 键床顶面（贴合、无缝隙）
        const wTop    = keyBedY + wThick;           // 白键顶面
        const bFront  = keyFrontX - (WHITE_DEPTH - BLACK_DEPTH) / sx; // 黑键前端内缩约 55mm
        const bBack   = wBack;                                       // 黑键后端与白键平齐

        // 材料（参照项目原钢琴建模规范）
        const whiteMat = new THREE.MeshPhysicalMaterial({
            color: 0xf0ede5, roughness: 0.25, metalness: 0.0,
            clearcoat: 0.4, clearcoatRoughness: 0.3, envMapIntensity: 0.6
        });
        const blackMat = new THREE.MeshStandardMaterial({
            color: 0x080808, roughness: 0.2, metalness: 0.3, envMapIntensity: 1.1
        });
        // 按压态材料：白键压暗（模拟下陷阴影），黑键提亮（在黑底上清晰可见），提供明显按压反馈
        const whitePressedMat = new THREE.MeshPhysicalMaterial({
            color: 0xd6d2c8, roughness: 0.3, metalness: 0.0,
            clearcoat: 0.4, clearcoatRoughness: 0.3, envMapIntensity: 0.5
        });
        const blackPressedMat = new THREE.MeshStandardMaterial({
            color: 0x3c3c42, roughness: 0.25, metalness: 0.35, envMapIntensity: 1.3
        });
        const feltMat = new THREE.MeshStandardMaterial({
            color: 0x4d1016, roughness: 0.95, metalness: 0.0
        });

        // 第 0 键 = A0（音级 9）；白键音级 {C,D,E,F,G,A,B}
        const WHITE_PC = new Set([0, 2, 4, 5, 7, 9, 11]);
        const isWhite = (i) => WHITE_PC.has((i + 9) % 12);

        // 预计算每个音（0..87）的类型与白键序号
        const types = [];
        const whiteIndex = [];
        let wi = 0;
        for (let i = 0; i < 88; i++) {
            const w = isWhite(i);
            types.push(w);
            whiteIndex.push(w ? wi++ : -1);
        }
        const N_WHITE = wi; // 52
        // 键盘左右方向：演奏者就座于 +X 侧、朝向 -X，其左侧为 +Z。低音（idx=0）应置于演奏者左侧(+Z)，
        // 高音置于右侧(-Z)，故白键中心 Z 随 idx 增大而递减，避免出现镜像反转。
        const rightZ = keyCenterZ + (N_WHITE - 1) * wPitch / 2;   // 低音端（演奏者左侧，+Z）
        const whiteCenterZ = (idx) => rightZ - idx * wPitch;      // idx=0 最低音 → +Z

        // —— 白键 ——
        const whiteGeo = new THREE.BoxGeometry(wDepth, wThick, wPitch - gapZ);
        whiteGeo.translate((wFront + wBack) / 2, wBottom + wThick / 2, 0);
        for (let i = 0; i < 88; i++) {
            if (!types[i]) continue;
            const m = new THREE.Mesh(whiteGeo, whiteMat);
            m.position.z = whiteCenterZ(whiteIndex[i]);
            m.castShadow = true; m.receiveShadow = true;
            g.add(m);
            app.pianoKeys.push({
                midi: 21 + i, white: true, mesh: m, restY: 0, pressY: wThick * 0.45,
                depthScale: sy,
                restMat: whiteMat, pressedMat: whitePressedMat, down: false, wasDown: false
            });
        }

        // —— 黑键（抬升于白键后段，跨坐于相邻白键之间） ——
        const bBottom = wTop + 0.001 / sy;
        const blackGeo = new THREE.BoxGeometry(bDepth, bLift, bWidth);
        blackGeo.translate((bFront + bBack) / 2, bBottom + bLift / 2, 0);
        for (let i = 0; i < 88; i++) {
            if (types[i]) continue;
            let prev = i - 1, next = i + 1;
            while (!types[prev]) prev--;
            while (!types[next]) next++;
            const zc = (whiteCenterZ(whiteIndex[prev]) + whiteCenterZ(whiteIndex[next])) / 2;
            const m = new THREE.Mesh(blackGeo, blackMat);
            m.position.z = zc;
            m.castShadow = true; m.receiveShadow = true;
            g.add(m);
            app.pianoKeys.push({
                midi: 21 + i, white: false, mesh: m, restY: 0, pressY: bLift * 0.9,
                depthScale: sy,
                restMat: blackMat, pressedMat: blackPressedMat, down: false, wasDown: false
            });
        }

        // —— 琴键后缘红色呢毡条（黑键后方，贯穿键盘） ——
        const felt = new THREE.Mesh(
            new THREE.BoxGeometry(0.02 / sx, 0.010 / sy, N_WHITE * wPitch),
            feltMat
        );
        felt.position.set(wBack - 0.010 / sx, wTop - 0.004 / sy, keyCenterZ);
        felt.receiveShadow = true;
        g.add(felt);

        return g;
    }

    function createPianoFromGLB(gltf, x, y, z, rotY = 0) {
        const g = new THREE.Group();
        const model = gltf.scene || gltf;

        const rawBox = new THREE.Box3().setFromObject(model);
        const rawSize = rawBox.getSize(new THREE.Vector3());

        // 归一化到真实音乐会三角钢琴尺寸（米），按轴独立缩放以还原标准结构比例
        // （原始 GLB 长宽高比例异常：过宽过高，导致整体臃肿、违和）。
        // 高度按需精确调整至 130cm（1.30m ± 0.02m），使整琴在舞台上更具存在感、
        // 同时抬高琴键面，便于演奏者以更舒适的前臂姿态触键（解决“够不到”问题）。
        const TARGET_LEN = 2.2, TARGET_WIDTH = 1.5, TARGET_HEIGHT = 1.30;
        // 钢琴整体竖向微调（米）。130cm 的总高已由 TARGET_HEIGHT 决定，
        // 此处设为 0 使琴体底部（四条腿）恰好平贴舞台地面，保证放置平稳、四条腿等高，
        // 不再下沉；若实测仍需让琴键更贴近肘部高度，可用负值整体下移。
        const PIANO_Y_OFFSET = 0;
        const sx = rawSize.x > 0 ? TARGET_LEN / rawSize.x : 1;
        const sy = rawSize.y > 0 ? TARGET_HEIGHT / rawSize.y : 1;
        const sz = rawSize.z > 0 ? TARGET_WIDTH / rawSize.z : 1;

        // 遍历：材质调整 + 隐藏原始白/黑键，同时在缩放前测量原始键床的联合包围盒
        // （与 rawBox 同一坐标帧，用于精准映射键盘前端 / 键床 / 左右中心）
        const keyBox = new THREE.Box3();
        let keyCount = 0;
        model.traverse((obj) => {
            if (!obj.isMesh) return;
            obj.castShadow = true;
            obj.receiveShadow = true;
            const mat = obj.material;
            if (!mat || !mat.isMeshStandardMaterial) return;
            const r = mat.color.r, g2 = mat.color.g, b = mat.color.b;
            const isWhiteKey = r > 0.95 && g2 > 0.95 && b > 0.95;
            const isBlackKey = r < 0.15 && g2 < 0.15 && b < 0.15;
            if (isWhiteKey || isBlackKey) {
                keyBox.union(new THREE.Box3().setFromObject(obj));
                keyCount++;
                obj.visible = false;   // 隐藏原始白/黑键（简模键数不足/无抬升），改用程序化 88 键
            } else if (r > 0.95 && g2 > 0.85 && b < 0.35) {
                mat.color.setHex(0xc9a24b); mat.metalness = 0.95; mat.roughness = 0.25; mat.envMapIntensity = 1.6;
            } else if (Math.abs(r - g2) < 0.03 && Math.abs(g2 - b) < 0.03 && r > 0.4 && r < 0.8) {
                mat.metalness = 0.8; mat.roughness = 0.3; mat.envMapIntensity = 1.2;
            } else {
                mat.color.setHex(0x0a0a0c); mat.metalness = 0.15; mat.roughness = 0.15; mat.envMapIntensity = 1.8;
            }
            mat.needsUpdate = true;
        });

        // 由实测键床推导定位锚点；找不到原始键时回退到保守常量
        let keyFrontX = 0.912;
        let keyBedY = 0.343 - 0.012 / sy;
        let keyCenterZ = (rawBox.min.z + rawBox.max.z) / 2;
        if (keyCount > 0 && !keyBox.isEmpty()) {
            keyFrontX = keyBox.max.x;                        // 白键前端 = 键床 X 最大端（朝向演奏者）
            keyBedY = keyBox.min.y;                          // 白键底面 = 键床顶面，贴合键盘框架
            keyCenterZ = (keyBox.min.z + keyBox.max.z) / 2;  // 键盘左右中心 = 键床 Z 中值（真居中对齐）
        }

        model.scale.set(sx, sy, sz);
        model.rotation.set(0, rotY - Math.PI / 2, 0);

        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        model.position.set(x - center.x, y + PIANO_Y_OFFSET - box.min.y, z - center.z);

        // 叠加程序化 88 键（锚定到实测键床：贴合、居中、不悬浮，弹奏时无位移/晃动）
        model.add(buildPianoKeyboard(sx, sy, sz, keyFrontX, keyBedY, keyCenterZ));

        g.add(model);
        addBoxCollider('piano',
            x - TARGET_LEN / 2 - 0.25, x + TARGET_LEN / 2 + 0.25,
            z - TARGET_WIDTH / 2 - 0.25, z + TARGET_WIDTH / 2 + 0.25);
        scene.add(g);
        return g;
    }

    // ============================================================
    // Steinway 三角钢琴（真实模型：88 独立琴键网格 Key_021_W..Key_108_B）
    // - 统一缩放：白键顶面 = 0.745m（真实音乐会三角钢琴键高标准）
    // - 琴键原点位于各自几何中心（Blender 导出时已归中），getWorldPosition 即键中心
    // - 按压动画 / 物理碰撞 / 指尖 IK 全部复用既有管线，仅锚点改为实测键床
    // ============================================================
    function createSteinwayFromGLB(gltf, x, y, z, rotY = 0) {
        const g = new THREE.Group();
        const model = gltf.scene || gltf;

        const keyMeshes = [];
        model.traverse((obj) => {
            if (!obj.isMesh) return;
            obj.castShadow = true; obj.receiveShadow = true;
            const m = /^Key_(\d{3})_([WB])$/.exec(obj.name || '');
            if (m) keyMeshes.push({ obj, midi: +m[1], white: m[2] === 'W' });
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            for (const mt of mats) {
                if (mt && mt.isMeshStandardMaterial) { mt.envMapIntensity = 1.25; mt.needsUpdate = true; }
            }
        });
        keyMeshes.sort((a, b) => a.midi - b.midi);
        if (keyMeshes.length !== 88) {
            console.warn('[piano] Steinway 琴键数量异常（期望 88）:', keyMeshes.length);
            return null;
        }

        // —— 实测键床（此时模型尚未变换，包围盒即 glTF 局部坐标） ——
        model.updateMatrixWorld(true);
        const tmpBox = new THREE.Box3();
        const keyInfo = new Map();
        let topSum = 0, topN = 0, frontRaw = -Infinity, zMin = Infinity, zMax = -Infinity;
        for (const km of keyMeshes) {
            tmpBox.setFromObject(km.obj);
            keyInfo.set(km.midi, tmpBox.clone());
            if (km.white) { topSum += tmpBox.max.y; topN++; frontRaw = Math.max(frontRaw, tmpBox.max.x); }
            zMin = Math.min(zMin, tmpBox.min.z); zMax = Math.max(zMax, tmpBox.max.z);
        }
        const whiteTopRaw = topN ? topSum / topN : 0.688;
        const KEYTOP_WORLD = 0.745;               // 真实三角钢琴白键顶面标准高度（米）
        const s = KEYTOP_WORLD / whiteTopRaw;     // 统一缩放（无轴向拉伸，保真模型比例）

        model.scale.set(s, s, s);
        model.rotation.set(0, rotY - Math.PI / 2, 0);
        // 琴腿底部（模型局部 y=0）平贴舞台面；琴体中心对齐目标点
        const bodyBox = new THREE.Box3().setFromObject(model);
        const center = bodyBox.getCenter(new THREE.Vector3());
        model.position.set(x - center.x, y - bodyBox.min.y, z - center.z);

        // —— 注册 88 真实琴键（按压下沉 / 逐键材质反馈 / 物理与指尖锚点） ——
        const DIP_W = 0.010, DIP_B = 0.008;       // 真实键程：白键 10mm / 黑键 8mm
        for (const km of keyMeshes) {
            const box = keyInfo.get(km.midi);
            const c = box.getCenter(new THREE.Vector3());
            const srcMats = Array.isArray(km.obj.material) ? km.obj.material : [km.obj.material];
            const rest = srcMats[0].clone();
            const pressed = srcMats[0].clone();
            pressed.color.multiplyScalar(0.72);   // 按压态：贴图乘暗，模拟下陷阴影
            km.obj.material = rest;
            app.pianoKeys.push({
                midi: km.midi, white: km.white, mesh: km.obj,
                restY: km.obj.position.y,                     // 局部（键原点=几何中心）
                pressY: (km.white ? DIP_W : DIP_B) / s,       // 换算为未缩放局部单位
                depthScale: s,
                topOffset: (box.max.y - c.y) * s,             // 中心→顶面（世界米）
                halfDepth: (box.max.x - c.x) * s,             // 中心→键前缘（世界米）
                restMat: rest, pressedMat: pressed,
                down: false, wasDown: false
            });
        }

        g.add(model);
        scene.add(g);

        // 碰撞体：按实测琴体包围盒（含缩放与旋转后的世界框）
        g.updateMatrixWorld(true);
        const worldBox = new THREE.Box3().setFromObject(g);
        addBoxCollider('piano',
            worldBox.min.x - 0.25, worldBox.max.x + 0.25,
            worldBox.min.z - 0.25, worldBox.max.z + 0.25);

        const anchors = {
            // 世界锚点 = glTF 局部坐标 × 缩放 + 模型平移（rotation=0 时轴对齐）
            keyFrontX: frontRaw * s + model.position.x,
            keyCenterZ: ((zMin + zMax) / 2) * s + model.position.z,
            keyTopWorldY: y + KEYTOP_WORLD,
            scale: s
        };
        console.log('[piano] Steinway 装配: scale=', s.toFixed(3),
            '| 键前缘X=', anchors.keyFrontX.toFixed(3),
            '| 键盘Z中心=', anchors.keyCenterZ.toFixed(3),
            '| 键顶Y=', anchors.keyTopWorldY.toFixed(3));
        return { group: g, anchors };
    }

    function createPianoBench(x, z, rotY = 0) {
        const g = new THREE.Group();
        const topY = CONCERT.stage.topY;

        const woodMat = new THREE.MeshStandardMaterial({
            color: 0x2a1608, roughness: 0.35, metalness: 0.25, envMapIntensity: 0.6
        });
        const padMat = new THREE.MeshStandardMaterial({
            color: 0x0a0a0c, roughness: 0.55, metalness: 0.0, envMapIntensity: 0.4
        });

        // 软垫（略拱起的圆角皮面）
        // 座椅高度：坐垫顶 0.50m（接近标准琴凳高约 48cm），
        // 使演奏者大腿接近水平、双脚平稳踩地；四条腿同步缩短，保持四脚等高平稳着地。
        const pad = new THREE.Mesh(new RoundedBoxGeometry(1.30, 0.14, 0.42, 3, 0.05), padMat);
        pad.position.y = 0.43; pad.castShadow = true; pad.receiveShadow = true; g.add(pad);
        // 座板
        const board = new THREE.Mesh(new RoundedBoxGeometry(1.34, 0.06, 0.46, 2, 0.02), woodMat);
        board.position.y = 0.33; board.castShadow = true; board.receiveShadow = true; g.add(board);
        // 四条车削腿（两段圆锥近似收腰造型）
        for (const [lx, lz] of [[-0.60, -0.17], [0.60, -0.17], [-0.60, 0.17], [0.60, 0.17]]) {
            const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.035, 0.14, 10), woodMat);
            upper.position.set(lx, 0.20, lz); upper.castShadow = true; g.add(upper);
            const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.14, 10), woodMat);
            lower.position.set(lx, 0.07, lz); lower.castShadow = true; g.add(lower);
        }
        // 横撑（十字稳定结构）
        const braceX = new THREE.Mesh(new RoundedBoxGeometry(1.20, 0.05, 0.05, 2, 0.015), woodMat);
        braceX.position.y = 0.08; braceX.castShadow = true; g.add(braceX);
        const braceZ = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.05, 0.34, 2, 0.015), woodMat);
        braceZ.position.y = 0.08; braceZ.castShadow = true; g.add(braceZ);

        g.position.set(x, topY, z);
        g.rotation.y = rotY;
        scene.add(g);

        // 记录可坐坐标：面向钢琴键盘（-Z 朝琴键），起身往 +Z（远离键盘）退
        app.seats = app.seats || [];
        app.seats.push({
            id: 'piano-bench',
            isPiano: true,
            eyeX: x, eyeY: topY + 0.83, eyeZ: z,
            yaw: 0,                                             // 相机默认朝 -Z（正对琴键）
            standX: x, standY: topY + STAND_EYE, standZ: z + 0.6
        });
    }

    // ============================================================
    // 延音踏板（程序化，置于键盘下方演奏者右脚下）：踩下时踏板下沉
    // ============================================================
    function createSustainPedal(x, y, z) {
        const g = new THREE.Group();
        const brassMat = new THREE.MeshStandardMaterial({
            color: 0xc9a24b, roughness: 0.3, metalness: 0.9, envMapIntensity: 1.5
        });
        const darkMat = new THREE.MeshStandardMaterial({
            color: 0x1a1410, roughness: 0.6, metalness: 0.3, envMapIntensity: 0.5
        });
        // 底座（贴地固定）
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.03, 0.14), darkMat);
        base.position.y = 0.015; base.castShadow = true; base.receiveShadow = true; g.add(base);
        // 踏板杠杆（黄铜，略前倾），按压时整体下沉模拟踩踏
        const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.022, 0.13), brassMat);
        pedal.position.set(0, 0.055, 0.01); pedal.castShadow = true; g.add(pedal);
        g.position.set(x, y, z);
        scene.add(g);
        app.sustainPedal = { pedal, restY: 0.055, pressY: 0.028, down: false };
        return g;
    }

    // ============================================================
    // 观众席（阶梯看台 + instanced 座椅）
    // ============================================================
    function buildSeating() {
        const cfg = CONCERT.seating;

        // 从中央过道地面升起、连通到某排看台顶面的楼梯（左右看台块各一）
        function buildRowStairs(side, riserTop, z) {
            const stepH = 0.17;
            const n = Math.max(1, Math.round(riserTop / stepH));
            const actualH = riserTop / n;
            const stepD = 0.30;                       // 每级踏步进深
            const sx = side * (cfg.aisleHalf - 0.5);  // 楼梯置于过道边缘、贴近看台内侧面
            for (let s = 0; s < n; s++) {
                const st = new THREE.Mesh(new THREE.BoxGeometry(0.7, actualH, stepD), woodFloorMat);
                st.position.set(sx, actualH * (s + 0.5), z - cfg.riserDepth / 2 - stepD * (n - s));
                st.castShadow = true; st.receiveShadow = true;
                scene.add(st);
            }
        }

        // 高细节座椅部件：圆角软垫 / 圆角靠背 / 双扶手 / 立柱 / 地座
        const cushionGeo = new RoundedBoxGeometry(0.52, 0.14, 0.50, 3, 0.035);
        const backGeo    = new RoundedBoxGeometry(0.50, 0.66, 0.09, 3, 0.045);
        const armGeo     = new RoundedBoxGeometry(0.06, 0.22, 0.50, 2, 0.02);
        const legGeo     = new THREE.CylinderGeometry(0.03, 0.035, 0.30, 10);
        const baseGeo    = new THREE.CylinderGeometry(0.10, 0.14, 0.05, 14);

        // 梯形看台：前窄后宽，每排半宽与座位数逐排递增（越靠舞台座位越少）
        const rows = cfg.rows;
        const rowHalfW = new Array(rows);
        const rowSeats = new Array(rows);
        let total = 0;
        for (let r = 0; r < rows; r++) {
            const t = rows > 1 ? r / (rows - 1) : 0;
            const halfW = THREE.MathUtils.lerp(cfg.frontHalfW, cfg.backHalfW, t);
            const usable = halfW - cfg.aisleHalf - cfg.seatInset * 2;
            const n = Math.max(1, Math.floor(usable / cfg.seatPitch) + 1);
            rowHalfW[r] = halfW;
            rowSeats[r] = n;
            total += n * 2; // 左右两个看台块
        }

        const cushions = new THREE.InstancedMesh(cushionGeo, velvetMat, total);
        const backs = new THREE.InstancedMesh(backGeo, velvetDarkMat, total);
        const armsL = new THREE.InstancedMesh(armGeo, darkTrimMat, total);
        const armsR = new THREE.InstancedMesh(armGeo, darkTrimMat, total);
        const legs = new THREE.InstancedMesh(legGeo, darkTrimMat, total);
        const bases = new THREE.InstancedMesh(baseGeo, goldMat, total);
        for (const im of [cushions, backs, armsL, armsR, legs, bases]) {
            im.castShadow = true; im.receiveShadow = true;
        }

        const dummy = new THREE.Object3D();
        let idx = 0;
        app.seats = app.seats || [];

        for (let r = 0; r < rows; r++) {
            const riserTop = cfg.riserBase + r * cfg.riserStep;
            const z = cfg.frontZ + r * cfg.rowSpacing;
            const halfW = rowHalfW[r];
            const n = rowSeats[r];

            // 左右看台实体（梯形，宽度随排变化）
            for (const side of [-1, 1]) {
                const lo = side * cfg.aisleHalf;
                const hi = side * halfW;
                const x0 = Math.min(lo, hi), x1 = Math.max(lo, hi);
                const riser = new THREE.Mesh(
                    new THREE.BoxGeometry(x1 - x0, riserTop, cfg.riserDepth),
                    woodFloorMat
                );
                riser.position.set((x0 + x1) / 2, riserTop / 2, z);
                riser.castShadow = true; riser.receiveShadow = true; scene.add(riser);
                addBoxCollider('seating', x0 - 0.3, x1 + 0.3, z - cfg.riserDepth / 2 - 0.3, z + cfg.riserDepth / 2 + 0.3);

                // 座椅实例：从中央过道向外排布
                for (let sIdx = 0; sIdx < n; sIdx++) {
                    const x = side * (cfg.aisleHalf + cfg.seatInset + sIdx * cfg.seatPitch);

                    // 坐垫（略靠前）
                    dummy.position.set(x, riserTop + 0.42, z - 0.05);
                    dummy.rotation.set(0, 0, 0);
                    dummy.updateMatrix(); cushions.setMatrixAt(idx, dummy.matrix);

                    // 靠背（略后倾，贴合人体）
                    dummy.position.set(x, riserTop + 0.76, z + 0.28);
                    dummy.rotation.set(-0.18, 0, 0);
                    dummy.updateMatrix(); backs.setMatrixAt(idx, dummy.matrix);

                    // 左右扶手
                    dummy.position.set(x - 0.27, riserTop + 0.58, z - 0.03);
                    dummy.rotation.set(0, 0, 0);
                    dummy.updateMatrix(); armsL.setMatrixAt(idx, dummy.matrix);
                    dummy.position.set(x + 0.27, riserTop + 0.58, z - 0.03);
                    dummy.updateMatrix(); armsR.setMatrixAt(idx, dummy.matrix);

                    // 立柱 + 地座
                    dummy.position.set(x, riserTop + 0.16, z - 0.03);
                    dummy.updateMatrix(); legs.setMatrixAt(idx, dummy.matrix);
                    dummy.position.set(x, riserTop + 0.03, z - 0.03);
                    dummy.updateMatrix(); bases.setMatrixAt(idx, dummy.matrix);

                    // 记录可坐坐标（相机眼位 + 面向舞台(-Z)的 yaw + 起身落点）
                    app.seats.push({
                        eyeX: x, eyeY: riserTop + 0.92, eyeZ: z + 0.05,
                        yaw: 0,
                        standX: side * 0.6, standY: STAND_EYE, standZ: z
                    });

                    idx++;
                }

                // 每排看台内侧面新增连接中央过道的楼梯（左右两个看台块各一组）
                buildRowStairs(side, riserTop, z);
            }
        }

        cushions.count = backs.count = armsL.count = armsR.count = legs.count = bases.count = idx;
        for (const im of [cushions, backs, armsL, armsR, legs, bases]) im.instanceMatrix.needsUpdate = true;
        scene.add(cushions, backs, armsL, armsR, legs, bases);
    }

    // ============================================================
    // 二层悬空观看台（贴后墙与侧墙、向前悬挑，规模小于一层主观众区）
    // ============================================================
    function buildBalcony() {
        const cfg = CONCERT.balcony;
        const w = cfg.halfW * 2;
        const depth = cfg.backZ - cfg.frontZ;
        const slabThick = 0.35;
        const slabY = cfg.floorY - slabThick / 2;

        // 悬挑台面
        const slab = new THREE.Mesh(new THREE.BoxGeometry(w, slabThick, depth), woodFloorMat);
        slab.position.set(0, slabY, (cfg.frontZ + cfg.backZ) / 2);
        slab.castShadow = true; slab.receiveShadow = true; scene.add(slab);

        // —— 前缘弧形外凸护栏：分段鎏金浮雕立面 + 天鹅绒软垫扶手 ——
        const parapetH = 0.95, parapetThick = 0.16;
        const segs = 12;                       // 分段数，越多弧形越平滑
        const bowAmt = 1.1;                    // 中部向舞台外凸幅度（米）
        for (let i = 0; i < segs; i++) {
            const t0 = i / segs, t1 = (i + 1) / segs;
            const x0 = -w / 2 + w * t0, x1 = -w / 2 + w * t1;
            const cx = (x0 + x1) / 2;
            // 抛物线外凸（中央最突出）
            const bulge = bowAmt * (1 - Math.pow((cx / (w / 2)), 2));
            const segW = (x1 - x0) * 1.02;
            // 鎏金浮雕立面（朝向舞台，分段贴合弧线）
            const panel = new THREE.Mesh(new THREE.BoxGeometry(segW, parapetH, parapetThick), goldOrnMat);
            panel.position.set(cx, cfg.floorY + parapetH / 2, cfg.frontZ - bulge - parapetThick / 2);
            panel.castShadow = true; panel.receiveShadow = true; scene.add(panel);
            // 立面鎏金分隔竖梃（洛可可分隔感）
            const stile = new THREE.Mesh(new THREE.BoxGeometry(0.07, parapetH, parapetThick + 0.03), goldMat);
            stile.position.set(x0, cfg.floorY + parapetH / 2, cfg.frontZ - bowAmt * (1 - Math.pow((x0 / (w / 2)), 2)) - parapetThick / 2);
            scene.add(stile);
            // 顶部天鹅绒软垫扶手（暖红，触感）
            const cap = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, segW, 3, 8), velvetMat);
            cap.rotation.z = Math.PI / 2;
            cap.position.set(cx, cfg.floorY + parapetH + 0.05, cfg.frontZ - bulge - parapetThick / 2);
            scene.add(cap);
        }
        // 台面底沿连续鎏金线脚（发光暖金，参考图中包厢下沿灯带）
        const facia = new THREE.Mesh(
            new THREE.BoxGeometry(w, 0.12, 0.18),
            new THREE.MeshStandardMaterial({
                color: 0xd4b06a, emissive: 0xffc266, emissiveIntensity: 0.9,
                roughness: 0.35, metalness: 0.85, envMapIntensity: 1.3
            })
        );
        facia.position.set(0, cfg.floorY - slabThick, cfg.frontZ - 0.09);
        scene.add(facia);

        // —— 包厢立柱（护栏下沿分段竖立鎏金小柱，呼应立面分隔） ——
        for (let i = 0; i <= segs; i += 2) {
            const cx = -w / 2 + w * (i / segs);
            const bulge = bowAmt * (1 - Math.pow((cx / (w / 2)), 2));
            const col = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, slabThick + parapetH, 10), goldMat);
            col.position.set(cx, cfg.floorY - slabThick / 2 + (slabThick + parapetH) / 2 - slabThick, cfg.frontZ - bulge - parapetThick / 2);
            scene.add(col);
        }

        // —— 楼座立面下方支撑：鎏金涡卷牛腿（间隔，呼应侧墙壁柱） ——
        for (let x = -10; x <= 10; x += 2.5) {
            const corbel = new THREE.Group();
            const scroll = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.11, 8, 20, Math.PI * 1.4), goldOrnMat);
            scroll.rotation.z = Math.PI; scroll.rotation.y = Math.PI / 2; corbel.add(scroll);
            const dropFinial = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.26, 8), goldMat);
            dropFinial.position.set(0, -0.28, 0); dropFinial.rotation.x = Math.PI; corbel.add(dropFinial);
            corbel.position.set(x, cfg.floorY - slabThick - 0.18, cfg.frontZ - 0.12);
            scene.add(corbel);
        }

        // 座椅（3 排，面向舞台 -Z）
        const rows = cfg.seats;
        const usable = w - 1.2;
        const seatsPerRow = Math.max(1, Math.floor(usable / cfg.seatPitch));
        const total = rows * seatsPerRow;
        const cushionGeo = new RoundedBoxGeometry(0.52, 0.14, 0.50, 3, 0.035);
        const backGeo = new RoundedBoxGeometry(0.50, 0.66, 0.09, 3, 0.045);
        const cushions = new THREE.InstancedMesh(cushionGeo, velvetMat, total);
        const backs = new THREE.InstancedMesh(backGeo, velvetDarkMat, total);
        cushions.castShadow = true; cushions.receiveShadow = true;
        backs.castShadow = true; backs.receiveShadow = true;

        const startZ = cfg.frontZ + 1.6, endZ = cfg.backZ - 1.2;
        const dummy = new THREE.Object3D();
        let idx = 0;
        for (let r = 0; r < rows; r++) {
            const z = startZ + (rows > 1 ? r / (rows - 1) : 0) * (endZ - startZ);
            for (let s = 0; s < seatsPerRow; s++) {
                const x = -usable / 2 + cfg.seatPitch / 2 + s * cfg.seatPitch;
                dummy.position.set(x, cfg.floorY + 0.42, z - 0.05);
                dummy.rotation.set(0, 0, 0);
                dummy.updateMatrix(); cushions.setMatrixAt(idx, dummy.matrix);
                dummy.position.set(x, cfg.floorY + 0.76, z + 0.28);
                dummy.rotation.set(-0.18, 0, 0);
                dummy.updateMatrix(); backs.setMatrixAt(idx, dummy.matrix);
                idx++;
            }
        }
        cushions.count = backs.count = idx;
        cushions.instanceMatrix.needsUpdate = true;
        backs.instanceMatrix.needsUpdate = true;
        scene.add(cushions, backs);
    }

    // ============================================================
    // 灯具模型（吊灯 / 壁灯 / 灯桥 / 地脚灯）
    // ============================================================
    function createChandelier(x, y, z) {
        const g = new THREE.Group();

        // 精致材质：高亮烛光灯泡 / 象牙蜡烛 / 通透水晶
        const bulbMat = new THREE.MeshStandardMaterial({
            color: 0xfff6e2, emissive: 0xffe2b0, emissiveIntensity: 2.4
        });
        const candleMat = new THREE.MeshStandardMaterial({
            color: 0xf5ead0, roughness: 0.5, metalness: 0.0
        });
        const crystalMat = new THREE.MeshPhysicalMaterial({
            color: 0xf2f7ff, roughness: 0.03, metalness: 0.0,
            clearcoat: 1.0, clearcoatRoughness: 0.04,
            envMapIntensity: 2.8, ior: 1.6,
            transparent: true, opacity: 0.92
        });

        // 顶部吊链 / 吊杆 + 尖顶装饰
        const rodLen = (H - y) + 0.4;
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.05, rodLen, 12), goldMat);
        rod.position.y = (H - y) / 2 - 0.2; g.add(rod);
        const finial = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.26, 12), goldMat);
        finial.position.y = (H - y); g.add(finial);
        // 顶部吊环花盘
        const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), goldOrnMat);
        canopy.position.y = (H - y) - 0.05; canopy.scale.y = 0.6; g.add(canopy);

        // 中央主轴（多段收束球茎，增加层次）
        const spindleSegs = [
            { y: -0.20, h: 0.30, rt: 0.07, rb: 0.09 },
            { y: -0.52, h: 0.34, rt: 0.05, rb: 0.07 },
            { y: -0.92, h: 0.46, rt: 0.04, rb: 0.06 },
            { y: -1.42, h: 0.52, rt: 0.03, rb: 0.05 }
        ];
        for (const s of spindleSegs) {
            const seg = new THREE.Mesh(new THREE.CylinderGeometry(s.rt, s.rb, s.h, 16), goldMat);
            seg.position.y = s.y; g.add(seg);
            const knob = new THREE.Mesh(new THREE.SphereGeometry(s.rb * 1.5, 12, 10), goldOrnMat);
            knob.position.y = s.y - s.h / 2; g.add(knob);
        }

        // —— 多层环形灯臂（金环 + 卷叶支臂 + 蜡烛 + 灯泡 + 水晶珠链） ——
        const tiers = [
            { y: -0.12, r: 0.50, arms: 8 },
            { y: -0.55, r: 0.88, arms: 12 },
            { y: -1.00, r: 1.26, arms: 18 }
        ];
        const bulbs = [];
        for (const tier of tiers) {
            const ring = new THREE.Mesh(new THREE.TorusGeometry(tier.r, 0.032, 12, 72), goldMat);
            ring.rotation.x = Math.PI / 2; ring.position.y = tier.y; g.add(ring);
            // 环下第二道细金环（加厚感）
            const ring2 = new THREE.Mesh(new THREE.TorusGeometry(tier.r * 0.94, 0.02, 10, 64), goldMat);
            ring2.rotation.x = Math.PI / 2; ring2.position.y = tier.y - 0.05; g.add(ring2);

            for (let i = 0; i < tier.arms; i++) {
                const a = (i / tier.arms) * Math.PI * 2;
                const dx = Math.cos(a), dz = Math.sin(a);
                // 卷叶支臂（斜向弯曲的锥形盒，近似洛可可卷臂）
                const arm = new THREE.Mesh(new THREE.BoxGeometry(tier.r, 0.03, 0.024), goldMat);
                arm.position.set(dx * tier.r / 2, tier.y + 0.03 + tier.r * 0.10, dz * tier.r / 2);
                arm.rotation.y = -a; arm.rotation.z = -0.18; g.add(arm);
                // 蜡烛托碟
                const dripPan = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.04, 0.02, 10), goldMat);
                dripPan.position.set(dx * tier.r, tier.y + 0.12, dz * tier.r); g.add(dripPan);
                // 蜡烛
                const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.034, 0.22, 10), candleMat);
                candle.position.set(dx * tier.r, tier.y + 0.22, dz * tier.r); g.add(candle);
                // 灯泡（烛火，细长水滴形更逼真）
                const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.040, 10, 8), bulbMat);
                bulb.scale.y = 1.5;
                bulb.position.set(dx * tier.r, tier.y + 0.38, dz * tier.r); g.add(bulb);
                bulbs.push(bulb);
            }

            // 该层环下水晶珠链帘（垂直小珠串，华丽垂坠感）
            const strandCount = tier.arms;
            for (let i = 0; i < strandCount; i++) {
                const a = ((i + 0.5) / strandCount) * Math.PI * 2;
                const sx = Math.cos(a) * tier.r, sz = Math.sin(a) * tier.r;
                const beads = 5;
                for (let bN = 0; bN < beads; bN++) {
                    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.020, 6, 5), crystalMat);
                    bead.position.set(sx * (1 - bN * 0.03), tier.y - 0.08 - bN * 0.075, sz * (1 - bN * 0.03));
                    g.add(bead);
                }
            }
        }

        // —— 层间水晶垂链（上环 → 下环，斜向连接的珠帘，构成穹形罩） ——
        for (let t = 0; t < tiers.length - 1; t++) {
            const up = tiers[t], dn = tiers[t + 1];
            const links = dn.arms;
            for (let i = 0; i < links; i++) {
                const a = (i / links) * Math.PI * 2;
                const steps = 6;
                for (let sIdx = 0; sIdx <= steps; sIdx++) {
                    const f = sIdx / steps;
                    const rr = THREE.MathUtils.lerp(up.r * 0.98, dn.r * 0.98, f);
                    const yy = THREE.MathUtils.lerp(up.y, dn.y, f);
                    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.017, 6, 5), crystalMat);
                    bead.position.set(Math.cos(a) * rr, yy, Math.sin(a) * rr);
                    g.add(bead);
                }
            }
        }

        // —— 底部大型水晶吊坠群（外环 + 中环 + 中央主坠） ——
        const dropCount = 24, dropR = 1.20;
        for (let i = 0; i < dropCount; i++) {
            const a = (i / dropCount) * Math.PI * 2 + 0.06;
            const drop = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.24, 8), crystalMat);
            drop.position.set(Math.cos(a) * dropR, -1.32, Math.sin(a) * dropR);
            drop.rotation.x = Math.PI; g.add(drop);
            const capBead = new THREE.Mesh(new THREE.SphereGeometry(0.024, 6, 5), crystalMat);
            capBead.position.set(Math.cos(a) * dropR, -1.16, Math.sin(a) * dropR); g.add(capBead);
        }
        const midCount = 12, midR = 0.62;
        for (let i = 0; i < midCount; i++) {
            const a = (i / midCount) * Math.PI * 2;
            const drop = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.30, 8), crystalMat);
            drop.position.set(Math.cos(a) * midR, -1.62, Math.sin(a) * midR);
            drop.rotation.x = Math.PI; g.add(drop);
        }
        // 中央主坠（多段：球 + 大锥 + 尖珠）
        const centreBall = new THREE.Mesh(new THREE.SphereGeometry(0.10, 14, 12), crystalMat);
        centreBall.position.y = -1.78; g.add(centreBall);
        const centreDrop = new THREE.Mesh(new THREE.ConeGeometry(0.10, 0.42, 12), crystalMat);
        centreDrop.position.y = -2.06; centreDrop.rotation.x = Math.PI; g.add(centreDrop);
        const centreTip = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), bulbMat);
        centreTip.position.y = -2.30; g.add(centreTip);

        g.position.set(x, y, z);
        scene.add(g);
        g.userData.bulbs = bulbs;
        return g;
    }

    function createSconce(x, y, z, facing) {
        const g = new THREE.Group();
        // 鎏金背板（卷叶饰）
        const backplate = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.42, 0.16), goldOrnMat);
        g.add(backplate);
        // 伸出支臂
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.30, 8), goldMat);
        arm.rotation.x = Math.PI / 2; arm.position.set(0, 0.10, 0.14); g.add(arm);
        // 烛杯 + 蜡烛 + 双火焰灯泡
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.05, 0.05, 12), goldMat);
        cup.position.set(0, 0.12, 0.28); g.add(cup);
        const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.18, 8),
            new THREE.MeshStandardMaterial({ color: 0xf5ead0, roughness: 0.5 }));
        candle.position.set(0, 0.22, 0.28); g.add(candle);
        const flame = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6),
            new THREE.MeshStandardMaterial({ color: 0xfff0d0, emissive: 0xffcf8f, emissiveIntensity: 2.2 }));
        flame.scale.y = 1.6; flame.position.set(0, 0.34, 0.28); g.add(flame);
        // 上方第二支小烛
        const flame2 = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6),
            new THREE.MeshStandardMaterial({ color: 0xfff0d0, emissive: 0xffcf8f, emissiveIntensity: 2.0 }));
        flame2.scale.y = 1.5; flame2.position.set(0, 0.52, 0.10); g.add(flame2);
        // 底部吊坠水晶
        const drop = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.10, 6),
            new THREE.MeshPhysicalMaterial({ color: 0xf2f7ff, roughness: 0.05, envMapIntensity: 2.0, transparent: true, opacity: 0.9 }));
        drop.rotation.x = Math.PI; drop.position.set(0, -0.26, 0.05); g.add(drop);
        g.position.set(x, y, z);
        g.rotation.y = facing;
        scene.add(g);
    }

    function createFootlight(x, z, color = 0xffd9a0) {
        const strip = new THREE.Mesh(
            new THREE.BoxGeometry(0.7, 0.02, 0.03),
            new THREE.MeshStandardMaterial({
                color,
                emissive: color,
                emissiveIntensity: 0.7,
                roughness: 0.85,
                metalness: 0.0
            })
        );
        strip.position.set(x, 0.03, z); strip.rotation.y = Math.PI / 2; scene.add(strip);
    }

    // ============================================================
    // 软粒子纹理（径向渐变圆斑）：让尘埃呈柔和光斑而非硬边方块，增强朦胧/辉光质感
    // ============================================================
    function createSoftParticleTexture(size = 64) {
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const ctx = c.getContext('2d');
        const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
        return new THREE.CanvasTexture(c);
    }

    // ============================================================
    // 尘埃粒子
    // ============================================================
    function createDust(x, z, opts = {}) {
        const count = opts.count || 90;
        const spread = opts.spread || 8;
        const size = opts.size || 0.05;
        const opacity = opts.opacity || 0.3;
        const color = opts.color || 0xf5deb0;
        const ySpread = opts.ySpread ?? H;
        const drift = opts.drift || 1.0;
        const map = opts.map || null;

        const positions = new Float32Array(count * 3);
        const velocities = [];
        const half = spread / 2;
        for (let i = 0; i < count; i++) {
            positions[i * 3] = x + (Math.random() - 0.5) * spread;
            positions[i * 3 + 1] = Math.random() * ySpread;
            positions[i * 3 + 2] = z + (Math.random() - 0.5) * spread;
            velocities.push({
                x: (Math.random() - 0.5) * 0.004 * drift,
                y: (Math.random() - 0.5) * 0.0015 * drift,
                z: (Math.random() - 0.5) * 0.004 * drift
            });
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const mat = new THREE.PointsMaterial({
            color, size, map, transparent: true, opacity,
            blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
        });
        const points = new THREE.Points(geo, mat);
        scene.add(points);
        app.dustSystems.push({ points, velocities, positions, x, z, half, ySpread });
    }

    // ============================================================
    // 体积光 / 上帝光（God Ray）：钢琴上方聚光灯打出的一束可见光柱
    // 用「截锥 + 自发光径向渐变」的加法混合实现，边缘柔和、无模糊，
    // 与既有尘埃粒子叠加后形成可见光柱的史诗大气感。
    // ============================================================
    function createSpotlightGodRay(x, yTop, yBottom, z, opts = {}) {
        const h = yTop - yBottom;
        const yMid = (yTop + yBottom) / 2;
        const bottomR = opts.bottomR ?? 2.4;
        const topR = opts.topR ?? 0.8;
        const intensity = opts.intensity ?? 0.6;
        const color = new THREE.Color(opts.color ?? 0xffe6ba);

        const geo = new THREE.CylinderGeometry(topR, bottomR, h, 48, 1, true);
        const mat = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            uniforms: {
                uColor: { value: color },
                uIntensity: { value: intensity },
                uRadius: { value: bottomR },
                uTopRadius: { value: topR },
                uHeight: { value: h }
            },
            vertexShader: `
                varying vec2 vLocal;
                varying float vY;
                void main() {
                    vLocal = position.xz;
                    vY = position.y;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 uColor;
                uniform float uIntensity;
                uniform float uRadius;
                uniform float uTopRadius;
                uniform float uHeight;
                varying vec2 vLocal;
                varying float vY;
                void main() {
                    float y01 = clamp(vY / uHeight + 0.5, 0.0, 1.0);
                    float r = mix(uRadius, uTopRadius, y01);
                    float d = length(vLocal);
                    float radial = 1.0 - smoothstep(r * 0.5, r, d);
                    float vert = smoothstep(0.0, 0.10, y01) * (1.0 - smoothstep(0.88, 1.0, y01));
                    float alpha = radial * vert * uIntensity;
                    gl_FragColor = vec4(uColor, alpha);
                }
            `
        });
        const shaft = new THREE.Mesh(geo, mat);
        shaft.position.set(x, yMid, z);
        shaft.renderOrder = 999;   // 最后绘制，避免与其它透明体层级冲突
        scene.add(shaft);
        app.godRay = shaft;
        return shaft;
    }

    // ============================================================
    // Eastman Theater 真实剧院环境（替代程序化大厅）
    // - 加载 eastman_theater.glb（Draco 网格压缩 + WebP 贴图）
    // - 原版模型原样加载（不做材质合并），忠实还原材质细节 / 自发光壁灯 / 光影
    // - 对齐逻辑舞台：模型舞台面中心 ≡ CONCERT.stage，钢琴/演奏者/屏幕坐标零改动
    // - 逻辑碰撞沿用舞台三边+阶梯；外墙按模型实测包围盒
    // THEATER_FIT 数值由 GLB 节点包围盒实测标定（_theater_glb_analyze.mjs）：
    // - 舞台台体 G-Object.9441：15.22 x 1.00 x 12.17，台面中心 (3.43, 0.85, -2.94)
    // - 大吊灯 Big_Chandelier：模型坐标 (3.2, 9.1, 5.7)，对齐后世界 (-0.2, 9.35, -2.7)
    // ============================================================
    const THEATER_FIT = {
        rotY: 0,                              // 模型朝向已正确（舞台在 -Z、观众席在 +Z，实测确认）
        modelStageCenter: [3.43, 0.85, -2.94], // 模型局部：舞台台面中心 [x,y,z]（G-Object.9441 实测）
        chandelierLights: [[-0.2, 6.7, -2.7], [0, 8.5, 4]], // 大吊灯下方暖光点 + 观众席中区补充
        wallMargin: 0.5,                      // 外墙碰撞内缩（米；过大曾在门厅形成离可见墙 1m 的空气墙）
    };

    // —— 加载时最小干预：仅剔除观众人偶 + 舞台演出道具，门板摘出单独装配，扶手采集生成座椅 ——
    // 舞台演出道具剔除：Cinema Opera House 自带三角钢琴（SM_grandpiano01_01 / SM_Piano02）与
    // 乐队摆台（麦克风架 MicroStand / 谱架 NoteStand / 乐谱 NoteSheets），与我们的 Steinway 冲突。
    // 按「节点名精确匹配 + 舞台 footprint」双重条件删除（节点名经 _analyze_opera2.mjs 实测标定）。
    const STAGE_PROP_REGION = { x0: 15, x1: 40, z0: -16, z1: 16 };
    const STAGE_PROP_REGEX = /grandpiano|SM_Piano|MicroStand|NoteStand|NoteSheets|SM_Chair/i;
    const _propCtr = new THREE.Vector3();
    let propRemoved = 0;
    function isStageProp(obj) {
        if (!STAGE_PROP_REGEX.test(obj.name)) return false;
        // 用世界位置判断（模型原样加载，道具位移在父节点上，局部几何中心对不上 footprint）
        obj.getWorldPosition(_propCtr);
        if (_propCtr.x < STAGE_PROP_REGION.x0 || _propCtr.x > STAGE_PROP_REGION.x1) return false;
        if (_propCtr.z < STAGE_PROP_REGION.z0 || _propCtr.z > STAGE_PROP_REGION.z1) return false;
        return true;
    }
    // Opera House 为 UE 空剧场导出（无观众人偶），AUDIENCE_REGEX 设为永不匹配。
    const AUDIENCE_REGEX = /a^/;
    // —— 门板/把手：合并时排除，单独装配为可转动的门（玩家靠近自动开启） ——
    const DOOR_PANEL_REGEX = /C-Component#10/i;
    const DOOR_HANDLE_REGEX = /C-Ext[._]?[ _]?Door[ _]Handle/i;
    // —— 座椅扶手：收集中心点用于生成落座锚点（扶手仍参与正常合并渲染） ——
    const ARM_STAND_REGEX = /seat[ _]arm[ _]stand/i;
    const doorParts = [];      // { name, matrix, geo, material }（模型局部矩阵）
    const armStands = [];      // 模型局部中心点 Vector3
    const armGroups = new Map();   // 扶手节点 key -> 图元中心数组（多图元节点按父 Group 聚合）
    let audienceRemoved = 0;
    const _armBox = new THREE.Box3();
    const _armCtr = new THREE.Vector3();

    function prepareTheaterModel(model) {
        model.updateMatrixWorld(true);

        // 修复 UV1 通道引用：opera_house_opt.glb 的聚光灯玻璃材质（M_Glass01_SM_SpotlightBig*）
        // 在 GLB 中声明 texCoord=1（采样 UV1），但对应网格只提供 uv0。这会让 GLSL 编译报错
        // "'uv1' : undeclared identifier"，并在部分浏览器上中断整帧渲染（表现为全黑屏）。
        // 这里把所有贴图采样通道强制回退到 uv0，消除该着色器错误。
        let uv1Fixed = 0;
        model.traverse((o) => {
            if (!o.isMesh) return;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) {
                if (!m) continue;
                for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'lightMap', 'clearcoatMap', 'sheenColorMap', 'transmissionMap']) {
                    const t = m[key];
                    if (t && t.channel && t.channel !== 0) { t.channel = 0; uv1Fixed++; }
                }
            }
        });
        if (uv1Fixed) console.log('[theater] 已修复 UV1 通道引用（回退到 uv0）:', uv1Fixed, '个贴图');

        const toRemove = [];
        model.traverse((obj) => {
            if (!obj.isMesh) return;
            if (AUDIENCE_REGEX.test(obj.name)) { audienceRemoved++; toRemove.push(obj); return; }
            if (DOOR_PANEL_REGEX.test(obj.name) || DOOR_HANDLE_REGEX.test(obj.name)) {
                doorParts.push({ name: obj.name, matrix: obj.matrixWorld.clone(), geo: obj.geometry, material: obj.material });
                toRemove.push(obj); return;
            }
            if (ARM_STAND_REGEX.test(obj.name)) {
                // 多图元节点（GLTFLoader 拆为 Group+子 Mesh）：按父 Group 聚合，图元中心取平均
                const owner = (obj.parent && ARM_STAND_REGEX.test(obj.parent.name)) ? obj.parent : obj;
                _armBox.setFromObject(obj); _armBox.getCenter(_armCtr);
                const arr = armGroups.get(owner.uuid);
                if (arr) arr.push(_armCtr.clone());
                else armGroups.set(owner.uuid, [_armCtr.clone()]);
            }
            if (isStageProp(obj)) { propRemoved++; toRemove.push(obj); return; }
            // 其余网格原样保留：不做材质合并，忠实还原原版材质参数 / UV / 顶点色 / 光影
        });
        for (const obj of toRemove) obj.removeFromParent();
        // 扶手图元聚合 → 每节点唯一中心（多图元取平均）
        for (const arr of armGroups.values()) {
            const c = new THREE.Vector3();
            for (const v of arr) c.add(v);
            armStands.push(c.multiplyScalar(1 / arr.length));
        }
        // 统计剩余网格数（原样加载，忠实保留原版细节；draw call 数量由原版模型节点决定）
        let meshCount = 0;
        model.traverse((o) => { if (o.isMesh) meshCount++; });
        console.log('[theater] 原版模型原样加载: meshes=', meshCount,
            '| 剔除舞台道具=', propRemoved, '| 剔除观众人偶=', audienceRemoved,
            '| 扶手采集=', armStands.length, '| 门部件=', doorParts.length);
        return model;
    }

    // ============================================================
    // 剧院座椅锚点（由 1764 个扶手中心配对生成 ~880 个座位）
    // 分层：池座(armY<2) / 楼座1(2.5~7.3) / 楼座2(>7.3)；
    // 每席 = 相邻两个扶手（x 间距 0.44，座间 0.04）的中点。
    // ============================================================
    const TIER1_FLOOR = (z) => 2.776 + 0.3709 * z;   // 楼座1 坡面（扶手回归 - 0.305）
    const TIER2_FLOOR = (z) => 6.956 + 0.3709 * z;   // 楼座2 坡面
    function generateTheaterSeats() {
        const rotM = new THREE.Matrix4().makeRotationY(THEATER_FIT.rotY);
        const off = app.theater.position;
        const arms = armStands.map(v => v.clone().applyMatrix4(rotM).add(off));
        app.seats = [];
        const used = new Uint8Array(arms.length);
        // 扶手配对（互最近邻）：每席左右扶手 x 距 0.3~0.65（实测席内 0.54、席间隔 0.044）。
        // 只有互为最近邻才配成一席，避免排内 x 序列（席内/席间交替）导致错配。
        const nearestOf = (i) => {
            const a = arms[i];
            let bestJ = -1, bestD = 0.65;
            for (let j = 0; j < arms.length; j++) {
                if (j === i || used[j]) continue;
                const b = arms[j];
                if (Math.abs(b.y - a.y) > 0.12 || Math.abs(b.z - a.z) > 0.4) continue;
                const dx = Math.abs(b.x - a.x);
                if (dx > 0.3 && dx < bestD) { bestD = dx; bestJ = j; }
            }
            return bestJ;
        };
        for (let i = 0; i < arms.length; i++) {
            if (used[i]) continue;
            const j = nearestOf(i);
            if (j < 0) { used[i] = 1; continue; }
            if (nearestOf(j) !== i) { used[i] = 1; continue; }   // 非互最近邻（排边缘扶手）不成席
            used[i] = used[j] = 1;
            const a = arms[i], b = arms[j];
            const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2, z = (a.z + b.z) / 2;
            // 分层与楼面高度
            let floorY;
            if (y < 2) floorY = 0.25;
            else if (y < 7.3) floorY = TIER1_FLOOR(z);
            else floorY = TIER2_FLOOR(z);
            // 落座锚点：眼高 ≈ 扶手中心 + 0.9（坐垫 floor+0.45，坐态眼高 +0.75）
            const seat = { eyeX: x, eyeY: y + 0.9, eyeZ: z, yaw: 0 };
            // 起身落点：池座 → 座位前方排间走道（排距 1.55，半距 0.775）；
            // 楼座（排距 1.15 过窄）→ 最近侧过道（左 x=-9.85 / 右 x=9.35）
            if (y < 2) {
                seat.standX = x;
                seat.standZ = z - 0.775;
                seat.standY = 0.25 + STAND_EYE;
            } else {
                seat.standX = x < -0.34 ? -9.85 : 9.35;
                seat.standZ = z;
                seat.standY = floorY + STAND_EYE;
            }
            app.seats.push(seat);
            // 座位碰撞（椅垫核心：x 半宽 0.26 / z 半深 0.15；池座排距宽可穿行排间，楼座仅端部可达）
            addBoxCollider('seat', x - 0.26, x + 0.26, z - 0.15, z + 0.15, floorY, floorY + 0.95);
        }
        console.log('[theater] 座椅锚点=', app.seats.length);
    }

    // ============================================================
    // 后墙 8 组双开门（16 扇门板 + 把手，玩家靠近自动开启）
    // 门板 _C-Component#10：0.91×2.29×0.05 @ z=17.66；把手 C-Ext. Door Handle。
    // 每 4 扇为一组（门套 _C-Component#11 中心 x ≈ -7.77/-2.82/2.14/7.09），
    // 组内按 x 排序配成 2 对双开门；铰链在门外侧边缘，向外(+z)开启。
    // ============================================================
    const DOOR_GROUP_X = [-7.77, -2.82, 2.14, 7.09];
    function buildDoors() {
        const rotM = new THREE.Matrix4().makeRotationY(THEATER_FIT.rotY);
        const off = app.theater.position;
        const panels = [], handles = [];
        const box = new THREE.Box3(), ctr = new THREE.Vector3();
        for (const p of doorParts) {
            const wm = new THREE.Matrix4().makeTranslation(off.x, off.y, off.z).multiply(rotM).multiply(p.matrix);
            if (!p.geo.boundingBox) p.geo.computeBoundingBox();
            box.copy(p.geo.boundingBox).applyMatrix4(wm);
            box.getCenter(ctr);
            const rec = { ...p, wm, cx: ctr.x, cz: ctr.z };
            (DOOR_HANDLE_REGEX.test(p.name) ? handles : panels).push(rec);
        }
        if (!panels.length) { console.warn('[theater] 未找到门板'); return; }
        app.doors = [];
        // 多图元聚合：同一物理门的多个 primitive（门板+玻璃等）中心相近（<0.25m），
        // 合并为一个门扇整体转动，避免开门时两半分离。
        panels.sort((a, b) => a.cx - b.cx || a.cz - b.cz);
        const doorUnits = [];
        for (const p of panels) {
            const u = doorUnits[doorUnits.length - 1];
            if (u && Math.abs(p.cx - u.cx) < 0.25 && Math.abs(p.cz - u.cz) < 0.25) {
                u.parts.push(p);
            } else {
                doorUnits.push({ parts: [p], cx: p.cx, cz: p.cz });
            }
        }
        // 按门套分组 → 组内配对（左扇铰链在 min.x，右扇在 max.x）
        for (const gx of DOOR_GROUP_X) {
            const grp = doorUnits.filter(u => Math.abs(u.cx - gx) < 2.48).sort((a, b) => a.cx - b.cx);
            for (let i = 0; i + 1 < grp.length; i += 2) {
                buildDoorPanel(grp[i], -1, handles);   // 左扇：铰链左缘，向外开（-100°）
                buildDoorPanel(grp[i + 1], 1, handles); // 右扇：铰链右缘，向外开（+100°）
            }
        }
        console.log('[theater] 门装配=', app.doors.length, '扇（图元聚合=', doorUnits.length, '）');
    }
    function buildDoorPanel(unit, side, handles) {
        // 联合包围盒：以全部图元的并集确定门扇中心与铰链位置
        const bb = new THREE.Box3(), tmp = new THREE.Box3();
        for (const p of unit.parts) {
            if (!p.geo.boundingBox) p.geo.computeBoundingBox();
            tmp.copy(p.geo.boundingBox).applyMatrix4(p.wm);
            bb.union(tmp);
        }
        const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
        const hingeX = side < 0 ? bb.min.x : bb.max.x;   // 铰链：门外侧边缘
        const g = new THREE.Group();
        g.position.set(hingeX, 0, cz);
        for (const p of unit.parts) {
            const geo = p.geo.clone().applyMatrix4(p.wm);
            geo.translate(-hingeX, 0, -cz);
            const mesh = new THREE.Mesh(geo, p.material);
            mesh.receiveShadow = true;
            g.add(mesh);
        }
        // 最近的把手随门转动
        let hBest = null, hD = 0.7;
        for (const h of handles) {
            const d = Math.hypot(h.cx - cx, h.cz - cz);
            if (d < hD) { hD = d; hBest = h; }
        }
        if (hBest) {
            const hg = hBest.geo.clone().applyMatrix4(hBest.wm);
            hg.translate(-hingeX, 0, -cz);
            g.add(new THREE.Mesh(hg, hBest.material));
            handles.splice(handles.indexOf(hBest), 1);
        }
        scene.add(g);
        const collider = addBoxCollider('door', bb.min.x, bb.max.x, 17.6, 17.72, 0.2, 2.55);
        app.doors.push({ group: g, x: cx, z: cz, sign: side, cur: 0, collider });
    }

    // ============================================================
    // 后部双跑大楼梯（模型无楼梯几何，自建）：
    //   S1 池座(0.25) → 楼座1 后连廊(7.0)，沿 x 爬升 17m；
    //   S2 楼座1(7.0) → 楼座2 后连廊(11.11)，反向爬升；
    //   两跑平行贴后墙（z 11.6~13.4），下方留门厅通道（净高 ≥2.1）。
    // ============================================================
    function buildRearStairs() {
        const g = new THREE.Group();
        g.name = 'rearStairs';
        const stepMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.72, metalness: 0.05 });
        const steelMat = new THREE.MeshStandardMaterial({ color: 0x17171c, roughness: 0.45, metalness: 0.65 });
        const stepGeos = [], steelGeos = [];
        const box = (arr, w, h, d, cx, cy, cz, rotZ = 0) => {
            const geo = new THREE.BoxGeometry(w, h, d);
            if (rotZ) geo.rotateZ(rotZ);
            geo.translate(cx, cy, cz);
            arr.push(geo);
        };
        // —— S1：38 步，踏面 0.447 / 踢面 0.178，x -8.5→8.5，y 0.25→7.0 ——
        const n1 = 38, tr1 = 17 / n1, r1 = 6.75 / n1;
        for (let i = 0; i < n1; i++) {
            box(stepGeos, tr1 + 0.02, 0.07, 0.94, -8.5 + (i + 0.5) * tr1, 0.25 + (i + 1) * r1 - 0.035, 12.05);
        }
        // —— S2：24 步，踏面 0.708 / 踢面 0.171，x 8.5→-8.5，y 7.0→11.11 ——
        const n2 = 24, tr2 = 17 / n2, r2 = 4.11 / n2;
        for (let i = 0; i < n2; i++) {
            box(stepGeos, tr2 + 0.02, 0.07, 0.94, 8.5 - (i + 0.5) * tr2, 7.0 + (i + 1) * r2 - 0.035, 12.95);
        }
        // —— 斜梁 + 扶手顶管（S1 斜率 +0.397，S2 -0.242）——
        const L1 = Math.hypot(17, 6.75), a1 = Math.atan2(6.75, 17);
        const L2 = Math.hypot(17, 4.11), a2 = -Math.atan2(4.11, 17);
        for (const z of [11.56, 12.54]) {
            box(steelGeos, L1, 0.55, 0.05, 0, 3.62, z, a1);            // S1 斜梁
            box(steelGeos, L1, 0.06, 0.06, 0, 4.63, z, a1);           // S1 顶管
        }
        for (const z of [12.56, 13.44]) {
            box(steelGeos, L2, 0.55, 0.05, 0, 9.05, z, a2);            // S2 斜梁
            box(steelGeos, L2, 0.06, 0.06, 0, 10.06, z, a2);           // S2 顶管
        }
        // —— 连廊楼板（悬挑：侧缘挑梁）——
        box(stepGeos, 2.56, 0.18, 1.46, 8.78, 6.91, 11.91);            // 楼座1 后连廊
        box(stepGeos, 3.16, 0.18, 2.36, -9.08, 11.02, 12.35);          // 楼座2 后连廊
        box(steelGeos, 2.56, 0.3, 0.06, 8.78, 6.85, 11.25);            // 连廊1 前缘挑梁
        box(steelGeos, 3.16, 0.3, 0.06, -9.08, 10.96, 11.25);          // 连廊2 前缘挑梁
        // —— 连廊护栏（与碰撞一致）——
        box(steelGeos, 0.05, 1.1, 1.42, 7.44, 7.5, 11.91);             // 连廊1 内缘
        box(steelGeos, 1.45, 1.1, 0.05, 9.32, 7.5, 12.56);             // 连廊1 后缘
        box(steelGeos, 0.05, 1.1, 2.3, -7.44, 11.66, 12.35);           // 连廊2 内缘
        box(steelGeos, 3.16, 1.1, 0.05, -9.08, 11.66, 13.44);          // 连廊2 后缘
        // —— 楼座后排缘护栏（防坠落到池座后厅）——
        box(steelGeos, 18.1, 1.1, 0.05, -1.55, 7.55, 11.25);           // 楼座1 后排缘（连廊开口除外）
        box(steelGeos, 17.5, 1.1, 0.05, 1.25, 11.65, 11.25);           // 楼座2 后排缘
        const stepsMesh = new THREE.Mesh(mergeGeometries(stepGeos, false), stepMat);
        const steelMesh = new THREE.Mesh(mergeGeometries(steelGeos, false), steelMat);
        stepsMesh.receiveShadow = steelMesh.receiveShadow = true;
        g.add(stepsMesh, steelMesh);
        scene.add(g);
        app.rearStairs = g;

        // —— 碰撞：S1 前后栏板（3 段拟合坡度，高端下方留通道）、S2 栏板、连廊护栏、排缘 ——
        // S1 前栏低端留 2m 开口（x -8.6~-6.5）：玩家可从池座正面直接迈上楼梯前 4 步
        const s1Rail = [[-6.5, -3, 0.2, 3.5], [-3, 2.5, 2.1, 5.7], [2.5, 8.6, 4.3, 8.1]];
        for (const [x0, x1, y0, y1] of s1Rail) {
            addBoxCollider('s1RailF', x0, x1, 11.5, 11.62, y0, y1);
            if (x1 <= 7.9) addBoxCollider('s1RailB', x0, x1, 12.5, 12.62, y0, y1);
        }
        addBoxCollider('s1RailB', 2.5, 7.9, 12.5, 12.62, 4.3, 8.1);     // S1 后栏高端段（x7.9~8.6 为换乘口）
        const s2Rail = [[-8.6, -3, 9.5, 12.2], [-3, 2.5, 8.2, 10.85], [2.5, 8.6, 6.9, 8.3]];
        for (const [x0, x1, y0, y1] of s2Rail) {
            addBoxCollider('s2RailB', x0, x1, 13.38, 13.5, y0, y1);
            if (x1 <= 7.9) addBoxCollider('s2RailF', x0, x1, 12.5, 12.62, y0, y1);
        }
        addBoxCollider('s2RailF', 2.5, 7.9, 12.5, 12.62, 6.9, 8.3);     // S2 前栏高端段
        addBoxCollider('w1Side', 7.38, 7.5, 11.2, 12.62, 6.9, 8.1);     // 连廊1 内缘
        addBoxCollider('w1Rear', 8.6, 10.05, 12.5, 12.62, 6.9, 8.1);    // 连廊1 后缘
        addBoxCollider('w2Side', -7.5, -7.38, 11.2, 12.5, 11.0, 12.2);  // 连廊2 内缘（z≥12.5 敞开：S2 高端出口）
        addBoxCollider('w2Rear', -10.66, -7.5, 13.38, 13.5, 11.0, 12.2);// 连廊2 后缘
        addBoxCollider('t1Rear', -10.6, 7.5, 11.18, 11.32, 6.9, 8.1);   // 楼座1 后排缘
        addBoxCollider('t2Rear', -7.5, 10.0, 11.18, 11.32, 11.0, 12.2); // 楼座2 后排缘
    }

    function buildTheater() {
        const gltf = app.assets && app.assets.theater;
        if (!gltf || !gltf.scene) {
            console.warn('[theater] 资产缺失：剧院环境未加载（纯黑背景）');
            return null;
        }
        // 只做最小干预：剔除自带钢琴 / 舞台乐队摆台，其余网格与材质原样保留
        prepareTheaterModel(gltf.scene);

        // 原样加载：UE 导出的 GLB 已是世界坐标，CONCERT 常量直接使用模型坐标（舞台 +X、观众席 -X）
        const g = new THREE.Group();
        g.name = 'theater';
        g.add(gltf.scene);
        scene.add(g);
        app.theater = g;
        g.updateMatrixWorld(true);
        const worldBox = new THREE.Box3().setFromObject(g);
        console.log('[theater] 包围盒 min=', worldBox.min.toArray().map(v => +v.toFixed(1)),
            'max=', worldBox.max.toArray().map(v => +v.toFixed(1)));

        // —— 简化碰撞：外墙（按实测包围盒）+ 舞台前缘/两侧 ——
        const m = 0.5;
        addBoxCollider('wallBack', worldBox.min.x - 2, worldBox.max.x + 2, worldBox.min.z - 2, worldBox.min.z + m, -2, 22);
        addBoxCollider('wallLeft', worldBox.min.x - 2, worldBox.min.x + m, worldBox.min.z, worldBox.max.z, -2, 22);
        addBoxCollider('wallRight', worldBox.max.x - m, worldBox.max.x + 2, worldBox.min.z, worldBox.max.z, -2, 22);
        const S = CONCERT.stage;
        // 舞台前缘（x≈15 观众席与舞台交界，留中部台阶口缺省）防误坠
        addBoxCollider('stageFront', S.x0 - 0.4, S.x0 + 0.4, S.z0, S.z1, 0, S.topY + 0.8);
        // 2K PBR 材质增强（Poly Haven CC0 素材替换地面/立柱/幕布贴图）
        enhanceTheaterMaterials(g);
        return g;
    }

    // ============================================================
    // 2K PBR 材质增强：用 Poly Haven（CC0 无版权）素材替换剧院地面/立柱/幕布贴图，
    // 提升真实感与材质细节，同时保持金属/粗糙度/法线/AO 的完整 PBR 通道。
    // 全部为 2K 分辨率以在「画质 vs 负载」间取得平衡。
    // ============================================================
    const THEATER_ENHANCE = {
        parquet: { mats: ['MI_StageFloor01', 'MI_Floor01'], files: ['parquet_diff', 'parquet_nor_gl', 'parquet_rough', 'parquet_ao'] },   // 地面/舞台地板 → 人字拼木地板
        marble:  { mats: ['MI_LargePillar01', 'MI_LargePillar02'], files: ['marble_diff', 'marble_nor_gl', 'marble_rough', 'marble_ao'] }, // 立柱 → 大理石
        velvet:  { mats: ['MI_SceneCurtain', 'MI_BalconyCurtains01'], files: ['velvet_diff', 'velvet_nor_gl', 'velvet_rough', 'velvet_ao'] }, // 幕布 → 丝绒
    };

    async function enhanceTheaterMaterials(theaterGroup) {
        if (!theaterGroup) return;
        const loader = new THREE.TextureLoader();
        try {
            for (const [key, cfg] of Object.entries(THEATER_ENHANCE)) {
                const [df, nr, rg, ao] = cfg.files;
                const [tDiff, tNor, tRough, tAo] = await Promise.all([
                    loader.loadAsync(`assets/textures/${df}.jpg`),
                    loader.loadAsync(`assets/textures/${nr}.jpg`),
                    loader.loadAsync(`assets/textures/${rg}.jpg`),
                    loader.loadAsync(`assets/textures/${ao}.jpg`),
                ]);
                // 颜色图 sRGB、法线/粗糙度/AO 线性；重复平铺 + 各向异性过滤
                tDiff.colorSpace = THREE.SRGBColorSpace;
                for (const t of [tNor, tRough, tAo]) t.colorSpace = THREE.NoColorSpace;
                for (const t of [tDiff, tNor, tRough, tAo]) {
                    t.wrapS = t.wrapT = THREE.RepeatWrapping;
                    t.anisotropy = 8;
                }
                let n = 0;
                theaterGroup.traverse(o => {
                    if (!o.isMesh) return;
                    const mats = Array.isArray(o.material) ? o.material : [o.material];
                    for (const mat of mats) {
                        if (mat && mat.name && cfg.mats.includes(mat.name)) {
                            mat.map = tDiff;
                            mat.normalMap = tNor;
                            mat.roughnessMap = tRough;
                            mat.aoMap = tAo;
                            mat.metalness = 0;      // 木/石/织物均为非金属
                            mat.roughness = 1;      // 由粗糙度贴图完全控制
                            mat.normalScale = new THREE.Vector2(1, 1);
                            mat.needsUpdate = true;
                            n++;
                        }
                    }
                });
                console.log(`[enhance] ${key} 应用到 ${cfg.mats.join(', ')} → ${n} 个材质实例`);
            }
        } catch (err) {
            console.warn('[enhance] 材质增强失败（不影响渲染）', err && err.message ? err.message : err);
        }
    }

    // ============================================================
    // 综合灯光系统（舞台 / 环境 / 观众席）
    // ============================================================
    function buildLighting() {
        RectAreaLightUniformsLib.init();

        // —— 环境基础（电影质感：压低环境光使阴影更深，用更明确的主光塑造立体感） ——
        scene.add(new THREE.AmbientLight(0x33231a, 0.12));
        scene.add(new THREE.HemisphereLight(0xfff3dc, 0x181310, 0.09));
        const keyLight = new THREE.DirectionalLight(0xfff2e0, 0.16);
        keyLight.position.set(10, 16, 5);
        scene.add(keyLight);

        // —— 观众席吊灯暖光（压暗，歌剧厅吊灯分布于观众席上方 y≈14） ——
        for (const [x, z] of [[2, 0], [-6, 0], [-14, 0], [2, -6], [2, 6], [-8, 5]]) {
            const p = new THREE.PointLight(T_WARM_HOUSE, 0.32, 18, 2);
            p.position.set(x, 13, z); scene.add(p);
        }

        // —— 单一钢琴聚光（中等强度，聚焦舞台，场景唯一聚光灯） ——
        const pianoSpot = new THREE.SpotLight(T_PIANO, 1.8, 40, 0.45, 0.6, 1.2);
        pianoSpot.position.set(CONCERT.piano.x, 13, CONCERT.piano.z);
        pianoSpot.target.position.set(CONCERT.piano.x, CONCERT.stage.topY + 0.2, CONCERT.piano.z);
        pianoSpot.target.updateMatrixWorld();
        pianoSpot.castShadow = true;
        pianoSpot.shadow.mapSize.set(2048, 2048);
        pianoSpot.shadow.bias = -0.0005;
        pianoSpot.shadow.focus = 1.0;
        scene.add(pianoSpot); scene.add(pianoSpot.target);
        app.pianoSpot = pianoSpot;
        app.pianoSpotBase = 1.8;

        // —— 舞台侧翼/观众席前排微光 ——
        for (const [x, z] of [[22, -8], [22, 8], [10, 0]]) {
            const p = new THREE.PointLight(T_GOLD, 0.12, 12, 2);
            p.position.set(x, 5, z); scene.add(p);
        }
    }

    // ============================================================
    // 组装
    // ============================================================
    function buildWorld() {
        // —— 环境：Eastman Theater 真实剧院模型（替代程序化大厅） ——
        buildTheater();
        buildLighting();

        // —— 魔法钢琴可视化屏幕（悬于舞台大幕前；原挂接在程序化舞台函数内，剧院化后独立装配） ——
        buildMagicScreen();

        // —— 钢琴（Steinway 真实模型，88 独立琴键） ——
        const gltf = app.assets && app.assets.piano;
        let anchors = null;
        if (gltf && gltf.scene) {
            const res = createSteinwayFromGLB(gltf, CONCERT.piano.x, CONCERT.stage.topY, CONCERT.piano.z, CONCERT.piano.rotY);
            if (res) { app.piano = res.group; anchors = res.anchors; }
        }
        // 琴凳/踏板：钢琴侧放（键盘朝 +Z）时，anchors 的 keyFrontX/keyCenterZ 假设键盘沿 X、不适用于侧放，
        // 直接用 CONCERT.bench 显式坐标（琴凳位于键盘前方 +Z 侧、白/黑键一侧）。
        const benchX = CONCERT.bench.x;
        const benchZ = CONCERT.bench.z;
        createPianoBench(benchX, benchZ, CONCERT.bench.rotY);

        // 延音踏板：置于键盘下方（钢琴 +Z 侧演奏者右脚下）
        createSustainPedal(CONCERT.piano.x, CONCERT.stage.topY, CONCERT.piano.z + 0.35);

        // 尘埃（聚光聚焦的舞台区域更密集、更高亮，观众席与厅内自然飘散）；
        // 统一采用软粒子纹理，呈现柔和光斑，增强朦胧空气感。
        const softParticle = createSoftParticleTexture();
        const PX = CONCERT.piano.x, PZ = CONCERT.piano.z;
        createDust(PX, PZ, { count: 160, spread: 5, size: 0.05, opacity: 0.5, ySpread: 6, color: 0xf7e6c0, map: softParticle });
        createDust(PX, PZ, { count: 120, spread: 10, size: 0.06, opacity: 0.22, ySpread: 14, color: 0xe8d6ae, map: softParticle });
        // 金色微尘：紧贴钢琴聚光柱内悬浮闪亮，强化「辉煌/史诗」氛围
        createDust(PX, PZ, { count: 220, spread: 3.4, size: 0.022, opacity: 0.4, ySpread: 5.5, color: 0xffe1a0, drift: 1.4, map: softParticle });
        createDust(10, 3, { count: 100, spread: 12, size: 0.06, opacity: 0.12, ySpread: 14, color: 0xd8c9a8, drift: 0.7, map: softParticle });
        createDust(-6, 6, { count: 90, spread: 11, size: 0.06, opacity: 0.1, ySpread: 14, color: 0xd8c9a8, drift: 0.6, map: softParticle });

        // 体积光：钢琴上方聚光的可见光柱（上帝光），与金色尘埃叠加形成史诗光柱
        createSpotlightGodRay(CONCERT.piano.x, 13, CONCERT.stage.topY + 0.2, CONCERT.piano.z);
    }

    function updateConcert(dt) {
        syncPhysics(dt);

        // —— 自动门：以相机位置感应（轨道/第一人称均生效），2.8m 内自然开启、远离关闭；
        //    smoothstep 缓入缓出，双扇错相开启更接近真实门页运动；开启后解除门扇碰撞 ——
        const doors = app.doors;
        if (doors && doors.length) {
            const pp = app.camera ? app.camera.position : app.playerPos;
            for (let i = 0; i < doors.length; i++) {
                const d = doors[i];
                let near = false;
                if (pp && pp.y < 4.2) {
                    const dx = pp.x - d.x, dz = pp.z - d.z;
                    near = dx * dx + dz * dz < 7.84;   // 2.8m
                }
                // 错相：同组右扇稍慢半拍（依索引奇偶），先开后关更有层次
                const rate = (i % 2 === 0 ? 2.4 : 1.9) * dt;
                d.cur += ((near ? 1 : 0) - d.cur) * Math.min(1, rate);
                const e = d.cur * d.cur * (3 - 2 * d.cur);   // smoothstep 缓动
                d.group.rotation.y = d.sign * e * 1.85;      // 向外开启 ~106°
                d.collider.enabled = d.cur < 0.4;
            }
        }
        const t = Math.min(dt, 0.1) * 60; // 归一化到约 60fps，保证不同刷新率下漂移速度一致
        const sys = app.dustSystems;
        for (const s of sys) {
            const pos = s.positions;
            for (let i = 0; i < s.velocities.length; i++) {
                pos[i * 3] += s.velocities[i].x * t;
                pos[i * 3 + 1] += s.velocities[i].y * t;
                pos[i * 3 + 2] += s.velocities[i].z * t;
                if (pos[i * 3 + 1] > s.ySpread) pos[i * 3 + 1] = 0;
                if (pos[i * 3 + 1] < 0) pos[i * 3 + 1] = s.ySpread;
                if (Math.abs(pos[i * 3] - s.x) > s.half) s.velocities[i].x *= -1;
                if (Math.abs(pos[i * 3 + 2] - s.z) > s.half) s.velocities[i].z *= -1;
            }
            s.points.geometry.attributes.position.needsUpdate = true;
        }

        // 琴键按压动画（按下快速下沉 + 切换按压态材质、释放自然回弹 + 恢复）
        const pk = app.pianoKeys;
        if (pk && pk.length) {
            const k = 1 - Math.exp(-dt * 50);
            for (const key of pk) {
                // 逐键指触接触反馈：指尖传感器触碰到「该键」时额外下沉 1.5mm（换算到键局部单位），
                // 随后衰减回弹，模拟真实手指压键时琴键受实体碰撞的阻尼下沉感，增强按压反馈。
                const boost = key.physicsTouch > 0 ? 0.0015 / (key.depthScale || 1) : 0;
                const targetY = key.down ? key.restY - key.pressY - boost : key.restY;
                key.mesh.position.y += (targetY - key.mesh.position.y) * k;
                if (key.down !== key.wasDown) {
                    key.mesh.material = key.down ? key.pressedMat : key.restMat;
                    key.wasDown = key.down;
                }
            }
        }

        // 延音踏板按压动画（踩下时踏板杠杆下沉、松开回弹）
        const sp = app.sustainPedal;
        if (sp && sp.pedal) {
            const k = 1 - Math.exp(-dt * 30);
            const targetY = sp.down ? sp.pressY : sp.restY;
            sp.pedal.position.y += (targetY - sp.pedal.position.y) * k;
        }

        // 魔法可视化屏幕：每帧重绘 CanvasTexture，实时同步琴键按压位置 / 力度 / 持续时长
        drawMagicScreen(dt);
    }

    function pressPianoKey(midi, down, vel) {
        const pk = app.pianoKeys || [];
        const v = (vel == null) ? 0.5 : THREE.MathUtils.clamp(vel, 0, 1);
        for (const key of pk) {
            if (key.midi === midi) {
                key.down = !!down;
                if (down) {
                    key.vel = v;
                    key.onTime = performance.now();
                    magicNoteOn(midi, v);
                } else {
                    key.vel = null;
                    magicNoteOff(midi);
                }
                return;
            }
        }
    }

    function pressSustainPedal(down) {
        const sp = app.sustainPedal;
        if (sp) sp.down = !!down;
    }

    return { buildWorld, updateConcert, groundY, pressPianoKey, pressSustainPedal };
}