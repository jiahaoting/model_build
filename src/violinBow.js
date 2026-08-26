import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ============================================================
// 小提琴弓可视化模块
// ------------------------------------------------------------------
// · 加载高精度 GLB 弓模型（本工程：assets/models/violin_bow.glb）
// · 依据包围盒自动判定弓三主轴：
//     long   = 琴杆方向（最长）
//     up     = 弓毛→弓杆方向（次长，弓毛在 -up 侧、弓杆在 +up 侧）
//     width  = 弓毛带宽方向（最短）
// · 通过小提琴暴露的世界弦平面信息（getBowMount）把弓悬浮于弦上方，
//   弓毛朝下、弓杆朝上、弓长轴与弦平行。
// · 提琴轨道奏响时弓沿弦横向做往复“拉弓”；静止时保持轻柔漂移。
// ============================================================

const BOW_CFG = {
    refLength: 0.74,   // 真实琴弓长约 74cm（GLB 本身即真实尺寸，此处作兜底归一化）
    hoverGap: 0.05,    // 弓毛距弦面的悬浮间距（米）
    ambientFreq: 0.6,  // 静止漂移往复频率（Hz）
    ambientAmp: 0.02,  // 静止漂移幅度（米）
    strokeFreq: 1.5,   // 拉弓往复频率（Hz，随力度增强）
    strokeAmp: 0.14,   // 拉弓横向幅度（米，随力度增强）
    decay: 2.6,        // 拉弓能量衰减速率（1/s）
};

function _unit(axis) { const v = new THREE.Vector3(); v.setComponent(axis, 1); return v; }

export class ViolinBow {
    constructor() {
        this.root = new THREE.Group();
        this.root.name = 'ViolinBow';
        this.model = null;
        this._ready = false;
        this._axes = null;      // { long, up, width, size, center, longSpan, upSpan }
        this._time = 0;
        this._energy = 0;       // 拉弓能量（0~1，触弦后衰减）
    }

    async load(url) {
        const gltf = await new GLTFLoader().loadAsync(url);
        this.model = gltf.scene || gltf;
        this.model.name = 'violin-bow-model';
        this.root.add(this.model);
        this.root.updateMatrixWorld(true);
        this._analyze();
        this._ready = true;
        console.log('[violinBow] 加载完成 · 长轴=' + this._axes.long +
            ' 上轴=' + this._axes.up + ' 宽轴=' + this._axes.width +
            ' 原生弓长=' + this._axes.longSpan.toFixed(3) + 'm');
        return this;
    }

    _analyze() {
        const box = new THREE.Box3().setFromObject(this.model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const idx = [0, 1, 2].sort((a, b) => size.getComponent(b) - size.getComponent(a)); // 降序
        // 弓三主轴：长(琴杆) > 上(弓毛→弓杆) > 宽(弓毛带宽)
        this._axes = {
            long: idx[0], up: idx[1], width: idx[2],
            size, center,
            longSpan: size.getComponent(idx[0]),
            upSpan: size.getComponent(idx[1]),
        };
        // 兜底归一化到真实弓长（GLB 已近似真实尺寸，此步通常 ≈1）
        this.root.scale.setScalar(BOW_CFG.refLength / this._axes.longSpan);
    }

    // —— 触弦：注入拉弓能量（激发横向往复） ——
    stroke(vel = 0.8) {
        if (!this._ready) return;
        this._energy = Math.max(this._energy, Math.min(1, Math.max(0.25, vel)));
    }

    // —— 每帧：对齐提琴弦平面 + 拉弓往复 ——
    update(dt, mount) {
        if (!this._ready || !mount) return;
        this._time += dt;
        this._energy = Math.max(0, this._energy - BOW_CFG.decay * dt);

        // 姿态：弓长轴∥弦向(x)、弓上轴(毛→杆)∥弦面法向(y)，右手系补全宽轴(z)
        const x = mount.longDir;
        const y = mount.thickDir;
        const z = new THREE.Vector3().crossVectors(x, y).normalize();
        const m = new THREE.Matrix4().makeBasis(x, y, z);
        this.root.quaternion.setFromRotationMatrix(m);

        // 位置：悬浮于弦面正上方（弓毛朝下、弓杆朝上）
        const upHalf = (this._axes.upSpan * this.root.scale.x) * 0.5;
        this.root.position.copy(mount.center)
            .addScaledVector(mount.thickDir, BOW_CFG.hoverGap + upHalf);

        // 拉弓往复（沿弦横向来回）
        const amp = BOW_CFG.ambientAmp + (BOW_CFG.strokeAmp - BOW_CFG.ambientAmp) * this._energy;
        const freq = BOW_CFG.ambientFreq + (BOW_CFG.strokeFreq - BOW_CFG.ambientFreq) * this._energy;
        const saw = Math.sin(this._time * freq * Math.PI * 2);
        this.root.position.addScaledVector(mount.widthDir, saw * amp);
    }
}