import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ============================================================
// 小提琴可视化 / 交互演奏模块
// ------------------------------------------------------------------
// · 加载现成 GLB 小提琴模型（本工程：assets/models/violin.glb，CC-BY）
// · 直接使用模型自带的琴弦，不额外新增实体弦（this.strings[] 为「逻辑弦区」）
// · 音高 ↔ 弦位/按弦位置 双向映射（模拟真实小提琴把位）
// · 射线交互：指向某根弦的某位置即可演奏，按弦处显示指示球、弦身发光反馈
// · 音色由外部注入（this.onSound），默认用占位弦乐音色
// ============================================================

// 四根空弦（真实小提琴）：G3(55) / D4(62) / A4(69) / E5(76)
export const STRING_DEFS = [
    { name: 'G', midi: 55, color: 0x9a948c },
    { name: 'D', midi: 62, color: 0xb6b0a8 },
    { name: 'A', midi: 69, color: 0xd4cec6 },
    { name: 'E', midi: 76, color: 0xf0ebe2 },
];
const N_STR = STRING_DEFS.length;

// 布局 / 视觉参数（可按需调整）
const VIOLIN_CFG = {
    refLength: 0.6,     // 标准化后的琴长（米）
    upSign: 1,          // 弦在长轴哪一侧；若看到弦反馈出现在琴体背面，改为 -1
    stringStart: 0.08,  // 弦枕位置（沿长轴比例，琴头侧→琴尾侧）
    stringEnd: 0.52,    // 琴码位置比例（琴体中部）
    vibrFreqMin: 8,     // 视觉振动频率下限（Hz，低音）
    vibrFreqMax: 42,    // 视觉振动频率上限（Hz，高音）——刻意远离真实数百 Hz 以避免走样
    glowOpacity: 0.85,  // 演奏中弦身发光最大不透明度
    hoverOpacity: 0.32, // 鼠标悬停时弦身不透明度
};

// 单位向量工具
function _unit(axis) { const v = new THREE.Vector3(); v.setComponent(axis, 1); return v; }

export class Violin {
    constructor() {
        this.root = new THREE.Group();
        this.root.name = 'Violin';
        this.model = null;
        this.strings = [];       // { def, base, vStart, vEnd, glow, glowMat, vibrAmp, vibrFreq, vibrPhase, holding }
        this.fingerMark = null;  // 按弦位置指示（发光小球）
        this._fingerMarkBase = null;   // 按弦球基准位置（用于揉弦振荡偏移）
        this._vib = null;             // 当前揉弦参数 { rate, depth }（无揉弦为 null）
        this.onSound = null;     // (midi, vel, type) => void —— 发声回调
        this.last = null;        // 最近一次触弦 { midi, string, position }
        this._time = 0;
        this._axes = null;       // { long, width, thick, size, center, longSpan }
        this._ampScale = 1;
        this._ready = false;
        this._hover = -1;        // 当前悬停的弦索引（-1 = 无）
    }

    async load(url) {
        const gltf = await new GLTFLoader().loadAsync(url);
        this.model = gltf.scene || gltf;
        this.model.name = 'violin-model';
        this.root.add(this.model);
        this.root.updateMatrixWorld(true);
        this._analyze();
        this._buildStringZones();
        this._normalizeScale();
        this._ready = true;
        console.log('[violin] 加载完成 · 弦向轴=' + this._axes.long +
            ' 宽向轴=' + this._axes.width + ' 厚向轴=' + this._axes.thick +
            ' 原长=' + this._axes.longSpan.toFixed(3));
        return this;
    }

    // —— 包围盒分析：确定长轴(弦向)/宽轴(弦间距)/厚轴(弦高) ——
    _analyze() {
        const box = new THREE.Box3().setFromObject(this.model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const idx = [0, 1, 2].sort((a, b) => size.getComponent(b) - size.getComponent(a)); // 降序：长/宽/厚
        this._axes = {
            long: idx[0], width: idx[1], thick: idx[2],
            size, center, longSpan: size.getComponent(idx[0]),
        };
    }

    // —— 逻辑弦区：算四根弦位置 + 发光反馈线（非新增实体弦） ——
    _buildStringZones() {
        const { long, width, thick, size, center, longSpan } = this._axes;
        const upSign = VIOLIN_CFG.upSign;

        const cStart = center.getComponent(long) - longSpan / 2;
        const s0 = cStart + longSpan * VIOLIN_CFG.stringStart;
        const s1 = cStart + longSpan * VIOLIN_CFG.stringEnd;
        const wCenter = center.getComponent(width);
        const wSpan = size.getComponent(width);
        const wSpacing = wSpan * 0.11;                 // 弦间距
        const offsets = [-1.5, -0.5, 0.5, 1.5];        // 四弦横排
        const top = center.getComponent(thick) + (size.getComponent(thick) / 2 + size.getComponent(thick) * 0.25) * upSign;

        const len = s1 - s0;
        const radius = longSpan * 0.005;
        this._ampScale = longSpan * 0.012;             // 最大横向振动幅度

        STRING_DEFS.forEach((def, i) => {
            const base = new THREE.Vector3();
            base.setComponent(long, (s0 + s1) / 2);
            base.setComponent(width, wCenter + offsets[i] * wSpacing);
            base.setComponent(thick, top);

            // 发光反馈（加色透明、闲置时全透明；奏响时亮起并横向振动，随衰减渐隐）
            const geo = new THREE.CylinderGeometry(radius, radius, len, 6, 1, true);
            const mat = new THREE.MeshBasicMaterial({
                color: def.color, transparent: true, opacity: 0,
                blending: THREE.AdditiveBlending, depthWrite: false,
            });
            const glow = new THREE.Mesh(geo, mat);
            glow.name = 'string-glow-' + def.name;
            glow.position.copy(base);
            glow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _unit(long));
            this.root.add(glow);

            this.strings.push({
                def, base: base.clone(), vStart: s0, vEnd: s1,
                glow, glowMat: mat,
                vibrAmp: 0, vibrFreq: VIOLIN_CFG.vibrFreqMin, vibrPhase: Math.random() * Math.PI * 2,
                holding: null,
            });
        });

        // 按弦指示球（左手指位）：发光小球，置于被按弦上对应位置
        const fGeo = new THREE.SphereGeometry(longSpan * 0.018, 12, 8);
        const fMat = new THREE.MeshBasicMaterial({ color: 0xffd75e });
        this.fingerMark = new THREE.Mesh(fGeo, fMat);
        this.fingerMark.name = 'fingering-marker';
        this.fingerMark.visible = false;
        this.root.add(this.fingerMark);
    }

    _normalizeScale() {
        const s = VIOLIN_CFG.refLength / this._axes.longSpan;
        this.root.scale.setScalar(s);
    }

    // —— 音高 → 弦位 + 按弦位置（真实小提琴：优先选最高空弦 ≤ 音高的弦，把位最低）——
    fingeringFor(midi) {
        let best = 0;
        for (let i = 0; i < N_STR; i++) {
            if (STRING_DEFS[i].midi <= midi && STRING_DEFS[i].midi > STRING_DEFS[best].midi) best = i;
        }
        const semis = Math.max(0, midi - STRING_DEFS[best].midi);
        const position = Math.min(1, semis / 18); // 线性映射示意（真实按弦距离随音高缩短）
        return { string: best, position };
    }

    // —— 弦位 + 按弦位置 → 音高（交互用，与 fingeringFor 互为近似逆）——
    midiAt(stringIndex, position) {
        const idx = Math.max(0, Math.min(N_STR - 1, stringIndex | 0));
        const semis = Math.round(Math.max(0, Math.min(1, position)) * 18);
        return STRING_DEFS[idx].midi + semis;
    }

    // —— 触弦：激发振动 + 发光 + 按弦指示 + 发声 ——
    // perf: 可选的演奏描述符（含精确弦位/指位/揉弦等），由演奏模型注入；
    //       缺省时回退到本模块的近似把位映射。
    noteOn(midi, vel = 0.8, perf = null) {
        if (!this._ready) return null;
        const f0 = this.fingeringFor(midi);
        let string = f0.string, position = f0.position;
        if (perf && Number.isInteger(perf.string) && perf.string >= 0 && perf.string < N_STR &&
            typeof perf.position === 'number') {
            string = perf.string;
            position = THREE.MathUtils.clamp(perf.position, 0, 1);
        }
        const s = this.strings[string];
        s.vibrAmp = Math.max(0.15, Math.min(1, vel));
        s.vibrFreq = THREE.MathUtils.lerp(VIOLIN_CFG.vibrFreqMin, VIOLIN_CFG.vibrFreqMax, (midi - 55) / 33);
        s.vibrPhase = 0;
        s.holding = { midi, pos: position };
        this._placeFingerMark(s, position);
        this.last = { midi, string, position };
        this._vib = (perf && perf.vibrato) ? perf.vibrato : null;   // 揉弦：驱动左手指位纵向滚动
        if (this.onSound) this.onSound(midi, vel, 'on');
        return this.last;
    }

    noteOff(midi) {
        if (!this._ready) return;
        for (const s of this.strings) {
            if (s.holding && s.holding.midi === midi) { s.vibrAmp *= 0.35; s.holding = null; }
        }
        this._vib = null;
        if (this.onSound) this.onSound(midi, 0, 'off');
    }

    _placeFingerMark(s, pos) {
        const { long, width, thick, center, longSpan } = this._axes;
        const cStart = center.getComponent(long) - longSpan / 2;
        const s0 = cStart + longSpan * VIOLIN_CFG.stringStart;
        const s1 = cStart + longSpan * VIOLIN_CFG.stringEnd;
        const p = new THREE.Vector3();
        p.setComponent(long, s0 + (s1 - s0) * pos);
        p.setComponent(width, s.base.getComponent(width));
        p.setComponent(thick, s.base.getComponent(thick));
        this._fingerMarkBase = p.clone();
        this.fingerMark.position.copy(p);
        this.fingerMark.visible = true;
    }

    // —— 交互拾取：给定已设置好的 Raycaster，返回命中的弦与按弦位置 ——
    pick(raycaster) {
        if (!this._ready || !this.model) return null;
        const hits = raycaster.intersectObject(this.model, true);
        if (!hits.length) return null;
        const pLocal = this.root.worldToLocal(hits[0].point.clone());
        const { long, width } = this._axes;

        // 找宽度方向上最近的弦
        let best = -1, bestD = Infinity;
        this.strings.forEach((s, i) => {
            const d = Math.abs(pLocal.getComponent(width) - s.base.getComponent(width));
            if (d < bestD) { bestD = d; best = i; }
        });
        if (best < 0) return null;

        const s = this.strings[best];
        const longC = pLocal.getComponent(long);
        const span = s.vEnd - s.vStart;
        // 命中点须在弦段附近（允许少量余量，避免点琴腹/琴头误触发）
        if (longC < s.vStart - span * 0.2 || longC > s.vEnd + span * 0.2) return null;

        const position = Math.max(0, Math.min(1, (longC - s.vStart) / span));
        return { string: best, position, local: pLocal, world: hits[0].point };
    }

    // —— 每帧：弦身发光振动 + 衰减渐隐 ——
    update(dt) {
        if (!this._ready) return;
        this._time += dt;
        const latDir = _unit(this._axes.width);
        for (let i = 0; i < this.strings.length; i++) {
            const s = this.strings[i];
            const target = s.vibrAmp > 0.002
                ? VIOLIN_CFG.glowOpacity
                : (i === this._hover ? VIOLIN_CFG.hoverOpacity : 0);
            s.glowMat.opacity += (target - s.glowMat.opacity) * Math.min(1, dt * 14);

            if (s.vibrAmp < 0.002) {
                if (s.vibrAmp !== 0) { s.vibrAmp = 0; s.glow.position.copy(s.base); }
            } else {
                s.vibrAmp *= Math.exp(-(1.6 + 2.4 * s.vibrAmp) * dt);
                const osc = Math.sin(this._time * s.vibrFreq * Math.PI * 2 + s.vibrPhase);
                s.glow.position.copy(s.base).addScaledVector(latDir, osc * s.vibrAmp * this._ampScale);
            }
        }

        // 左手揉弦：按弦球沿弦向做小幅度正弦滚动（音分深度 → 可见纵向位移）
        if (this._vib && this._fingerMarkBase && this.fingerMark.visible && this.last) {
            const s = this.strings[Math.min(this.last.string, N_STR - 1)];
            const span = s.vEnd - s.vStart;
            const amp = Math.min(span * 0.04, this._vib.depth * 0.0006 * span);
            const off = Math.sin(this._time * this._vib.rate * Math.PI * 2) * amp;
            this.fingerMark.position.setComponent(this._axes.long,
                this._fingerMarkBase.getComponent(this._axes.long) + off);
        }
    }

    // —— 弓挂载点：返回世界坐标系下的弦平面信息，供弓主体对齐 / 定位 ——
    // 返回 { center, longDir, widthDir, thickDir, longSpan, stringWidths }：
    //  · center    弦段中心（世界坐标，取自四弦中点）
    //  · longDir   弦向（琴长方向）单位向量 —— 运弓方向即沿此方向
    //  · widthDir  弦横向（弦间距方向）单位向量 —— 弓杆与此方向对齐（弓杆 ⊥ 琴弦）
    //  · thickDir  弦面法向（从琴体指向弦、即弓悬浮一侧）单位向量
    //  · stringWidths  四根弦各自的世界位置（供弓按所奏弦在宽度方向对齐）
    getBowMount() {
        const { long, width, thick } = this._axes;
        const s = this.root.scale.x;      // 归一化后的均匀缩放
        const q = this.root.quaternion;

        const c = new THREE.Vector3();
        c.setComponent(long, this.strings[0].base.getComponent(long));
        c.setComponent(width, (this.strings[1].base.getComponent(width) + this.strings[2].base.getComponent(width)) / 2);
        c.setComponent(thick, this.strings[0].base.getComponent(thick));
        const center = c.multiplyScalar(s).applyQuaternion(q).add(this.root.position);

        const longDir = _unit(long).applyQuaternion(q).normalize();
        const widthDir = _unit(width).applyQuaternion(q).normalize();
        const thickDir = _unit(thick).multiplyScalar(VIOLIN_CFG.upSign).applyQuaternion(q).normalize();

        // 四根弦各自的世界位置（按弦对齐弓的宽度中心用）
        const stringWidths = this.strings.map((str) => {
            const p = new THREE.Vector3();
            p.setComponent(long, str.base.getComponent(long));
            p.setComponent(width, str.base.getComponent(width));
            p.setComponent(thick, str.base.getComponent(thick));
            return p.multiplyScalar(s).applyQuaternion(q).add(this.root.position);
        });

        return { center, longDir, widthDir, thickDir, longSpan: this._axes.longSpan * s, stringWidths };
    }
}