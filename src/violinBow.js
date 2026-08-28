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
//   弓毛朝下、弓杆朝上、弓长轴与弦「垂直」（弓杆横跨四弦）。
// · 奏响时弓绕「弦向」滚转到所奏弦对应的角度（G/D/A/E 四个离散倾角），
//   并沿弦向做缓慢、平稳的往复拉动；静止时弓完全停住，不做漂移/震荡。
// ============================================================

// 四弦（G/D/A/E）倾角：弓绕弦向滚转，弓杆倾向对应弦。弧度，正=向 E 侧倾斜。
// 淳朴拉法下四弦倾角差异极小（仅极轻微的自然微倾），避免换弦时弓明显左右滚动/晃动。
const STRING_TILT = [-0.06, -0.02, 0.02, 0.06];

const BOW_CFG = {
    refLength: 0.74,   // 真实琴弓长约 74cm（GLB 本身即真实尺寸，此处作兜底归一化）
    hoverGap: 0.01,    // 弓毛距弦面的悬浮间距（米）——贴近琴弦，弓毛中线落在弦上
    strokeFreq: 0.35,  // 运弓往复频率（Hz）——自然的下弓/上弓节奏
    strokeAmp: 0.10,   // 运弓沿弦往复幅度（米）——明显的拉弓动作，模拟真实运弓
    decay: 0.4,        // 运弓能量衰减速率（1/s）——慢衰减，长音期间弓保持匀速拉动
    tiltLerp: 5.0,     // 弦位倾角平滑过渡速率（1/s）
    posLerp: 8.0,      // 换弦/换音时基础位置的平滑过渡速率（1/s）
};

export class ViolinBow {
    constructor() {
        this.root = new THREE.Group();
        this.root.name = 'ViolinBow';
        this.model = null;
        this._ready = false;
        this._axes = null;      // { long, up, width, size, center, longSpan, upSpan }
        this._time = 0;
        this._energy = 0;       // 运弓能量（0~1，触弦后衰减）
        this._tilt = 0;         // 当前弦位倾角（向 STRING_TILT 目标平滑过渡）
        this._perf = null;      // 最近一次触弦的演奏描述符（弦位/弓压/触点/技法）
        this._basePos = new THREE.Vector3();  // 平滑后的基础位置（不含运弓往复）
        this._placed = false;   // 首帧是否已放置基础位置
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
        // 把模型几何中心移动到本地原点：不少 GLB 的模型原点不在几何中心（可能在弓根/弓尖），
        // 归中后「弓毛中线」才能按 upSpan/2 精确定位到弦上。
        this.model.position.sub(center);
        // 兜底归一化到真实弓长（GLB 已近似真实尺寸，此步通常 ≈1）
        this.root.scale.setScalar(BOW_CFG.refLength / this._axes.longSpan);
    }

    // —— 触弦：注入运弓能量，并携带弓法/技法描述符 ——
    stroke(vel = 0.8, perf = null) {
        if (!this._ready) return;
        this._energy = Math.max(this._energy, Math.min(1, Math.max(0.25, vel)));
        this._perf = perf || null;
    }

    // —— 每帧：对齐提琴弦平面 + 按弦倾斜 + 沿弦缓慢拉弓 ——
    update(dt, mount) {
        if (!this._ready || !mount) return;
        this._time += dt;
        this._energy = Math.max(0, this._energy - BOW_CFG.decay * dt);
        if (this._energy <= 0) this._perf = null;

        const p = this._perf || {};
        const bow = p.bow || { contact: 0.5, pressure: 0.5 };
        const stringIndex = (Number.isInteger(p.string) && p.string >= 0 && p.string < 4) ? p.string : 2;

        // 姿态（真实小提琴弓法）：弓杆横跨四弦、与琴弦「垂直」。
        // 依弓模型自动判定的三主轴（长=弓杆 / 上=弓毛→弓杆 / 宽=弓毛带）映射到世界方向：
        //  弓杆(long) → 弦横向(widthDir)；弓杆侧(up) → 弦面法向(thickDir)；弓毛带(width) → 弦向(longDir)。
        const shaft = mount.widthDir.clone().normalize().negate();   // 前后反转：弓根（握端）与弓尖对调
        const up = mount.thickDir.clone().normalize();               // 上下翻转：弓杆在上、弓毛朝下贴弦
        const ribbon = new THREE.Vector3().crossVectors(shaft, up).normalize();   // 弓毛带宽方向 ∥ 弦向
        const cols = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
        cols[this._axes.long] = shaft;
        cols[this._axes.up] = up;
        cols[this._axes.width] = ribbon;
        const probe = new THREE.Matrix4().makeBasis(cols[0], cols[1], cols[2]);
        if (probe.determinant() < 0) cols[this._axes.width].negate();   // 保证正当旋转，避免弓毛/弓杆镜面翻转
        const m = new THREE.Matrix4().makeBasis(cols[0], cols[1], cols[2]);
        this.root.quaternion.setFromRotationMatrix(m);

        // 四弦倾角：弓绕「弦向(longDir)」滚转，弓杆平滑过渡到所奏弦的倾角（无跳变）。
        const targetTilt = STRING_TILT[stringIndex];
        this._tilt += (targetTilt - this._tilt) * Math.min(1, dt * BOW_CFG.tiltLerp);
        this.root.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(mount.longDir, this._tilt));

        // 位置：悬浮于弦面正上方（弓毛朝下、弓杆朝上）
        // · 触点偏移：sul tasto（靠指板, contact→0）↔ sul ponticello（靠琴码, contact→1）沿弦向移动
        // · 弓压：压力越大，弓毛越贴弦，悬浮间距越小
        const upHalf = (this._axes.upSpan * this.root.scale.x) * 0.5;
        const gap = BOW_CFG.hoverGap * (1 - (bow.pressure - 0.5) * 0.6);

        // 基础位置目标：悬浮于弦面正上方（弓毛朝下、弓杆朝上）
        const base = new THREE.Vector3()
            .copy(mount.center)
            .addScaledVector(mount.longDir, (bow.contact - 0.5) * mount.longSpan * 0.22)
            .addScaledVector(mount.thickDir, gap + upHalf);

        // 按所奏弦在宽度方向对齐弓的位置（弓杆横跨四弦，但以所奏弦为中心微调）
        if (mount.stringWidths && mount.stringWidths[stringIndex]) {
            const wproj = mount.stringWidths[stringIndex].clone().sub(mount.center).dot(mount.widthDir);
            base.addScaledVector(mount.widthDir, wproj);
        }

        // 换弦/换音平滑过渡：基础位置缓慢逼近目标，避免瞬间跳动
        if (!this._placed) {
            this._basePos.copy(base);
            this._placed = true;
        } else {
            this._basePos.lerp(base, 1 - Math.exp(-dt * BOW_CFG.posLerp));
        }
        this.root.position.copy(this._basePos);

        // 运弓：仅当触弦（能量>0）时沿「弦向」做缓慢平稳的下弓/上弓拉动；静止时弓完全不动。
        // 固定使用缓慢往复正弦（起停平缓、无折返冲击）；跳弓/颤音等技法只作用于音频，
        // 不改变可视化运弓速度，避免弓在快速乐句中高速震动乱晃。
        const playing = this._energy > 0.02;
        if (playing) {
            const angle = this._time * BOW_CFG.strokeFreq * Math.PI * 2;
            const amp = BOW_CFG.strokeAmp * Math.min(1, this._energy);
            this.root.position.addScaledVector(mount.longDir, Math.sin(angle) * amp);
        }
    }
}