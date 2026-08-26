import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
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

    stage: { x0: -10, x1: 10, z0: -15.8, z1: -6.8, topY: 1.1 },

    piano: { x: 0, z: -11.5, rotY: Math.PI / 2 },
    // 琴凳对齐白键一侧（白键/键盘位于琴体 +X 端，演奏者坐于钢琴 +X 侧、面向 -X）。
    // 实测键面前缘世界 X≈1.10m，琴体世界 X 范围为 [-1.10, +1.10]（键面即琴体 +X 端）。
    // 原 0.90m 使琴凳整体陷入钢琴包围盒（琴凳 +X 深度 0.42m、前缘约 0.69m < 键面 1.10m），
    // 造成琴凳嵌入钢琴、演奏者背对键盘。故后移至 1.45m：琴凳前缘约 1.24m、距键面约 0.14m，
    // 演奏者髋部位于 1.45m、前倾后肩→键约 0.25m，肘部保持自然弯曲，可舒适覆盖全键区。
    bench: { x: 1.45, z: -11.5, rotY: Math.PI / 2 },

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
    function addBoxCollider(id, minX, maxX, minZ, maxZ) {
        colliders.push({ id, enabled: true, box: new THREE.Box3(
            new THREE.Vector3(minX, 0, minZ), new THREE.Vector3(maxX, H, maxZ)
        ) });
    }

    // —— 地面高度（供玩家台阶登台）——
    function groundY(x, z) {
        const S = CONCERT.stage;
        if (z <= S.z1 && z >= S.z0 && x >= S.x0 && x <= S.x1) return S.topY;
        const st = CONCERT.stairs;
        if (x >= st.x0 && x <= st.x1 && z <= st.zFloor && z >= st.zStage) {
            return S.topY * ((z - st.zFloor) / (st.zStage - st.zFloor));
        }
        return 0;
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

        // 天花板（深色 + 木梁）
        const ceil = new THREE.Mesh(new THREE.PlaneGeometry(CONCERT.hallW, CONCERT.hallD), darkCeilMat);
        ceil.rotation.x = Math.PI / 2; ceil.position.set(0, H, 0);
        ceil.receiveShadow = true; scene.add(ceil);
        for (let bx = -HW + 2; bx <= HW - 2; bx += 4) {
            const beam = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, CONCERT.hallD), trimMat);
            beam.position.set(bx, H - 0.07, 0); scene.add(beam);
        }

        // 后墙（舞台后）
        const back = new THREE.Mesh(new THREE.PlaneGeometry(CONCERT.hallW, H), blackWallMat);
        back.position.set(0, H / 2, -HD); back.receiveShadow = true; scene.add(back);
        // 前墙（观众席后）
        const front = new THREE.Mesh(new THREE.PlaneGeometry(CONCERT.hallW, H), blackWallMat);
        front.position.set(0, H / 2, HD); front.rotation.y = Math.PI; front.receiveShadow = true; scene.add(front);
        // 左右墙：整体黑色纹理墙面 + 金色饰线
        for (const side of [-1, 1]) {
            const lower = new THREE.Mesh(new THREE.PlaneGeometry(CONCERT.hallD, H * 0.5), blackWallMat);
            lower.position.set(side * HW, H * 0.25, 0);
            lower.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
            lower.receiveShadow = true; scene.add(lower);
            const upper = new THREE.Mesh(new THREE.PlaneGeometry(CONCERT.hallD, H * 0.5), blackWallMat);
            upper.position.set(side * HW, H * 0.75, 0);
            upper.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
            upper.receiveShadow = true; scene.add(upper);
            // 金色饰线（黑色墙面的精致点缀）
            const rail = new THREE.Mesh(new THREE.BoxGeometry(CONCERT.hallD, 0.08, 0.08), goldMat);
            rail.position.set(side * HW, H * 0.5, 0); scene.add(rail);
        }

        // 周界碰撞
        addBoxCollider('back', -HW, HW, -HD - 0.4, -HD + 0.4);
        addBoxCollider('front', -HW, HW, HD - 0.4, HD + 0.4);
        addBoxCollider('left', -HW - 0.4, -HW + 0.4, -HD, HD);
        addBoxCollider('right', HW - 0.4, HW + 0.4, -HD, HD);
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
        const screenW = 20, screenH = 10, centerY = 6.3, z = -HD + 0.6;
        const panel = new THREE.Mesh(
            new THREE.PlaneGeometry(screenW, screenH),
            new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
        );
        panel.position.set(0, centerY, z);
        scene.add(panel);

        const frameT = 0.14;
        const addFrame = (w, h, x, y) => {
            const f = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.18), goldMat);
            f.position.set(x, y, z - 0.02);
            scene.add(f);
        };
        addFrame(screenW + frameT * 2, frameT, 0, centerY + screenH / 2 + frameT / 2);   // 顶
        addFrame(screenW + frameT * 2, frameT, 0, centerY - screenH / 2 - frameT / 2);   // 底
        addFrame(frameT, screenH, -(screenW / 2 + frameT / 2), centerY);                 // 左
        addFrame(frameT, screenH, (screenW / 2 + frameT / 2), centerY);                  // 右

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
        // 座椅高度整体下调 12cm（坐垫顶 0.59m → 0.47m，接近标准琴凳高 48cm），
        // 使演奏者大腿接近水平、双脚平稳踩地；四条腿同步缩短，保持四脚等高平稳着地。
        const pad = new THREE.Mesh(new RoundedBoxGeometry(1.30, 0.14, 0.42, 3, 0.05), padMat);
        pad.position.y = 0.40; pad.castShadow = true; pad.receiveShadow = true; g.add(pad);
        // 座板
        const board = new THREE.Mesh(new RoundedBoxGeometry(1.34, 0.06, 0.46, 2, 0.02), woodMat);
        board.position.y = 0.30; board.castShadow = true; board.receiveShadow = true; g.add(board);
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

        // 记录可坐坐标：面向钢琴（-X）
        app.seats = app.seats || [];
        app.seats.push({
            id: 'piano-bench',
            isPiano: true,
            eyeX: x, eyeY: topY + 0.83, eyeZ: z,
            yaw: Math.PI / 2,
            standX: x + 0.5, standY: topY + STAND_EYE, standZ: z
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

        // 前缘护墙 + 金色扶手（朝向舞台一侧开放视野，其余三边贴墙）
        const parapetH = 0.95, parapetThick = 0.16;
        const parapet = new THREE.Mesh(new THREE.BoxGeometry(w, parapetH, parapetThick), darkTrimMat);
        parapet.position.set(0, cfg.floorY + parapetH / 2, cfg.frontZ - parapetThick / 2);
        parapet.castShadow = true; parapet.receiveShadow = true; scene.add(parapet);
        const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, 0.10), goldMat);
        rail.position.set(0, cfg.floorY + parapetH, cfg.frontZ - parapetThick / 2);
        scene.add(rail);

        // 台面底沿金色装饰线
        const facia = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, 0.18), goldMat);
        facia.position.set(0, cfg.floorY - slabThick, cfg.frontZ - parapetThick / 2);
        scene.add(facia);

        // 后墙牛腿（挑梁）：间隔支撑，营造悬空感
        const bracketGeo = new THREE.BoxGeometry(0.5, 0.5, 1.2);
        for (let x = -9; x <= 9; x += 3) {
            const br = new THREE.Mesh(bracketGeo, darkTrimMat);
            br.position.set(x, cfg.floorY - slabThick - 0.25, cfg.backZ - 0.4);
            br.castShadow = true; br.receiveShadow = true; scene.add(br);
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

        // 精致材质：烛光灯泡 / 象牙蜡烛 / 通透水晶吊坠
        const bulbMat = new THREE.MeshStandardMaterial({
            color: 0xfff2d8, emissive: 0xffd9a0, emissiveIntensity: 1.8
        });
        const candleMat = new THREE.MeshStandardMaterial({
            color: 0xf5ead0, roughness: 0.5, metalness: 0.0
        });
        const crystalMat = new THREE.MeshPhysicalMaterial({
            color: 0xeef3ff, roughness: 0.04, metalness: 0.0,
            clearcoat: 1.0, clearcoatRoughness: 0.05,
            envMapIntensity: 2.2, ior: 1.55,
            transparent: true, opacity: 0.9
        });

        // 顶部吊链 / 吊杆 + 尖顶装饰
        const rodLen = (H - y) + 0.4;
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.05, rodLen, 12), goldMat);
        rod.position.y = (H - y) / 2 - 0.2; g.add(rod);
        const finial = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.26, 12), goldMat);
        finial.position.y = (H - y); g.add(finial);

        // 中央主轴（三段收束，增加层次）
        const spindleSegs = [
            { y: -0.25, h: 0.40, rt: 0.06, rb: 0.08 },
            { y: -0.65, h: 0.45, rt: 0.05, rb: 0.06 },
            { y: -1.15, h: 0.55, rt: 0.03, rb: 0.05 }
        ];
        for (const s of spindleSegs) {
            const seg = new THREE.Mesh(new THREE.CylinderGeometry(s.rt, s.rb, s.h, 16), goldMat);
            seg.position.y = s.y; g.add(seg);
        }

        // 多层环形灯臂（金环 + 径向支臂 + 蜡烛 + 灯泡）
        const tiers = [
            { y: -0.15, r: 0.55, arms: 8 },
            { y: -0.55, r: 0.85, arms: 12 },
            { y: -0.95, r: 1.15, arms: 16 }
        ];
        const bulbs = [];
        for (const tier of tiers) {
            const ring = new THREE.Mesh(new THREE.TorusGeometry(tier.r, 0.03, 12, 64), goldMat);
            ring.rotation.x = Math.PI / 2; ring.position.y = tier.y; g.add(ring);

            for (let i = 0; i < tier.arms; i++) {
                const a = (i / tier.arms) * Math.PI * 2;
                const dx = Math.cos(a), dz = Math.sin(a);
                // 支臂（金盒，径向朝外）
                const arm = new THREE.Mesh(new THREE.BoxGeometry(tier.r, 0.03, 0.024), goldMat);
                arm.position.set(dx * tier.r / 2, tier.y + 0.02, dz * tier.r / 2);
                arm.rotation.y = -a; g.add(arm);
                // 蜡烛（端头）
                const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.038, 0.2, 10), candleMat);
                candle.position.set(dx * tier.r, tier.y + 0.09, dz * tier.r); g.add(candle);
                // 灯泡（烛火）
                const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.038, 10, 8), bulbMat);
                bulb.position.set(dx * tier.r, tier.y + 0.24, dz * tier.r); g.add(bulb);
                bulbs.push(bulb);
            }
        }

        // 底部链环 + 通透水晶吊坠（圆锥形，层次丰富）
        const dropCount = 16, dropR = 1.08;
        for (let i = 0; i < dropCount; i++) {
            const a = (i / dropCount) * Math.PI * 2 + 0.08;
            const drop = new THREE.Mesh(new THREE.ConeGeometry(0.042, 0.2, 8), crystalMat);
            drop.position.set(Math.cos(a) * dropR, -1.3, Math.sin(a) * dropR);
            drop.rotation.x = Math.PI; g.add(drop);
        }
        const centreDrop = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.34, 10), crystalMat);
        centreDrop.position.y = -1.55; centreDrop.rotation.x = Math.PI; g.add(centreDrop);

        g.position.set(x, y, z);
        scene.add(g);
        g.userData.bulbs = bulbs;
        return g;
    }

    function createSconce(x, y, z, facing) {
        const g = new THREE.Group();
        const dish = new THREE.Mesh(
            new THREE.CircleGeometry(0.16, 16),
            new THREE.MeshStandardMaterial({ color: 0xfff0d0, emissive: 0xffc98f, emissiveIntensity: 1.4, side: THREE.DoubleSide })
        );
        dish.position.z = 0.05; g.add(dish);
        const holder = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.1, 10), goldMat);
        holder.rotation.x = Math.PI / 2; g.add(holder);
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
    // 综合灯光系统（舞台 / 环境 / 观众席）
    // ============================================================
    function buildLighting() {
        RectAreaLightUniformsLib.init();

        // —— 环境基础（明亮华丽：整体提亮，暖调，突出舞台与金属金饰） ——
        scene.add(new THREE.AmbientLight(0x2a1d16, 0.42));
        scene.add(new THREE.HemisphereLight(0xfff3dc, 0x14100c, 0.30));
        // 主方向光：明亮厅堂顶部泛光（模拟天光/吊顶整体照明），无阴影以保持性能并让钢琴聚光保持唯一焦点
        const keyLight = new THREE.DirectionalLight(0xfff2e0, 0.55);
        keyLight.position.set(0, H - 1, 0);
        scene.add(keyLight);

        // —— 观众席暖色整体光（微弱面光） ——
        const house = new THREE.RectAreaLight(T_WARM_HOUSE, 0.55, 12, 10);
        house.position.set(0, H - 0.4, 3);
        house.rotation.x = Math.PI / 2;
        scene.add(house);
        const house2 = new THREE.RectAreaLight(T_WARM_HOUSE, 0.4, 12, 8);
        house2.position.set(0, H - 0.4, 10);
        house2.rotation.x = Math.PI / 2;
        scene.add(house2);

        // —— 吊灯（观众席中轴，低亮度暖光） ——
        for (const cz of [-2, 3, 8, 13]) {
            createChandelier(0, 12.5, cz);
            const p = new THREE.PointLight(T_WARM_HOUSE, 0.5, 14, 2);
            p.position.set(0, 11.5, cz); scene.add(p);
        }

        // —— 侧墙壁灯（低亮度点缀） ——
        for (const side of [-1, 1]) {
            for (const cz of [-8, -1, 5, 11]) {
                createSconce(side * (HW - 0.3), 4.5, cz, side > 0 ? -Math.PI / 2 : Math.PI / 2);
                const s = new THREE.PointLight(T_GOLD, 0.28, 6, 2);
                s.position.set(side * (HW - 0.8), 4.2, cz); scene.add(s);
            }
        }

        // —— 单一钢琴聚光（正上方专注聚焦，场景唯一聚光灯） ——
        const pianoSpot = new THREE.SpotLight(T_PIANO, 2.4, 30, 0.42, 0.55, 1.2);
        pianoSpot.position.set(0, 13.2, CONCERT.piano.z);
        pianoSpot.target.position.set(0, CONCERT.stage.topY + 0.2, CONCERT.piano.z);
        pianoSpot.target.updateMatrixWorld();
        pianoSpot.castShadow = true;
        pianoSpot.shadow.mapSize.set(2048, 2048);
        pianoSpot.shadow.bias = -0.0005;
        pianoSpot.shadow.focus = 1.0;
        scene.add(pianoSpot); scene.add(pianoSpot.target);
        app.pianoSpot = pianoSpot;
        app.pianoSpotBase = 2.4;

        // —— 舞台侧翼金色点缀（极弱） ——
        for (const side of [-1, 1]) {
            const p = new THREE.PointLight(T_GOLD, 0.32, 10, 2);
            p.position.set(side * 8.5, 4.5, -11); scene.add(p);
        }

        // —— 台口地脚灯 ——
        for (const x of [-9, -5, 5, 9]) createFootlight(x, CONCERT.stage.z1 + 0.05);

        // —— 登台阶梯脚灯 ——
        for (const x of [-2.5, 2.5]) createFootlight(x, -4.9);
    }

    // ============================================================
    // 组装
    // ============================================================
    function buildWorld() {
        buildShell();
        buildStage();
        buildCurtains();
        buildSeating();
        buildBalcony();
        buildLighting();

        // 钢琴
        const gltf = app.assets && app.assets.piano;
        if (gltf && gltf.scene) {
            app.piano = createPianoFromGLB(gltf, CONCERT.piano.x, CONCERT.stage.topY, CONCERT.piano.z, CONCERT.piano.rotY);
        }
        createPianoBench(CONCERT.bench.x, CONCERT.bench.z, CONCERT.bench.rotY);

        // 延音踏板：置于键盘下方演奏者右脚下（坐态面向 -X，右侧为 -Z）
        createSustainPedal(1.05, CONCERT.stage.topY, CONCERT.piano.z - 0.12);

        // 尘埃（聚光聚焦的舞台区域更密集、更高亮，观众席与厅内自然飘散）；
        // 统一采用软粒子纹理，呈现柔和光斑，增强朦胧空气感。
        const softParticle = createSoftParticleTexture();
        createDust(0, CONCERT.piano.z, { count: 160, spread: 5, size: 0.05, opacity: 0.5, ySpread: 6, color: 0xf7e6c0, map: softParticle });
        createDust(0, CONCERT.piano.z, { count: 120, spread: 10, size: 0.06, opacity: 0.22, ySpread: H - 2, color: 0xe8d6ae, map: softParticle });
        // 金色微尘：紧贴钢琴聚光柱内悬浮闪亮，强化「辉煌/史诗」氛围
        createDust(0, CONCERT.piano.z, { count: 220, spread: 3.4, size: 0.022, opacity: 0.4, ySpread: 5.5, color: 0xffe1a0, drift: 1.4, map: softParticle });
        createDust(4, 3, { count: 100, spread: 12, size: 0.06, opacity: 0.12, ySpread: H - 1, color: 0xd8c9a8, drift: 0.7, map: softParticle });
        createDust(-4, 8, { count: 90, spread: 11, size: 0.06, opacity: 0.1, ySpread: H - 1, color: 0xd8c9a8, drift: 0.6, map: softParticle });
    }

    function updateConcert(dt) {
        syncPhysics(dt);
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
                // 逐键指触接触反馈：指尖传感器触碰到「该键」时额外下沉 1.5mm，随后衰减回弹，
                // 模拟真实手指压键时琴键受实体碰撞的阻尼下沉感，增强按压反馈。
                const boost = key.physicsTouch > 0 ? 0.0015 : 0;
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