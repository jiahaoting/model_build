import * as THREE from 'three';

// ============================================================
// 下落音符块控制器（Falling Notes Controller）
// 职责：把谱面调度(schedule)实时映射为 CanvasTexture 上的「下落色块」，
//   在对应键位列内投放纤细纯色方块，并在落地瞬间扩散一圈涟漪反馈。
//
// 设计要点（参考 Synthesia / SeeMusic 等成品下落式可视化）：
//   - 纯色 fillRect：无逐块渐变、无逐块光晕，发光统一交由 Bloom 后处理
//   - 白键满宽、黑键 0.56 键宽，与键盘条绘制键宽一致，落地精准对位
//   - 滑动窗口游标 fallIdx 只进不退，避免每帧从头扫描事件表（性能）
//   - 反馈克制：仅落地瞬间一圈淡出涟漪，不堆叠粒子爆炸、不喧宾夺主
//
// 可扩展：更换玩法/模式时只需替换 scheduleRef 数据源与 keyX 键位映射；
//   新增「球体下落」「斜面下落」等模式时，在 renderBlocks 中复用本游标逻辑即可。
// ============================================================

const FALL_COLOR = '#2a5fd0';   // 下落色块主体纯色（深蓝）
const MAX_DUR = 0.7;            // 色块最大时长（秒）：超长音（延音/长和弦）的条不会无限拉长

export class FallingNotesController {
    /**
     * @param {object}  cfg          布局配置 { keyW, keyTop, fallHorizon, fallPxPerSec, barH }
     * @param {Function} scheduleRef  () => app.pianoSchedule（{ playing, elapsed, events }）
     * @param {Function} keyX        (midi) => 画布横坐标（键位列中心）
     */
    constructor(cfg, scheduleRef, keyX) {
        this.cfg = cfg;
        this.scheduleRef = scheduleRef;
        this.keyX = keyX;

        this.fallIdx = 0;               // 滑动窗口游标（只增不减）
        this.ripples = [];              // 落地扩散涟漪列表
        this._landed = new Set();       // 已触键（落地）事件索引，防重复生成涟漪
        this._lastEvents = null;        // 用于检测切曲（events 引用变化）
    }

    _isWhite(midi) { return [0, 2, 4, 5, 7, 9, 11].indexOf(midi % 12) >= 0; }

    // 切曲 / 停止时复位：清理游标、涟漪与落地标记
    reset() {
        this.fallIdx = 0;
        this.ripples.length = 0;
        this._landed.clear();
        this._lastEvents = null;
    }

    // 每帧更新：推进涟漪动画
    update(dt) {
        for (let i = this.ripples.length - 1; i >= 0; i--) {
            const r = this.ripples[i];
            r.life += dt;
            if (r.life >= r.maxLife) this.ripples.splice(i, 1);
        }
    }

    // 绘制下落色块（应在键盘层之下调用，落地即被键盘遮挡）
    renderBlocks(ctx) {
        const schedule = this.scheduleRef();
        if (!schedule || !schedule.playing || !schedule.events) {
            this.fallIdx = 0;
            return;
        }
        // 切曲检测：新 events 引用 → 复位游标与落地标记
        if (schedule.events !== this._lastEvents) {
            this._lastEvents = schedule.events;
            this.fallIdx = 0;
            this._landed.clear();
        }

        const cfg = this.cfg;
        const elapsed = schedule.elapsed || 0;
        const span = cfg.fallHorizon;
        const pxPerSec = cfg.fallPxPerSec;
        const minBarH = cfg.barH;
        const keyTop = cfg.keyTop;

        // 滑窗游标：越过已完整结束的历史音，避免每帧从头扫描整个事件表
        while (this.fallIdx < schedule.events.length) {
            const ev = schedule.events[this.fallIdx];
            if (ev.type !== 'on' || (ev.inst && ev.inst !== 'piano')) { this.fallIdx++; continue; }
            const d = Math.min((ev.dur != null && ev.dur > 0) ? ev.dur : 0.03, MAX_DUR);
            if (ev.t + d < elapsed) { this.fallIdx++; continue; }
            break;
        }

        for (let i = this.fallIdx; i < schedule.events.length; i++) {
            const ev = schedule.events[i];
            if (ev.type !== 'on') continue;
            if (ev.inst && ev.inst !== 'piano') continue;   // 非钢琴乐器不落在钢琴魔法屏上
            if (ev.t > elapsed + span) break;       // events 升序，超出未来窗口即停止

            const remain = ev.t - elapsed;          // >0 尚未落地；<0 已按、条继续下沉
            const dur = Math.min((ev.dur != null && ev.dur > 0) ? ev.dur : 0.03, MAX_DUR);
            const x = this.keyX(ev.midi);
            // 宽度与琴键精确对齐：白键满宽、黑键 0.56 键宽（不额外加光晕，保持纤细）
            const w = this._isWhite(ev.midi) ? cfg.keyW - 1 : cfg.keyW * 0.56;
            const barBottom = keyTop - remain * pxPerSec;
            const barTop = keyTop - (remain + dur) * pxPerSec;
            const h = Math.max(minBarH, barBottom - barTop);
            const near = THREE.MathUtils.clamp(1 - remain / span, 0, 1);  // 0=最远 1=即将/已落地
            const v = THREE.MathUtils.clamp((ev.vel == null ? 80 : ev.vel) / 127, 0.15, 1);
            const bx = x - w / 2;

            // 纯色方块，远淡近实、力度越大越亮；发光由 Bloom 后处理统一提供
            ctx.globalAlpha = THREE.MathUtils.clamp((0.30 + near * 0.55) * (0.55 + v * 0.5), 0.12, 1);
            ctx.fillStyle = FALL_COLOR;
            ctx.fillRect(bx, barTop, w, h);

            // 落地瞬间（remain 刚 ≤ 0 且尚未标记）：生成一圈扩散涟漪作为击中反馈
            if (remain <= 0 && !this._landed.has(i)) {
                this._landed.add(i);
                this._spawnRipple(x, v);
            }
        }
        ctx.globalAlpha = 1;
    }

    // 绘制落地涟漪（应在键盘层之上调用，使环显示在触键点上方）
    renderRipples(ctx) {
        for (const r of this.ripples) {
            const k = THREE.MathUtils.clamp(r.life / r.maxLife, 0, 1);
            const radius = r.r0 + (r.r1 - r.r0) * k;
            const alpha = (1 - k) * 0.55;
            if (alpha <= 0) continue;
            ctx.strokeStyle = `rgba(150,185,255,${alpha})`;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    _spawnRipple(x, vel) {
        this.ripples.push({
            x, y: this.cfg.keyTop - 4,
            life: 0, maxLife: 0.30 + vel * 0.18,
            r0: 2, r1: 6 + vel * 12
        });
    }
}