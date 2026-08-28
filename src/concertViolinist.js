// ============================================================
// 小提琴手（Megumin）模块
// ------------------------------------------------------------------
// · 资产：assets/models/megumin.glb（Rigify/VRChat 风格，T-pose，约 440 关节）
// · 包围盒归一化到约 1.5m，站立在舞台上，面向观众
// · 「职业小提琴手」姿势：琴抵左肩/下巴、左手按琴颈、右手持弓
// · 手臂用世界空间双骨 IK（轴无关、稳健）；手指局部卷曲
// · 该模型 DEF-spine.006/007（头/眼 deform）在绑定中被挂在左前臂之下，
//   移动左臂会带动头部 —— 本模块在手臂 IK 后以「世界朝向」强制复位头/颈，
//   解除耦合，并单独施加轻微的低头/偏头。
// ============================================================
import * as THREE from 'three';

const TARGET_HEIGHT = 1.5;   // Megumin 约 147cm，取 1.5m

const BONE = {
    neck: 'ORG-spine.006',
    head: 'ORG-face',
    neckDef: 'DEF-spine.006',
    headDef: 'DEF-spine.007',
    lShoulder: 'DEF-shoulder.L', lArm: 'DEF-upper_arm.L', lFore: 'DEF-forearm.L', lHand: 'DEF-hand.L',
    rShoulder: 'DEF-shoulder.R', rArm: 'DEF-upper_arm.R', rFore: 'DEF-forearm.R', rHand: 'DEF-hand.R',
};

const FINGERS = ['thumb', 'f_index', 'f_middle', 'f_ring', 'f_pinky'];

const POSE = {
    // 头部微调（绕世界 YXZ）：低头 / 左转看向琴颈 / 左倾压琴
    headPitchDown: 0.08,
    headYawLeft: 0.22,
    headTiltLeft: -0.16,
    fingerCurl: 0.45,
    // 肘弯曲轴（世界）
    lElbowBend: new THREE.Vector3(0, 0.35, -1).normalize(),
    rElbowBend: new THREE.Vector3(0, -0.45, -0.4).normalize(),
};

export function createViolinist(app, world) {
    const scene = app.scene;
    const gltf = app.assets && app.assets.violinist;
    if (!gltf || !gltf.scene) {
        console.warn('[violinist] 未加载到 Megumin 模型资产');
        return { root: null, update() {}, attach() {}, setPosition() {} };
    }

    const root = new THREE.Group();
    root.name = 'violinist';
    scene.add(root);
    root.visible = false;   // 默认不上台，仅当曲目含小提琴时由 setActive(true) 显示

    const modelRoot = gltf.scene;
    const skinnedMesh = findSkinnedMesh(modelRoot);
    const B = {};
    const restQuat = {};        // 本地 rest 四元数
    const restWorldQuat = {};   // 头/颈的「世界」rest 朝向（解除耦合用）
    let bindDirs = {};

    const armLen = { L: { upper: 0.3, fore: 0.22 }, R: { upper: 0.3, fore: 0.22 } };

    if (skinnedMesh && skinnedMesh.skeleton) {
        skinnedMesh.frustumCulled = false;
        for (const b of skinnedMesh.skeleton.bones) if (b.name) B[b.name] = b;
        for (const b of skinnedMesh.skeleton.bones) restQuat[b.name] = b.quaternion.clone();
    }
    modelRoot.traverse(o => {
        if (o.isMesh) {
            o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
            // 卡通勾线：Solidify 反向壳 + 黑色 Outline 材质 → 以 BackSide 渲染出描边
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) {
                if (m && m.name && /outline|stroke/i.test(m.name)) {
                    m.color.setHex(0x000000);
                    m.emissive && m.emissive.setHex(0x000000);
                    m.metalness = 0; m.roughness = 1;
                    m.side = THREE.BackSide;
                    m.toneMapped = false;
                    m.needsUpdate = true;
                }
            }
        }
    });
    root.add(modelRoot);

    measureBindDirs();
    normalizeScale();          // 未旋转前测量原生身高，正确缩放并落足
    measureArms();
    // 缩放/落足完成后再转向观众，并在此最终朝向下记录头/颈的世界 rest 朝向
    root.rotation.set(0, -Math.PI / 2, 0);   // 模型 +Z 正面 → 转向 -X（观众）
    root.updateMatrixWorld(true);
    for (const bn of [BONE.neck, BONE.head, BONE.neckDef, BONE.headDef]) {
        const b = B[bn];
        if (b) restWorldQuat[bn] = b.getWorldQuaternion(new THREE.Quaternion()).clone();
    }

    function findSkinnedMesh(o) {
        if (o.isSkinnedMesh) return o;
        for (const c of o.children) { const r = findSkinnedMesh(c); if (r) return r; }
        return null;
    }

    function measureBindDirs() {
        bindDirs = {};
        for (const name in B) {
            const bone = B[name];
            let child = null, best = 0;
            for (const c of bone.children) if (c.isBone) { const d = c.position.lengthSq(); if (d >= best) { best = d; child = c; } }
            if (child) bindDirs[name] = child.position.clone().normalize();
        }
    }

    function normalizeScale() {
        root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(modelRoot);
        const size = box.getSize(new THREE.Vector3());
        const h = size.y || 1;
        const s = TARGET_HEIGHT / h;
        root.scale.setScalar(s);
        root.updateMatrixWorld(true);
        const box2 = new THREE.Box3().setFromObject(modelRoot);
        modelRoot.position.y -= box2.min.y / s;   // 脚底对齐 root 原点
        root.updateMatrixWorld(true);
        return s;
    }

    function measureArms() {
        root.updateMatrixWorld(true);
        for (const side of ['L', 'R']) {
            const upp = B[side === 'L' ? BONE.lArm : BONE.rArm];
            const fore = B[side === 'L' ? BONE.lFore : BONE.rFore];
            const hand = B[side === 'L' ? BONE.lHand : BONE.rHand];
            if (!upp || !fore || !hand) continue;
            armLen[side].upper = upp.getWorldPosition(new THREE.Vector3()).distanceTo(fore.getWorldPosition(new THREE.Vector3()));
            armLen[side].fore = fore.getWorldPosition(new THREE.Vector3()).distanceTo(hand.getWorldPosition(new THREE.Vector3()));
        }
    }

    function ik2Bone(shoulder, target, upperLen, foreLen, bendAxis) {
        const d = new THREE.Vector3().subVectors(target, shoulder);
        if (d.lengthSq() < 1e-8) return { elbow: shoulder.clone(), upperDir: new THREE.Vector3(0, -1, 0), foreDir: new THREE.Vector3(0, -1, 0) };
        const dir = d.normalize();
        const reach = Math.min(d.length(), (upperLen + foreLen) * 0.99);
        const axis = bendAxis.clone().normalize();
        let cosA = (upperLen * upperLen + reach * reach - foreLen * foreLen) / (2 * upperLen * reach);
        cosA = THREE.MathUtils.clamp(isFinite(cosA) ? cosA : 1, -1, 1);
        const upperDir = dir.clone().applyAxisAngle(axis, Math.acos(cosA));
        const elbow = shoulder.clone().addScaledVector(upperDir, upperLen);
        const foreDir = new THREE.Vector3().subVectors(target, elbow).normalize();
        return { elbow, upperDir, foreDir };
    }

    function aimBone(bone, target) {
        const grow = bindDirs[bone.name];
        if (!grow) return;
        const dir = target.clone().sub(bone.position).normalize();
        if (dir.lengthSq() < 1e-8) return;
        bone.quaternion.setFromUnitVectors(grow, dir);
    }

    function setBoneWorldQuat(bone, worldQuat) {
        const parentQ = bone.parent ? bone.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
        bone.quaternion.copy(parentQ.clone().invert()).multiply(worldQuat);
    }

    function placeArm(side, wristWorld, bendAxis) {
        const upp = B[side === 'L' ? BONE.lArm : BONE.rArm];
        const fore = B[side === 'L' ? BONE.lFore : BONE.rFore];
        if (!upp || !fore) return;
        const shoulder = upp.getWorldPosition(new THREE.Vector3());
        const ik = ik2Bone(shoulder, wristWorld, armLen[side].upper, armLen[side].fore, bendAxis);

        const uppParentInv = upp.parent.matrixWorld.clone().invert();
        aimBone(upp, ik.elbow.clone().applyMatrix4(uppParentInv));
        upp.updateMatrixWorld(true);

        const foreParentInv = fore.parent.matrixWorld.clone().invert();
        aimBone(fore, wristWorld.clone().applyMatrix4(foreParentInv));
        fore.updateMatrixWorld(true);
    }

    function poseFingers(side, curl) {
        const pf = side;
        for (const name of FINGERS) {
            for (let seg = 0; seg < 3; seg++) {
                const b = B[`DEF-${name}.0${seg + 1}.${pf}`];
                if (!b) continue;
                const rest = restQuat[b.name] || new THREE.Quaternion();
                const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(curl * (seg + 1) / 3.0, 0, 0));
                b.quaternion.copy(rest).multiply(q);
            }
        }
    }

    function applyHeadPose() {
        const dq = new THREE.Quaternion().setFromEuler(new THREE.Euler(
            POSE.headPitchDown, POSE.headYawLeft, POSE.headTiltLeft, 'YXZ'));
        for (const bn of [BONE.neck, BONE.head, BONE.neckDef, BONE.headDef]) {
            const b = B[bn];
            const restW = restWorldQuat[bn];
            if (b && restW) setBoneWorldQuat(b, restW.clone().multiply(dq));
        }
    }

    // 目标绑定：lHandTarget / rHandTarget（世界）
    let lHandTarget = null, rHandTarget = null;
    let violinRef = null, bowRef = null;

    function repose() {
        root.updateMatrixWorld(true);
        if (lHandTarget) placeArm('L', lHandTarget, POSE.lElbowBend);
        if (rHandTarget) placeArm('R', rHandTarget, POSE.rElbowBend);
        poseFingers('L', POSE.fingerCurl);
        poseFingers('R', POSE.fingerCurl);
        root.updateMatrixWorld(true);
        applyHeadPose();
    }

    // 每帧：按琴/弓「当前」挂载点重算双手 IK 目标（跟踪运弓往复、弦振），再做姿态
    function computeTargets() {
        if (violinRef && violinRef.getBowMount) {
            const m = violinRef.getBowMount();
            const last = violinRef.last;   // { midi, string, position }
            if (last && Number.isInteger(last.string) && m.stringWidths && m.stringWidths[last.string]) {
                // 左手指按弦点：当前音所在弦的横向位置 + 沿琴颈随把位(position)移动 + 下探到琴颈（厚向负）
                const stringPos = m.stringWidths[last.string];
                const along = (last.position - 0.5) * m.longSpan * 0.42;   // 高音把位向琴码移动
                lHandTarget = stringPos.clone()
                    .addScaledVector(m.longDir, along)
                    .addScaledVector(m.thickDir, -0.06);
            } else {
                // 无当前音：停在琴颈中段
                lHandTarget = m.center.clone().addScaledVector(m.thickDir, -0.06);
            }
        }
        if (bowRef && bowRef.root) {
            rHandTarget = bowRef.root.getWorldPosition(new THREE.Vector3()).clone();
        }
    }

    function update(dt) {
        if (!root.visible) return;
        if (violinRef || bowRef) {
            computeTargets();
            // 揉弦：左腕沿琴颈轻微缓速往返（视觉速率放缓，避免高频抖动），模拟揉弦的指腕动作
            if (violinRef && violinRef._vib && lHandTarget && violinRef.getBowMount) {
                const m = violinRef.getBowMount();
                const off = Math.sin(violinRef._time * 2.6) * 0.008;
                lHandTarget.addScaledVector(m.longDir, off);
            }
            repose();
        }
    }

    // 把小提琴摆到下巴下方、记录弓引用；双手目标由 update 每帧计算（才能跟踪弓）
    function attach(violin, bow) {
        violinRef = violin; bowRef = bow;
        root.updateMatrixWorld(true);
        const chin = B[BONE.head] ? B[BONE.head].getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 1.4, 0);
        if (violin && violin.getBowMount) {
            const m = violin.getBowMount();
            const want = chin.clone().addScaledVector(m.thickDir, -0.05);
            violin.root.position.add(want.clone().sub(m.center));
        }
        computeTargets();
        repose();
    }

    // 是否上台：只有曲目含小提琴时才显示角色与琴/弓（默认不上台）
    function setActive(active) {
        root.visible = !!active;
        if (violinRef) violinRef.root.visible = !!active;
        if (bowRef) bowRef.root.visible = !!active;
        if (active) { computeTargets(); repose(); }
    }

    return { root, update, attach, setActive,
        setPosition(x, y, z) { root.position.set(x, y, z); },
        get bones() { return B; } };
}