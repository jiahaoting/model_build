// ============================================================
// 钢琴家演奏演示（本地 GLB 骨骼模型 · 通用人形 + 完整手指骨骼）
// - 模型：assets/models/jared_leto_avatar.glb（Ready Player Me 人形，74 关节，含每手 5 指 × 4 段）
// - 骨骼名已按 boneKey() 归一化，兼容 Mixamo（mixamorig:Name）与 RPM（Name_NN）两种命名
// - 出场：从舞台幕布后两侧平稳上台 → 走向钢琴 → 自然落座
// - 手部：世界空间双骨 IK 定位手腕 + 按谱将音符映射到手指分段弯曲落键
// - 谱面驱动：AudioContext 时钟调度每个音符按下/释放，同步琴键下压与发声
// ============================================================
import * as THREE from 'three';
import { CONCERT } from './concertHall.js';
import { getScoreById, normalizeScore } from './scores.js';
import { createViolinPerformance } from './violinPerformance.js';

const BIND = {
    hips: 'Hips', spine: 'Spine', spine2: 'Spine2',
    neck: 'Neck', head: 'Head',
    lShoulder: 'LeftShoulder', lArm: 'LeftArm', lFore: 'LeftForeArm', lHand: 'LeftHand',
    rShoulder: 'RightShoulder', rArm: 'RightArm', rFore: 'RightForeArm', rHand: 'RightHand',
    lUpLeg: 'LeftUpLeg', lLeg: 'LeftLeg', lFoot: 'LeftFoot',
    rUpLeg: 'RightUpLeg', rLeg: 'RightLeg', rFoot: 'RightFoot'
};

const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];

// 角色整体缩放：当前模型（约 1.8m）相对琴凳/钢琴偏大，肩部过高，导致手腕悬于琴键上方。
// 缩小后肩部与整条手臂整体下降、更贴合琴键；此值在加载/标定之前统一应用，坐高会自动适配。
const PERFORMER_SCALE = 0.85;

// 拟人度/平滑度量化诊断开关：true 时每秒在控制台额外打印击键 F1、腕姿合规、指弓、手部平滑度等客观指标
const PERF_METRICS = true;

// 骨骼名归一化：不同来源模型的命名惯例不同——
//   Mixamo : "mixamorig:Hips"（Three.js 加载时可能已去冒号为 "mixamorigHips"）
//   RPM    : "Hips_01"（名字 + 全局序号）
// 统一去掉 "mixamorig:" 前缀与尾部 "_NN" 序号，得到语义化名称（如 "Hips"、"LeftHandIndex1"）。
function boneKey(name) {
    return String(name || '').replace(/^mixamorig:?/i, '').replace(/_\d+$/, '');
}

// —— 匈牙利算法（Kuhn–Munkres，最小代价赋权匹配） ——
// 源自 RoboPianist 的 OT 指法（linear_sum_assignment）：把「新增音符 → 空闲手指」的
// 一次性贪心升级为全局最优匹配，令整个手指集的总位移最小，消除和弦中"就近抢指"造成
// 的交叉指与无谓移手。行=待分配音符、列=可用手指，行数≤列数（特殊情况兜底为贪心）。
function hungarianAssign(cost) {
    const n = cost.length;
    if (n === 0) return [];
    const m = Math.max(...cost.map((r) => r.length));
    if (n > m) return null; // 非同手覆盖（音符>手指），交由贪心复用兜底
    const INF = 1e9;
    const u = new Array(n + 1).fill(0);
    const v = new Array(m + 1).fill(0);
    const p = new Array(m + 1).fill(0);
    const way = new Array(m + 1).fill(0);
    for (let i = 1; i <= n; i++) {
        p[0] = i;
        let j0 = 0;
        const minv = new Array(m + 1).fill(INF);
        const used = new Array(m + 1).fill(false);
        do {
            used[j0] = true;
            const i0 = p[j0];
            let delta = INF;
            let j1 = -1;
            for (let j = 1; j <= m; j++) {
                if (!used[j]) {
                    const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
                    if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
                    if (minv[j] < delta) { delta = minv[j]; j1 = j; }
                }
            }
            for (let j = 0; j <= m; j++) {
                if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
                else minv[j] -= delta;
            }
            j0 = j1;
        } while (p[j0] !== 0);
        do {
            const j1 = way[j0];
            p[j0] = p[j1];
            j0 = j1;
        } while (j0);
    }
    const ans = new Array(n);
    for (let j = 1; j <= m; j++) if (p[j] > 0) ans[p[j] - 1] = j - 1;
    return ans;
}

// 贪心就近分配兜底：仅在同手音符数 > 空闲手指的极端情况下使用（正常情形走 OT 最优匹配）。
function fallbackGreedyAssign(pending, free, home, next) {
    const freeSet = new Set(free);
    while (pending.length) {
        const pool = freeSet.size ? Array.from(freeSet) : [0, 1, 2, 3, 4];
        let bM = pending[0], bF = pool[0], bD = Infinity;
        for (const m of pending) {
            for (const f of pool) {
                const d = Math.abs(m - home[f]);
                if (d < bD) { bD = d; bM = m; bF = f; }
            }
        }
        next[bM] = bF;
        freeSet.delete(bF);
        pending.splice(pending.indexOf(bM), 1);
    }
}

// 平滑参数（帧率无关：实际以 1 - exp(-λ·dt) 做指数阻尼）
const WRIST_SMOOTH = 12;   // 手腕追踪平滑度（数值越大越“跟手”）
const CURL_SMOOTH = 18;    // 手指卷曲过渡平滑度
const CURL_PRESS = 0.55;   // 触键基准卷曲角（仅为 measureWristDrop 标定指腕落差外，非演奏逻辑；演奏已改 CCD 独立关节）
// —— 自然手型静息姿态先验（APR 思想 · 每指 MCP/PIP/DIP 三段独立屈曲角） ——
// 纯 IK 只约束指尖端点，会让近端关节（MCP/PIP）欠约束，产生"僵尸手"/关节反折。
// 故每根手指维护一组[近节 中节 远节]独立屈曲角作为软正则先验：IK 从先验出发收敛，
// 并轻微回拉向先验，保留自然指弓的同时让三段关节各有独立、连续的轨迹（而非锁死耦合）。
// 自然手型静息先验：MCP 近中性（指根微屈）、PIP 明显屈曲、DIP 轻屈 —— 复现钢琴家
// 「手掌整体隆起、手指呈穹顶形」的放松手型。三段幅度由近及远递减（MCP小/PIP大/DIP中），
// 使每根手指各有不同弯曲幅度，而非只靠指根下压。值较先前大幅提升以消除「平手/僵直」观感。
const FINGER_POSE = [
    [0.32, 0.56, 0.28],  // 拇指（对掌，更明显自然屈曲）
    [0.16, 0.95, 0.46],  // 食指
    [0.12, 0.80, 0.36],  // 中指（最舒展，但仍保持指弓）
    [0.20, 0.95, 0.46],  // 无名指
    [0.28, 1.12, 0.56],  // 小指（最弯，形成手部横向穹顶）
];
// 左手额外拱度放大：真实演奏中左手（低音区）常呈现更高的指弓/隆起，以拇指对掌覆盖低音连奏。
// 仅作用于左手静息先验，弥补「左手隆起幅度不足」的反馈；右手保持标准拱度。
const LEFT_ARCH_BOOST = 1.35;
const FINGER_POSE_L = FINGER_POSE.map(p => [p[0] * LEFT_ARCH_BOOST, p[1] * LEFT_ARCH_BOOST, p[2] * LEFT_ARCH_BOOST]);
const IK_PRIOR_WEIGHT = 0.25;   // 关节角向静息先验回拉权重（0=纯IK/1=纯先验，APR 软正则）
// —— 远端关节最小残留拱度（弧度） ——
// 压键/够键时 CCD 为延伸可达可能把 PIP/DIP 拉直到近 0，令前端关节"无活动"而只留指根下压。
// 对 PIP/DIP 施加下限，保证无论够多远键，近节/远节指间关节都保留一定屈曲，维持整体指弓。
const ARCH_FLOOR = [0, 0.56, 0.28]; // [MCP不设下限, PIP最小屈曲, DIP最小屈曲]
// 标定用 MCP:PIP:DIP 耦合权重（仅用于 measureWristDrop 测量卷曲指尖落差，见下方注释）。
const CURL_SEG_W = [0.55, 1.0, 0.7];
// 各段屈曲角硬上限（弧度，约 MCP 90° / PIP 100° / DIP 80° 生理活动度），钳制越界反折。
const CURL_SEG_MAX = [1.5, 1.6, 1.3];
// —— 手指外展/内收（MCP 第二自由度） ——
// 纯「单轴卷曲」把手指锁死在掌指平面内，一旦键位侧向偏移就只得整只手横移（生硬）。
// 给 MCP 增加绕背侧-掌侧轴的外展自由度，手指可自行侧向张开去够键，减少移手。
// 左右手各指生理外展上限不同：中指最受束、食/小指最灵活。
const ABD_MAX = [0.32, 0.40, 0.10, 0.24, 0.40]; // 每指最大外展（弧度）[拇 食 中 无 小]：贴近各指生理外展上限
const ABD_PRIOR_WEIGHT = 0.30;                // 外展角向 0（并拢）软回拉权重，静息时不散开
// 外展过渡平滑度（独立于卷曲 CURL_SMOOTH）：外展是「横向开合」的大角度动作，需要更绵长流畅的过渡；
// 再叠加速度增益（强音张开更干脆、弱音更轻柔），消除手指张合时统一的机械匀速感。
const ABD_SMOOTH = 14;
// —— 手指独立性与本位分配（专业手势优化·第2步） ——
// 每根手指在键盘上的"本位"（相对手部中心寄存器的半音偏移）：拇指最低、小指最高，
// 近似自然五指张开的音域（如 C 大调 C-D-E-F-G 手指位）。据此让每根手指独立稳定地
// 控制各自键位邻近的音符，单音旋律随音区自然换指，而非每次都落到同一根手指。
const FINGER_HOME = [-4, -2, 0, 1, 3]; // [拇指 食指 中指 无名指 小指]
// 手部"本位寄存器"的平移阈值（半音）：仅当按键质心偏离本位超过该值时整只手才平移，
// 否则手指在本位内就近按键（真实演奏中"移手"是离散的大跨度动作，而非每个音都跟手）。
const REG_SNAP = 3.5;
// —— 手腕协调（专业手势优化·第3步） ——
// 纵向浮动：强奏手腕稍沉（借用自重）、弱奏稍抬，并叠加轻微呼吸起伏，避免手腕锁死在固定高度。
const WRIST_DYN_AMP = 0.008;        // 力度→腕高浮动幅度（米，约 8mm）
const WRIST_BREATH = 0.004;         // 手腕呼吸起伏幅度（米）
// 腕轨迹键位偏移先验（Tipiano 第3阶段「基于键位偏移的腕估计」）：演奏宽和弦/大跨时，
// 真实钢琴家手腕大致对齐手掌中心（手本位），而非被最外侧手指拉偏到音符质心。
// 手跨越大、腕越向手本位寄存器回靠；手跨小（单音/窄音程）则腕贴近手指落点。
const WRIST_REG_PULL = 0.35;        // 腕侧向回靠手本位的最大比例（0=贴质心 1=完全对齐本位）
// 手跨（最外侧按键世界 Z 跨度）达到该值（米）时，腕回靠手本位的比例达到满额 WRIST_REG_PULL。
const WRIST_REG_SPAN = 0.20;        // 约一个半八度的键面横向跨度，作为「腕回靠」满额基准
// 横滚（随拇指↔小指重心）：弹偏拇指侧手腕略内旋、偏小指侧略外旋，随键位实时协调而非纯摆动。
const WRIST_ROLL_PER_FINGER = 0.022; // 每偏离中指一档的横滚角（弧度，约 1.2°）
// 尺/桡侧偏（ulnar/radial deviation，腕左右摆）：随拇指↔小指重心让手腕在水平面内偏摆，
// 使手部更直接地“够到”侧向琴键，减少整臂左右平移（僵硬感的主要来源之一）。
const WRIST_YAW_PER_FINGER = 0.05;   // 每偏离中指一档的手腕尺桡偏角（弧度，约 2.9°）
// —— 腕姿生物力学中立范围（Savvidou 等《Assessing Injury Risk In Pianists》）——
// 肘/腕极端角度与演奏相关肌肉骨骼疾病显著相关，故对手腕尺/桡偏与旋前/旋后做软钳制：
// 尺偏下限 -5°、桡偏上限 +15°（真实钢琴家中立腕范围），前臂旋前/旋后限制在 ±9° 内避免过度旋腕。
const WRIST_YAW_LO = -0.087;   // 尺偏（ulnar deviation）下限 ≈ -5°
const WRIST_YAW_HI = 0.262;    // 桡偏（radial deviation）上限 ≈ +15°
const WRIST_ROLL_MAX = 0.157;  // 前臂旋前/旋后（pronation/supination）±9°，防止手掌翻转/锁死
// —— 抬指-下压（击键）动作序列：每个音符按下前先「抬指」形成蓄势，再「下压」击键，
//    严禁仅保持姿势而不作实际下压。抬指/下压现通过对「指尖世界目标 Y」施加弧线实现
//    （见 placeArmAndHand 中的每指 IK，幅度随按压力度 vel 缩放），不再对卷曲角取负。
const LIFT_DUR = 0.04;        // 抬指准备时长（秒，较快）
const STRIKE_DUR = 0.10;      // 下压击键时长（秒）
// 指尖贴键的基础深度（世界米）：手指接触琴键时仅略微贴住键面，而非穿入键体；
// 叠加随力度微调项后总深度约 0.8~2mm，远小于白键 12mm 厚，从几何上杜绝手指穿透琴键。
const KEY_CONTACT_DEPTH = 0.0008;
// —— 预期性动作（FürElise 专家评估指出的关键差距）：手/腕在音符到来前就预先靠拢，而非纯反应式跟手 ——
const ANTICIPATE_HORIZON = 0.28;  // 前瞻时间窗（秒）：仅统计未来这么久内即将按下的音符
const WRIST_LEAD = 0.18;          // 腕目标向「未来音符质心」前馈的比例（0=纯反应 1=完全前瞻）
// 距离缩放前瞻（FürElise「预期性动作」）：跳转越大，前瞻越早越强——大跳（如八度/大跨琶音）需要
// 手臂在音符到来前更早、更充分地就位，而非纯反应式临时甩臂。按键面横向 Z 距离线性增强，封顶 LEAD_MAX。
const LEAP_LEAD_PER_M = 0.35;     // 每 1m 键面横向跳转额外增加的前瞻权重
const LEAD_MAX = 0.6;             // 前瞻前馈上限，避免极端大跳时腕越过目标（来回甩动手臂）
const SIT_THIGH = 1.15;    // 落座大腿前抬角
const SIT_CALF = -1.25;    // 落座小腿回收角
const SIT_SEAT_CLEAR = 0.03; // 落座时髋部高于凳面软垫顶的补偿量（米），避免臀部/大腿网格穿入琴凳
// —— 延音踏板（CC64）脚部动作：右脚踏下时脚踝绕其本地 X 轴轻微跖屈（脚尖下压）。
//    负号使脚尖朝下（若模型脚骨 +X 为背屈，则此处需反号微调）。角度小、贴合真实踏板的细微幅度。
const PEDAL_FOOT_ROT = -0.18;

// —— 骨架姿态阻尼：腿/脊柱的程序化旋转均通过指数阻尼追踪目标，
//    消除「出场→转身」「转身→落座」等相位切换时的瞬间突变（生硬感）。
const POSE_SMOOTH = 11;    // 姿态过渡平滑度
const KEY_CLEAR = 0.004;   // 指尖与键面目标间隙（约 4mm，贴合琴键又不穿键）
const BIAS_DAMP = 4.0;     // 指尖贴键高度偏置收敛速率（慢而稳，避免抖动）

// —— 肘部自然屈曲：保证手臂从不“锁死”伸直，肘部随键位变化呈现不同程度的自然弯曲。
const ELBOW_MIN_FLEX = 1.396;  // 手肘弯曲角目标（弧度，约 80°），保持自然弯曲，避免锁死式完全伸直
const ELBOW_FLEX_R = 1.239;     // 右手肘弯曲角（弧度，约 71°）——右臂略小角度，使左右臂伸展距离一致
const WRIST_BACK = 0.08;       // 手腕相对键位向身体内收距离（米，沿 +Z）——小幅内收让手指前伸，指尖落键
// 肘部弯曲轴（每侧独立）：使肘部「向下微沉」的同时「向外张开」，而非上顶或紧贴躯干内收。
// 演奏者坐态面向 -Z（朝琴键）：弯曲轴 = (-ELBOW_DROP, ±ELBOW_ABDUCT, 0)，主分量 -X 让肘下沉、
// ±Y 让肘左右外展。左右对称外张，消除单侧内收的僵硬。
const ELBOW_DROP = 1.0;      // 沉肘（向下）分量（沿 -X 轴施加，使肘下沉）
const ELBOW_ABDUCT = 0.30;   // 肘部外展分量（沿 ±Y 施加，越大肘越向两侧张开）
const ELBOW_SWAY = 0.04;     // 肘部呼吸摆动幅度：随音乐轻微内外起伏，避免锁死、增加灵活度
const HANG_ELBOW_FLEX = 0.22; // 站立/行走时手臂自然下垂的肘部屈曲（弧度，约 12°）——接近伸直、不锁死，避免“僵硬支臂”

// —— 动态演奏：身体前倾随音乐力度起伏（弱奏浅倾、强奏深倾），并平滑过渡
const DYNAMICS_SMOOTH = 2.6;   // 力度→前倾过渡速率（时间常数约 0.38s，对应 0.3-0.5s 过渡）
const LEAN_PIANO_FRAC = 0.40;  // 弱奏前倾幅度 = 强奏的 40%（约 7°）
const TORSO_TWIST = 0.09;      // 躯干微妙扭转幅度（约 5.2°，位于 5-10° 人体自然范围）

// —— 演奏前倾姿态：从下胸/腰→上胸→颈→头逐节向前弯腰、压低头部，
//    使肩膀更贴近琴键（缩小肩→键距离），确保指尖能自然舒适地落到键面。
//    注：经实测该模型骨骼基向量（局部 +Y 轴经 +X 旋转转向局部 +Z=正前方），
//    故「正 X 旋转 = 向前（朝琴键）俯身」。
const LEAN_SPINE  = 0.30;   // 下胸/腰前倾（约 17°）
const LEAN_SPINE2 = 0.16;   // 上胸前倾
const LEAN_NECK   = 0.12;   // 颈部前倾
const LEAN_HEAD   = 0.20;   // 头部下压，视线看向琴键
const LEAN_SHOULDER = 0.34; // 肩胛/锁骨前旋（前伸+下沉），拉近肩→键距离、配合沉肘形成自然前伸

export function createPerformer(app, audio, world) {
    const scene = app.scene;
    const gltf = app.assets && app.assets.performer;

    // 小提琴演奏模型：把位 + 弓法 + 技法（揉弦/滑音/跳弓/颤音）推断与描述
    const vperf = createViolinPerformance();

    const STAGE_Y = CONCERT.stage.topY;
    const P = CONCERT.piano;
    const benchX = CONCERT.bench.x, benchZ = CONCERT.bench.z;

    // —— 模型根节点 ——
    const root = new THREE.Group();
    root.name = 'performer';
    root.scale.setScalar(PERFORMER_SCALE);
    scene.add(root);

    let modelRoot = null;
    let skinnedMesh = null;
    const B = {};                       // 名称 -> 骨骼
    const restQuat = {};                // 名称 -> rest pose 四元数（加载时捕获）
    let bindDirs = null;                // 每块骨骼的「生长方向」（自身局部空间，加载时测一次）
    let standingHipY = 0.9;             // 站立时髋部相对地面(root原点)的高度，加载后实测一次，用于落座标定

    function findSkinnedMesh(o) {
        if (o.isSkinnedMesh) return o;
        for (const c of o.children) { const r = findSkinnedMesh(c); if (r) return r; }
        return null;
    }

    if (gltf && gltf.scene) {
        modelRoot = gltf.scene;
        skinnedMesh = findSkinnedMesh(modelRoot);
        if (skinnedMesh && skinnedMesh.skeleton) {
            skinnedMesh.frustumCulled = false;
            // 统一用归一化后的骨骼名作键（boneKey），与 BIND / 手指骨骼查找保持一致。
            for (const b of skinnedMesh.skeleton.bones) {
                const k = boneKey(b.name);
                if (k) B[k] = b;
            }
        }
        modelRoot.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
        root.add(modelRoot);
        // 模型朝 +Z（脚尖朝 +Z），这里统一记前进方向为 +Z
        // 捕获 rest pose（绑定姿态）四元数，之后所有程序化旋转都相对它叠加
        for (const name in B) restQuat[name] = B[name].quaternion.clone();
        measureBoneDirs();
        // 归一化地面：把模型最底部（脚/脚尖）对齐到 root 原点，确保站立时贴地、不悬空。
        // 注意 root 已应用 PERFORMER_SCALE，modelRoot.position 是 root 局部坐标，
        // 需除以 root.scale.y 才能让「世界空间」的脚底精确归零，避免整体缩放后脚底悬空。
        root.updateMatrixWorld(true);
        let groundY = Infinity;
        const _p = new THREE.Vector3();
        for (const k of ['LeftFoot', 'LeftToeBase', 'LeftToe_End', 'RightFoot', 'RightToeBase', 'RightToe_End']) {
            const b = B[k];
            if (b) groundY = Math.min(groundY, b.getWorldPosition(_p).y);
        }
        if (isFinite(groundY)) modelRoot.position.y -= groundY / root.scale.y;
        // 落座标定基准：记录站立姿态下髋部的世界高度（此时 root 位于原点、脚底对齐地面）。
        // 该值只与模型自身比例有关，与 root 后续所处舞台/琴凳位置无关，故在整个生命周期内恒定，
        // 用于每次演奏的落座目标，消除「偶次播放时 root 位置累积 → 髋部高度漂移 → 角色坠落」的 bug。
        root.updateMatrixWorld(true);
        if (B[BIND.hips]) standingHipY = B[BIND.hips].getWorldPosition(new THREE.Vector3()).y;
    }
    console.log('[performer] 模型加载:', !!modelRoot, '| skinnedMesh:', !!skinnedMesh, '| 骨骼数:', Object.keys(B).length);

    // 测量每块骨骼在自身局部空间的「生长方向」（取其最远子骨骼方向，避免 RPM 前臂扭曲骨干扰）。
    function measureBoneDirs() {
        bindDirs = {};
        for (const name in B) {
            const b = B[name];
            let child = null, best = 0;
            for (const c of b.children) {
                if (c.isBone) {
                    const d = c.position.lengthSq();
                    if (d >= best) { best = d; child = c; }
                }
            }
            if (child) bindDirs[name] = child.position.clone().normalize();
        }
    }

    function bone(name) { return B[name]; }

    const V = new THREE.Vector3();
    function bonepos(name, out) {
        const b = B[name];
        b.getWorldPosition(out || new THREE.Vector3());
    }

    // ============================================================
    // 骨架测量（加载后，基于 bind pose 计算臂长 / 指长等）
    // ============================================================
    const armLen = { L: { upper: 0.31, fore: 0.22 }, R: { upper: 0.31, fore: 0.22 } };

    function measureArms() {
        root.updateMatrixWorld(true);
        for (const side of ['L', 'R']) {
            const arm = side === 'L' ? B[BIND.lArm] : B[BIND.rArm];
            const fore = side === 'L' ? B[BIND.lFore] : B[BIND.rFore];
            const hand = side === 'L' ? B[BIND.lHand] : B[BIND.rHand];
            armLen[side].upper = arm.getWorldPosition(new THREE.Vector3()).distanceTo(fore.getWorldPosition(new THREE.Vector3()));
            armLen[side].fore = fore.getWorldPosition(new THREE.Vector3()).distanceTo(hand.getWorldPosition(new THREE.Vector3()));
        }
    }

    // 实测「卷曲后指尖相对手腕的竖向落差」。在绑定姿态下把食指/中指卷曲到 CURL_PRESS，
    // 实测手骨世界 Y 与最低指尖世界 Y 之差，作为腕高前馈基准（比经验值 reach*0.5 更贴合真实几何）。
    function measureWristDrop() {
        root.updateMatrixWorld(true);
        for (const side of ['L', 'R']) {
            const hb = side === 'L' ? handL : handR;
            const handB = side === 'L' ? B[BIND.lHand] : B[BIND.rHand];
            if (!handB) continue;
            const saved = {};
            for (const i of [1, 2]) {   // 食指、中指（居家键位）
                const f = hb.fingers[i];
                if (!f) continue;
                saved[i] = [f[0] && f[0].rotation.x, f[1] && f[1].rotation.x, f[2] && f[2].rotation.x];
                // 与 placeArmAndHand 一致：手指沿本地 +X 卷曲（该 RPM 模型绕 Z 会反向抬指），
                // 采用相同的 MCP:PIP:DIP 耦合权重，保证腕高前馈与演奏时指尖落点一致。
                if (f[0]) f[0].rotation.x = CURL_PRESS * CURL_SEG_W[0];
                if (f[1]) f[1].rotation.x = CURL_PRESS * CURL_SEG_W[1];
                if (f[2]) f[2].rotation.x = CURL_PRESS * CURL_SEG_W[2];
            }
            root.updateMatrixWorld(true);
            const handY = handB.getWorldPosition(new THREE.Vector3()).y;
            let tipY = Infinity;
            for (const i of [1, 2]) {
                const tip = hb.fingers[i] && hb.fingers[i][3];
                if (tip) tipY = Math.min(tipY, tip.getWorldPosition(new THREE.Vector3()).y);
            }
            const drop = handY - tipY;
            if (isFinite(drop) && drop > 0) wristDrop[side] = drop;
            for (const i of [1, 2]) {
                const f = hb.fingers[i];
                if (!f) continue;
                if (f[0]) f[0].rotation.x = saved[i][0];
                if (f[1]) f[1].rotation.x = saved[i][1];
                if (f[2]) f[2].rotation.x = saved[i][2];
            }
        }
        root.updateMatrixWorld(true);
    }

    // ============================================================
    // 琴键世界坐标映射
    // ============================================================
    let keyMap = new Map();
    let keyTopY = STAGE_Y + 0.75;

    function ensureKeyMap() {
        keyMap.clear();
        const keys = app.pianoKeys || [];
        scene.updateMatrixWorld(true);
        if (keys.length) {
            const v = new THREE.Vector3();
            let sumY = 0, n = 0;
            for (const k of keys) {
                k.mesh.getWorldPosition(v);
                // 琴键「顶面」世界高度：优先每键实测 topOffset（Steinway 真实键网格，原点=几何中心）；
                // 回退到程序化键常量：白键半厚 6mm；黑键半高 5.5mm。存顶面而非网格中心，
                // 使指尖目标与按键时真实接触面一致，避免黑键偏高、白键偏低的平均失真。
                const topY = v.y + (k.topOffset != null ? k.topOffset : (k.white ? 0.006 : 0.0055));
                keyMap.set(k.midi, { x: v.x, y: topY, z: v.z, key: k });
                sumY += topY;
                n++;
            }
            if (n) keyTopY = sumY / n;

            // —— 诊断：键面前缘世界 X、键盘左右 Z 范围、琴体包围盒（用于座椅定位，避免琴凳穿入琴体） ——
            const dv = new THREE.Vector3();
            let frontSum = 0, frontN = 0, zMin = Infinity, zMax = -Infinity;
            for (const k of keys) {
                k.mesh.getWorldPosition(dv);
                if (k.white) { frontSum += dv.x + (k.halfDepth != null ? k.halfDepth : 0.075); frontN++; }  // 白键半深 → 前缘
                zMin = Math.min(zMin, dv.z); zMax = Math.max(zMax, dv.z);
            }
            let pianoBox = null;
            if (keys[0]) {
                let p = keys[0].mesh.parent; let guard = 0;
                while (p && guard < 6) {
                    if (p.type === 'Group' && p.parent && p.parent.type === 'Scene') { pianoBox = new THREE.Box3().setFromObject(p); break; }
                    p = p.parent; guard++;
                }
            }
            const b = pianoBox ? new THREE.Box3(pianoBox.min.clone(), pianoBox.max.clone()) : null;
            console.log('[performer] 键面几何 前缘X=', (frontN ? (frontSum / frontN) : 0).toFixed(3),
                '| 键盘Z范围=', zMin.toFixed(3), '~', zMax.toFixed(3),
                '| 琴体box X=', pianoBox ? (pianoBox.min.x.toFixed(3) + '~' + pianoBox.max.x.toFixed(3)) : '—',
                'Z=', pianoBox ? (pianoBox.min.z.toFixed(3) + '~' + pianoBox.max.z.toFixed(3)) : '—');
        }
    }

    function keyWorldPos(midi) {
        let p = keyMap.get(midi);
        if (!p) {
            const t = (midi - 21) / (108 - 21);
            p = { x: P.x + (0.6 - t * 1.2), y: keyTopY, z: P.z - 0.08 };
        }
        return p;
    }

    // 任意（可非整数）半音位置在键盘上的世界横向 X 坐标：对相邻两个真实琴键坐标线性插值，
    // 供腕轨迹键位偏移先验（阶段2）在「手本位寄存器」为浮点值时平滑取横向落点。
    // 注意：Steinway 键盘沿世界 X 横向排列（键盘前缘朝 +Z），故「横向」用 X，而非 Z。
    function keyXAt(midi) {
        const lo = Math.floor(midi), hi = Math.ceil(midi);
        if (lo === hi) return keyWorldPos(lo).x;
        const a = keyWorldPos(lo).x, b = keyWorldPos(hi).x;
        return a + (b - a) * (midi - lo);
    }

    // ============================================================
    // 状态机：hidden → entering → turning → sitting → playing → finished → idle
    // ============================================================
    // Opera House：钢琴键盘朝 +Z、琴体尾部朝 -Z。演奏者就坐于键盘前方 +Z 侧（白/黑键一侧），
    // 面向 -Z（朝琴体）。入场从舞台右侧（观众视角右侧 = +Z，即键盘一侧）沿直线走向琴凳后落座。
    const WALK_SPEED = 0.95;   // 自然步速（m/s），避免“漂移太快”
    const STRIDE_LEN = 1.25;   // 一个完整步态周期（两步）前进距离（米），用于锁定步频与位移
    const enterStart = new THREE.Vector3(benchX, STAGE_Y, benchZ + 5.5);
    const enterEnd = new THREE.Vector3(benchX, STAGE_Y, benchZ + 0.15);
    const enterDist = enterStart.distanceTo(enterEnd);
    const walkYaw = Math.atan2(enterEnd.x - enterStart.x, enterEnd.z - enterStart.z);
    const SIT_YAW = Math.PI;   // 面向 -Z（朝琴体/键盘）

    let phase = 'hidden';
    let phaseT = 0, phaseDur = 1;
    let currentTitle = null;
    let norm = null, events = [], evIdx = 0, playStart = 0;
    let active = { L: [], R: [] };
    const fingerMap = { L: {}, R: {} };   // midi -> fingerIndex
    const handReg = { L: null, R: null };   // 每只手的键盘本位（半音），懒初始化、随音区平移
    let swayT = 0;
    let sitRootY = STAGE_Y;               // 落座后髋部世界高度
    let dynTarget = 0.45;                 // 目标动态强度（0=弱奏 1=强奏），由音符力度驱动
    let dynamics = 0.45;                  // 平滑后的动态强度（驱动前倾幅度）
    let pedalDown = false;                // 延音踏板（CC64）当前踩下状态，驱动右脚踏板与踏板下沉
    let handSplit = 60;                   // 左右手分界线（半音，默认 C4），由 buildEvents 按乐曲音高分布自适应

    // 平滑追踪状态（帧率无关指数阻尼，避免手腕/手指“瞬移”带来的生硬感）
    const curWrist = { L: null, R: null };
    // 每根手指三段[近节 中节 远节]屈曲角的当前值（阻尼后），供平滑过渡、消除瞬变。
    const curFlex = {
        L: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
        R: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]
    };
    // 每根手指 MCP 外展角（弧度）的当前值（阻尼后），供二自由度 MCP 单独平滑过渡
    const curAbd = { L: [0, 0, 0, 0, 0], R: [0, 0, 0, 0, 0] };
    // 抬指-下压触键状态机：记录每根手指自最近一次触键以来的秒数与上一帧是否按下，
    // 以便每次新按下时触发一次完整「抬指→下压」动作序列，而非呆板保持姿势。
    const fingerClock = { L: [0, 0, 0, 0, 0], R: [0, 0, 0, 0, 0] };
    const fingerPrev = { L: [false, false, false, false, false], R: [false, false, false, false, false] };
    // 按压力度：fingerVel=每根手指当前触发音符的力度（0~1）；noteVel=当前按住音符 midi→力度。
    const fingerVel = { L: [0.5, 0.5, 0.5, 0.5, 0.5], R: [0.5, 0.5, 0.5, 0.5, 0.5] };
    const noteVel = { L: {}, R: {} };
    // 每个按住音符的起始时间（midi → t0 秒）：当同手按住数超过 5 指上限时，据此释放「最早按下」的音符让位
    const noteOnT = { L: {}, R: {} };

    // 骨架姿态平滑：poseTarget[name] = {x,y,z} 目标旋转增量，poseCur 为阻尼后当前值
    const poseTarget = {};
    const poseCur = {};

    // 指尖贴键闭环：每侧实测「最低按弦指尖的世界 Y」与手腕高度偏置
    const tipMeasY = { L: Infinity, R: Infinity };
    const tipHasMeas = { L: false, R: false };
    const heightBias = { L: 0, R: 0 };
    // 实测「卷曲指尖相对手腕的竖向落差」（米），作为腕高前馈基准，替代经验值 reach*0.5
    const wristDrop = { L: 0.05, R: 0.05 };
    let tipLogAcc = 0;   // 触键间隙诊断的累计计时（每秒打印一次）
    // —— 拟人度/平滑度量化指标采样状态（阶段5，供 PERF_METRICS 日志）——
    const wristPose = { L: { roll: 0, yaw: 0 }, R: { roll: 0, yaw: 0 } }; // 每侧实时腕姿（横滚/尺桡偏，rad）
    const prevWristZ = { L: null, R: null };   // 上一帧腕 Z（世界），用于平滑度(jerk)二阶差分
    const prevWristVel = { L: 0, R: 0 };       // 上一帧腕 Z 线速度（m/s）
    const wristJerk = { L: 0, R: 0 };          // 腕 Z 平滑度（|加速度|的 EMA，越小越平滑）

    // 三次缓动（smoothstep）：起止更缓，中间更快，动作语言更自然
    function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
    function handForMidi(midi) { return midi < handSplit ? 'L' : 'R'; }

    // 「抬指→下压」击键序列改由 placeArmAndHand 中的「每指 IK 指尖目标弧线」实现：
    // 指尖世界目标的 Y 先抬升（蓄势）再下压至键面，配合每指 IK 反解屈曲量，取代旧式固定卷曲角。

    // —— 手臂/手腕在各自父层局部空间的对准，以及手指 ——

    function armBones(side) {
        const s = side === 'L';
        return {
            arm: B[s ? BIND.lArm : BIND.rArm],
            fore: B[s ? BIND.lFore : BIND.rFore],
            hand: B[s ? BIND.lHand : BIND.rHand],
            side
        };
    }

    // 实测肘关节解剖学屈曲角（0°=完全伸直、越大越弯曲）：用于验证演奏时肘部保持自然屈曲而非锁死。
    function elbowFlexAngle(side) {
        const a = armBones(side);
        if (!a.arm || !a.fore || !a.hand) return 0;
        const sh = a.arm.getWorldPosition(new THREE.Vector3());
        const el = a.fore.getWorldPosition(new THREE.Vector3());
        const wr = a.hand.getWorldPosition(new THREE.Vector3());
        const upper = sh.sub(el);   // 肘→肩
        const fore = wr.sub(el);    // 肘→腕
        if (upper.lengthSq() < 1e-9 || fore.lengthSq() < 1e-9) return 0;
        return Math.PI - upper.angleTo(fore);   // 上臂与前臂内角 = 解剖学屈曲角
    }

    function handBones(side) {
        const p = side === 'L' ? 'Left' : 'Right';
        const out = { fingers: [] };
        for (let i = 0; i < 5; i++) {
            const f = [];
            for (let j = 1; j <= 4; j++) f.push(B[`${p}Hand${FINGERS[i]}${j}`]);
            out.fingers.push(f);
        }
        return out;
    }
    const handL = handBones('L');
    const handR = handBones('R');

    // ============================================================
    // 每指骨架链条 + 每指 IK（Tipiano「指尖先验」级联 · 用键位直接驱动指尖落点）
    // ============================================================
    // 每根手指在握手骨局部空间建模为「绕共同卷曲轴 curl 的三连杆平面链」：base(MCP)+lens[0..2]。
    // base/dir/curl 在 resetPose 状态下实测一次；之后每帧把链条变换到世界空间，用 CCD（循环
    // 坐标下降）对 MCP/PIP/DIP 三段做「独立」屈曲求解，使指尖精确落到各自的琴键目标。
    const handChains = { L: [], R: [] };

    function measureHandChains() {
        root.updateMatrixWorld(true);
        for (const side of ['L', 'R']) {
            const hb = side === 'L' ? handL : handR;
            const handBone = side === 'L' ? B[BIND.lHand] : B[BIND.rHand];
            const arr = [];
            handChains[side] = arr;
            if (!handBone) continue;
            const handInv = handBone.matrixWorld.clone().invert();
            for (let i = 0; i < 5; i++) {
                const f = hb.fingers[i];
                if (!f || !f[0] || !f[3]) { arr.push(null); continue; }
                const lp = [];
                for (let j = 0; j < 4; j++) {
                    const w = f[j].getWorldPosition(new THREE.Vector3());
                    lp.push(w.clone().applyMatrix4(handInv));
                }
                const base = lp[0].clone();
                const lens = [lp[1].distanceTo(lp[0]), lp[2].distanceTo(lp[1]), lp[3].distanceTo(lp[2])];
                const dir = lp[3].clone().sub(lp[0]).normalize();
                // 卷曲轴 = 手指骨骼本地 X 轴在手骨局部空间的取向（实测，兼容任意模型朝向/左右镜像）
                const xWorld = new THREE.Vector3(1, 0, 0).applyQuaternion(f[0].getWorldQuaternion(new THREE.Quaternion()));
                const curl = xWorld.clone().transformDirection(handInv).normalize();
                // 外展轴（MCP 第二自由度）= 背侧-掌侧轴：⊥ curl 且 ⊥ 手指生长方向。
                // 绕其旋转使指尖在键盘平面内左右扫动（开合手指），而非抬指/卷曲。
                const growth = lp[1].clone().sub(lp[0]).normalize();
                const fan = new THREE.Vector3().crossVectors(curl, growth).normalize();
                // 将外展轴映射回该指 MCP 骨骼的本地帧，供演奏时直接对 f[0] 施加第二自由度旋转
                const f0q = f[0].getWorldQuaternion(new THREE.Quaternion());
                const fanLocal = fan.clone().transformDirection(handBone.matrixWorld)
                    .applyQuaternion(f0q.clone().invert()).normalize();
                arr.push({ base, lens, dir, curl, fan, fanLocal });
            }
        }
    }

    // —— 每指 CCD（循环坐标下降）IK 求解用临时向量（避免每帧大量分配） ——
    const _ccdP = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const _ccdDir = new THREE.Vector3();
    const _ccdCurl = new THREE.Vector3();
    const _ccdFan = new THREE.Vector3();
    const _ccdTgt = new THREE.Vector3();
    const _ccdVa = new THREE.Vector3();
    const _ccdVb = new THREE.Vector3();
    const _ccdCross = new THREE.Vector3();
    const _target = new THREE.Vector3();

    // 求向量 v 到 w 关于轴 axis 的有符号夹角（右旋法则）。
    function _signedAngle(v, w, axis) {
        _ccdCross.crossVectors(v, w);
        return Math.atan2(axis.dot(_ccdCross), v.dot(w));
    }

    // 把关节 j 及其所有后代位置绕 pivot 点 P[j] 旋转 dt（CCD 的逐关节修正）。
    function _rotateFrom(j, dt, axis) {
        const pivot = _ccdP[j];
        for (let m = j + 1; m < 4; m++) {
            _ccdP[m].sub(pivot).applyAxisAngle(axis, dt).add(pivot);
        }
    }

    // CCD（循环坐标下降）每指 IK：MCP 拥有「屈曲(curl) + 外展(fan)」两自由度，PIP/DIP 仅屈曲。
    // 完整 3D 目标（不再投影到卷曲平面）：侧向分量由外展自由度消除，使指尖既能精确落键、
    // 又能自行侧向张开够键，而非每次整手横移。三段屈曲各自独立运动（APR 消除"僵尸手"），
    // 从「静息先验」出发并按 IK_PRIOR_WEIGHT 软回拉，保留自然指弓。out[0..2]=屈曲角，out[3]=外展角。
    function solveFingerIK(chain, target, handM, prior, abdMax, out) {
        const base = _ccdP[0].copy(chain.base).applyMatrix4(handM);
        const dir = _ccdDir.copy(chain.dir).transformDirection(handM);
        const curl = _ccdCurl.copy(chain.curl).transformDirection(handM);
        const fan = _ccdFan.copy(chain.fan).transformDirection(handM);
        const L = chain.lens;

        _ccdTgt.copy(target);

        // 从静息先验姿态展开关节位置（自然起点 → 解停在先验附近，等价于软正则）；外展从 0 起步。
        const ang = [prior[0], prior[1], prior[2]];
        let abd = 0;
        let acc = 0;
        for (let k = 0; k < 3; k++) {
            acc += ang[k];
            _ccdVa.copy(dir).applyAxisAngle(curl, acc);
            _ccdP[k + 1].copy(_ccdP[k]).addScaledVector(_ccdVa, L[k]);
        }

        for (let iter = 0; iter < 12; iter++) {
            // DIP → PIP → MCP 三段绕卷曲轴屈曲（由远及近）
            let dt = _signedAngle(_ccdVa.copy(_ccdP[3]).sub(_ccdP[2]), _ccdVb.copy(_ccdTgt).sub(_ccdP[2]), curl);
            ang[2] += dt; _rotateFrom(2, dt, curl);
            dt = _signedAngle(_ccdVa.copy(_ccdP[3]).sub(_ccdP[1]), _ccdVb.copy(_ccdTgt).sub(_ccdP[1]), curl);
            ang[1] += dt; _rotateFrom(1, dt, curl);
            dt = _signedAngle(_ccdVa.copy(_ccdP[3]).sub(_ccdP[0]), _ccdVb.copy(_ccdTgt).sub(_ccdP[0]), curl);
            ang[0] += dt; _rotateFrom(0, dt, curl);
            // MCP 外展：绕背侧-掌侧轴开合，消除指尖目标的侧向残余（第二自由度）
            dt = _signedAngle(_ccdVa.copy(_ccdP[3]).sub(_ccdP[0]), _ccdVb.copy(_ccdTgt).sub(_ccdP[0]), fan);
            abd += dt; _rotateFrom(0, dt, fan);
        }

        // 软回拉向静息先验（APR 正则），并钳制在生理活动度上限内；远端关节再叠加最小残留拱度，
        // 保证 PIP/DIP 始终保留自然屈曲（够键时不被拉直），呈现"手指整体隆起、各关节不同幅度弯曲"。
        out[0] = THREE.MathUtils.clamp(ang[0] + (prior[0] - ang[0]) * IK_PRIOR_WEIGHT, -0.15, CURL_SEG_MAX[0]);
        out[1] = Math.max(ARCH_FLOOR[1], THREE.MathUtils.clamp(ang[1] + (prior[1] - ang[1]) * IK_PRIOR_WEIGHT, -0.20, CURL_SEG_MAX[1]));
        out[2] = Math.max(ARCH_FLOOR[2], THREE.MathUtils.clamp(ang[2] + (prior[2] - ang[2]) * IK_PRIOR_WEIGHT, -0.15, CURL_SEG_MAX[2]));
        // 外展软回拉向 0（并拢）并钳制在每指最大开合内
        out[3] = THREE.MathUtils.clamp(abd * (1 - ABD_PRIOR_WEIGHT), -abdMax, abdMax);
    }

    // 世界空间双骨 IK（带最小肘部屈曲约束，避免手臂完全伸直导致的僵硬）
    function ik2BoneWorld(origin, target, lenA, lenB, bendAxis, elbowFlex = ELBOW_MIN_FLEX) {
        const base = new THREE.Vector3().subVectors(target, origin);
        const dist = base.length();
        if (dist < 1e-4) return { joint: origin.clone(), a: new THREE.Vector3(0, -1, 0), b: new THREE.Vector3(0, -1, 0) };
        const dir = base.clone().normalize();

        // 限制最大舒适伸展长度：保证肘部至少保留 elbowFlex 的屈曲，
        // 超出部分由手指前伸弥补（手腕停在舒适可达处、不再机械拉直）。
        const maxReach = Math.sqrt(lenA * lenA + lenB * lenB + 2 * lenA * lenB * Math.cos(elbowFlex));
        const reach = Math.min(dist, maxReach);
        const effTarget = dist > maxReach ? origin.clone().addScaledVector(dir, maxReach) : target;

        const axis = bendAxis.clone().normalize();
        let cosA = (lenA * lenA + reach * reach - lenB * lenB) / (2 * lenA * reach);
        if (!isFinite(cosA)) cosA = 1;
        cosA = THREE.MathUtils.clamp(cosA, -1, 1);
        const angleA = Math.acos(cosA);
        const a = dir.clone().applyAxisAngle(axis, angleA);
        const joint = origin.clone().addScaledVector(a, lenA);
        const b = effTarget.clone().sub(joint).normalize();
        return { joint, a, b };
    }

    // 让「bone」的生长方向指向父层局部空间中的目标点 target
    function aimBone(bone, target) {
        const grow = bindDirs[boneKey(bone.name)];
        if (!grow) return;
        const dir = target.clone().sub(bone.position).normalize();
        bone.quaternion.setFromUnitVectors(grow, dir);
    }

    // 摆放手臂 + 手：把指定手的手腕送到 world 目标，并弯曲手指（带平滑过渡）
    // elbowFlex：肘部最小屈曲（弧度），站立/行走时可传 HANG_ELBOW_FLEX 让手臂自然下垂；
    // bendVector：可选弯曲轴覆盖（空则用演奏用的沉肘+外展轴）。
    function placeArmAndHand(side, wristWorld, pressedMidis, dt, elbowFlex = ELBOW_MIN_FLEX, bendVector = null) {
        const a = armBones(side);
        const shoulderWorld = a.arm.getWorldPosition(new THREE.Vector3());
        // IK 弯曲轴：让肘部「向下微沉、向两侧外张」，而不是上顶。
        // 演奏者坐态面向 -Z（朝琴键）：弯曲轴取 -X 为主分量可使肘部下沉，
        // 再叠加每侧外展的 ±Y 分量让肘自然向外，形成放松下垂的钢琴手肘。
        const sideSign = side === 'L' ? 1 : -1;   // 左手外展=-X、右手外展=+X（坐态面向 -Z）
        const sway = Math.sin(swayT * 0.9 + (side === 'L' ? 0 : Math.PI)) * ELBOW_SWAY;
        const bendAxis = (bendVector ? bendVector.clone() : new THREE.Vector3(-ELBOW_DROP, sideSign * (ELBOW_ABDUCT + sway), 0)).normalize();
        const ik = ik2BoneWorld(shoulderWorld, wristWorld, armLen[side].upper, armLen[side].fore, bendAxis, elbowFlex);

        const armParent = a.arm.parent;
        const armParentInv = armParent.matrixWorld.clone().invert();
        const elbowParent = ik.joint.clone().applyMatrix4(armParentInv);
        aimBone(a.arm, elbowParent);

        // 关键：先把上肢世界矩阵刷新，再据此把腕部目标换算到前臂父层（= 上臂）局部空间。
        // 否则 fore.parent.matrixWorld 仍是「本次 aimBone 之前」的陈矩阵，腕部目标会偏离一帧，
        // 令指尖落点出现迟滞，反而放大 heightBias 闭环修正的负担（响应变慢、精度下降）。
        a.arm.updateMatrixWorld(true);

        const foreParent = a.fore.parent;
        const foreParentInv = foreParent.matrixWorld.clone().invert();
        const wristParent = wristWorld.clone().applyMatrix4(foreParentInv);
        aimBone(a.fore, wristParent);

        const hb = side === 'L' ? handL : handR;
        const curled = new Set(pressedMidis ? pressedMidis.map(m => fingerMap[side][m]) : []);

        // 手腕自然放松、避免锁死：手掌保持端正水平（掌心朝下、严禁倾斜），
        // 横滚仅随「按下手指的拇指↔小指重心」做极微小的协调倾斜（弹拇指侧略内旋、
        // 弹小指侧略外旋），而非与音无关的固定摆动；左右手经 mirror 镜像保持方向一致。
        const mirror = side === 'L' ? -1 : 1;
        const rollPhase = side === 'L' ? 0 : Math.PI;
        const fingerW = curled.size ? Array.from(curled).reduce((s, i) => s + i, 0) / curled.size : 2;
        const rawRoll = (fingerW - 2) * WRIST_ROLL_PER_FINGER * mirror
                   + Math.sin(swayT * 1.7 + rollPhase) * 0.01;   // 残余呼吸起伏，避免锁死
        // 尺/桡侧偏：让手腕按按下手指的拇指↔小指重心在水平面内偏摆，侧向“够键”不必每次整臂平移。
        // 与 roll 正交（yaw 绕垂直轴、roll 绕前后轴），二者叠加才还原真实手腕的三维协调。
        const rawYaw = (fingerW - 2) * WRIST_YAW_PER_FINGER * mirror;
        // 阶段4：腕姿生物力学中立范围软钳制（Savvidou 中立腕 -5°~+15° 尺/桡偏、±9° 旋前/旋后），
        // 消除残留的腕过度翻转/锁死，并记录实时腕姿供日志验证合规。
        const roll = THREE.MathUtils.clamp(rawRoll, -WRIST_ROLL_MAX, WRIST_ROLL_MAX);
        const yaw = THREE.MathUtils.clamp(rawYaw, WRIST_YAW_LO, WRIST_YAW_HI);
        wristPose[side].roll = roll;
        wristPose[side].yaw = yaw;
        // 关键：在手骨「绑定姿态」基础上叠加轻微 yaw/roll，而非用绝对欧拉角覆盖。
        // 用 rotation.set(...) 会把手的绑定旋转一并清空、翻转掌心/指尖朝向，
        // 导致演奏时指尖反而高于手腕（悬空、无法贴键，heightBias 被钳死在 -0.06 仍差 10cm）。
        const handRest = restQuat[boneKey(a.hand.name)];
        a.hand.quaternion.copy(handRest).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, roll)));
        a.fore.updateMatrixWorld(true);   // 刷新 hand 的最终世界矩阵（含 roll + 刚求解的前臂 IK），供每指 IK 使用

        // —— 每指 IK：指尖精确落键（Tipiano「指尖先验」级联 + APR 先验正则）——
        // 按下时把指尖世界目标设为该指键位 + 「抬指→下压」弧线（幅度随力度），用 CCD 对
        // MCP/PIP/DIP 三段做「独立」屈曲求解使指尖贴键；未按下的手指回落到自然静息先验。
        // 三段角度各自阻尼平滑过渡，消除瞬变。
        const handM = a.hand.matrixWorld;
        const chains = handChains[side] || [];
        // 静息先验按手选择：左手用放大后的 FINGER_POSE_L（更高指弓/隆起，低音区对掌连奏），右手用标准 FINGER_POSE。
        const pose = side === 'L' ? FINGER_POSE_L : FINGER_POSE;
        const solved = [0, 0, 0, 0];   // [MCP屈曲 PIP屈曲 DIP屈曲 MCP外展]
        const k = 1 - Math.exp(-CURL_SMOOTH * Math.max(dt, 0.0001));
        for (let i = 0; i < 5; i++) {
            const f = hb.fingers[i];
            const isPressed = curled.has(i);
            let targetSeg;
            if (isPressed) {
                if (!fingerPrev[side][i]) {
                    fingerClock[side][i] = 0;   // 新按下：触发抬指蓄势
                    const midi = active[side].find(m => fingerMap[side][m] === i);
                    fingerVel[side][i] = midi !== undefined ? (noteVel[side][midi] || 0.5) : 0.5;
                }
                fingerClock[side][i] += dt;
                fingerPrev[side][i] = true;
                const midi = active[side].find(m => fingerMap[side][m] === i);
                const kp = midi !== undefined ? keyWorldPos(midi) : null;
                const chain = chains[i];
                if (kp && chain) {
                    const t = fingerClock[side][i];
                    const vel = fingerVel[side][i];
                    const liftAmt = 0.006 + 0.008 * vel;   // 抬指高度随力度 6~14mm
                    // —— 键面碰撞钳制：实时计算琴键「当前顶面」世界 Y（休息键面 + 局部下沉差×世界缩放，
                    //    下沉差 = 当前局部Y - 休息局部Y（Steinway 真实键 restY=键中心，程序化键 restY=0），
                    //    下沉为负 → 键面随按键动画降低）。指尖贴住动态键面而非固定休息键面，
                    //    琴键被压下时手指同步跟随下沉，从几何根源上杜绝手指穿透琴键。
                    const keyObj = kp.key;
                    const surfaceY = (keyObj && keyObj.mesh)
                        ? kp.y + (keyObj.mesh.position.y - (keyObj.restY || 0)) * (keyObj.depthScale || 0)
                        : kp.y;
                    // 触键深度 = 基础贴合量 + 力度微调（0.8~2mm），弱音轻贴、强音略深，但均不穿入键体。
                    const depth = KEY_CONTACT_DEPTH + 0.0012 * vel;
                    let ty = surfaceY - depth;
                    if (t < LIFT_DUR) ty = surfaceY + liftAmt * ease(t / LIFT_DUR);
                    else if (t < LIFT_DUR + STRIKE_DUR) ty = surfaceY - depth + liftAmt * (1 - ease((t - LIFT_DUR) / STRIKE_DUR));
                    _target.set(kp.x, ty, kp.z);
                    solveFingerIK(chain, _target, handM, pose[i], ABD_MAX[i], solved);
                    targetSeg = solved;
                } else {
                    targetSeg = [pose[i][0], pose[i][1], pose[i][2], 0];
                }
            } else {
                fingerPrev[side][i] = false;
                targetSeg = [pose[i][0], pose[i][1], pose[i][2], 0];
            }
            // 三段独立阻尼平滑 + 应用：MCP 拥有「屈曲(X) + 外展(fanLocal)」两自由度，PIP/DIP 仅屈曲。
            // 该 RPM 模型手指沿本地 X 轴卷曲（绕 Z 反而抬指），外展沿实测 fanLocal 轴施加。
            const c = curFlex[side][i];
            for (let seg = 0; seg < 3; seg++) c[seg] += (targetSeg[seg] - c[seg]) * k;
            // 外展独立平滑 + 力度速度增益：强音手指张开更干脆（速率↑）、弱音更轻柔（速率↓），
            // 未按手指以恒定中速回落并拢，消除统一匀速张合带来的机械感。
            const velGain = 0.75 + 0.5 * (isPressed ? fingerVel[side][i] : 0.5);
            const kAbd = 1 - Math.exp(-ABD_SMOOTH * velGain * Math.max(dt, 0.0001));
            curAbd[side][i] += (targetSeg[3] - curAbd[side][i]) * kAbd;

            const bone0 = f[0];
            if (bone0) {
                const chain = chains[i];
                if (chain && chain.fanLocal) {
                    // 二自由度 MCP：绑定姿态 × 外展(fanLocal) × 屈曲(本地X)
                    bone0.quaternion.copy(restQuat[boneKey(bone0.name)])
                        .multiply(new THREE.Quaternion().setFromAxisAngle(chain.fanLocal, curAbd[side][i]))
                        .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(
                            THREE.MathUtils.clamp(c[0], -0.20, CURL_SEG_MAX[0]), 0, 0)));
                } else {
                    bone0.rotation.x = THREE.MathUtils.clamp(c[0], -0.20, CURL_SEG_MAX[0]);
                }
            }
            for (let seg = 1; seg < 3; seg++) {
                const bone = f[seg];
                if (!bone) continue;
                bone.rotation.x = THREE.MathUtils.clamp(c[seg], -0.20, CURL_SEG_MAX[seg]);
            }
        }
    }

    // 平滑追踪手腕到目标点（帧率无关）；首次直接到位
    function moveWrist(side, target, dt) {
        if (!curWrist[side]) curWrist[side] = target.clone();
        else curWrist[side].lerp(target, 1 - Math.exp(-WRIST_SMOOTH * Math.max(dt, 0.0001)));
    }

    // 手指独立分配：基于每根手指的"键盘本位"就近分配，并保持"手不动则指不动"的稳定性。
    // - 本位寄存器 handReg 仅在按键质心明显越界时才平移（离散移手），使手指在本位内独立按键；
    // - 仍按住音符保留原手指（不随和弦增删而跳指），新增音符贪心就近占用空闲手指。
    function assignFingers(side) {
        const notes = active[side];
        if (!notes.length) { fingerMap[side] = {}; return null; }
        const sorted = notes.slice().sort((n1, n2) => n1 - n2);
        const mirror = side === 'L' ? -1 : 1;   // 左手镜像：拇指在高音侧、小指在低音侧
        const centroid = sorted.reduce((s, n) => s + n, 0) / sorted.length;
        // 不移手时寄存器保持原地（“手不动则指不动”），越界时一次性平移到质心。
        // 不再 Math.round 取整：整数化会带来半音级跳变，令手部视觉上“咯噔”一下；保留浮点连续值。
        if (handReg[side] === null || Math.abs(centroid - handReg[side]) > REG_SNAP) {
            handReg[side] = centroid;
        }
        const home = FINGER_HOME.map(d => handReg[side] + d * mirror);

        // 1) 仍按住的音符保留原手指（稳定性，避免"跳指"）
        const prev = fingerMap[side] || {};
        const used = new Set(), next = {};
        for (const m of sorted) {
            if (prev[m] !== undefined && prev[m] !== null && !used.has(prev[m])) {
                next[m] = prev[m]; used.add(prev[m]);
            }
        }
        // 2) 新增音符：匈牙利算法全局最优匹配（RoboPianist 的 OT 指法 / linear_sum_assignment）。
        //    贪心按局部最近逐一占用，易出现"前一个音符抢走本更适合后一个音符的手指"的交叉指；
        //    全局最优令整个手指集相对本位键的总位移最小，和弦/琶音更自然、减少无谓移手。
        const free = [];
        for (let i = 0; i < 5; i++) if (!used.has(i)) free.push(i);
        const pending = sorted.filter(m => next[m] === undefined);
        if (pending.length <= free.length) {
            // 代价 = 每个待分配音符到每根空闲手指本位键的半音距离
            const cost = pending.map((m) => free.map((f) => Math.abs(m - home[f])));
            const assign = hungarianAssign(cost);
            if (assign) {
                pending.forEach((m, i) => { next[m] = free[assign[i]]; });
            } else {
                fallbackGreedyAssign(pending, free, home, next);
            }
        } else {
            // 极端情况（同手音符数 > 空闲手指，极少见）：保留原"就近复用"贪心兜底
            fallbackGreedyAssign(pending, free, home, next);
        }
        fingerMap[side] = next;

        // 返回按键质心（世界坐标），供腕定位（保留原有行为）
        const avg = new THREE.Vector3(0, 0, 0);
        for (const midi of sorted) {
            const kp = keyWorldPos(midi);
            avg.x += kp.x; avg.y += kp.y; avg.z += kp.z;
        }
        avg.divideScalar(sorted.length);
        return avg;
    }

    // —— 前瞻质心（FürElise 预期性动作）：统计未来 [now, now+horizon] 内即将按下的音符，
    //    取其在键盘上的世界质心，供手腕「前馈」。使手/腕在音符到来前就预先靠拢目标音区，
    //    而非纯反应式跟手（这是消除“每个音才临时移手”的生硬感、逼近专家演奏的关键）。
    function futureCentroid(side, elapsed) {
        const c = new THREE.Vector3();
        let n = 0;
        for (let i = evIdx; i < events.length; i++) {
            const ev = events[i];
            if (ev.t <= elapsed) continue;
            if (ev.t > elapsed + ANTICIPATE_HORIZON) break;
            if (ev.type !== 'on' || handForMidi(ev.midi) !== side) continue;
            const kp = keyWorldPos(ev.midi);
            c.x += kp.x; c.y += kp.y; c.z += kp.z; n++;
        }
        return n ? c.divideScalar(n) : null;
    }

    function updateHands(dt) {
        const kf = 1 - Math.exp(-BIAS_DAMP * Math.max(dt, 0.0001));
        const elapsed = audio.now() - playStart;
        for (const side of ['L', 'R']) {
            const centroid = assignFingers(side);
            let center = centroid;
            let target;
            if (centroid) {
                // 预期性前馈（FürElise）：把当前按住音质心与「即将按下」音质心按 WRIST_LEAD 混合，
                // 使手腕在音符到来前就预先靠拢目标音区；未来音尚未进入窗口时 fut 为空，自动回退纯反应。
                // 「前瞻质心」仅影响 xy 平移，不改变 y（各键顶高一致），故不干扰腕高/贴键闭环。
                const fut = futureCentroid(side, elapsed);
                if (fut) {
                    // 阶段3：距离缩放前瞻（FürElise 预期性动作）——键面横向跳转越大，前瞻越早越强，
                    // 使肩/臂/腕在大跳（八度/大跨琶音）到来前就更早、更充分地预先横移就位，而非反应式甩臂。
                    const leap = Math.abs(fut.x - centroid.x);
                    const lead = THREE.MathUtils.clamp(WRIST_LEAD + leap * LEAP_LEAD_PER_M, 0, LEAD_MAX);
                    center = centroid.clone().lerp(fut, lead);
                }
                // 阶段2：腕轨迹键位偏移先验（Tipiano 第3阶段）——演奏宽和弦/大跨时，真实钢琴家
                // 手腕大致对齐手掌中心（手本位寄存器 handReg），而非被最外侧手指拉偏到音符质心。
                // 手跨（最外侧按键世界 Z 跨度）越大、腕越向手本位回靠；窄音程则贴近手指落点（质心）。
                if (handReg[side] !== null) {
                    let xMin = Infinity, xMax = -Infinity;
                    const notes0 = active[side];
                    for (const m of notes0) {
                        const x = keyWorldPos(m).x;
                        if (x < xMin) xMin = x;
                        if (x > xMax) xMax = x;
                    }
                    const spanX = notes0.length > 1 ? (xMax - xMin) : 0;
                    const pull = Math.min(spanX / WRIST_REG_SPAN, 1) * WRIST_REG_PULL;
                    if (pull > 0) {
                        const regX = keyXAt(handReg[side]);
                        center.x += (regX - center.x) * pull;
                    }
                }
                // 手腕相对键位向身体方向内收一点，让手指向前伸出触键，
                // 使肘部在演奏中保持自然弯曲而非拉直到键面。
                // 演奏者面向 -Z：键盘沿 X 横向、前缘朝 +Z，故「向身体内收」沿 +Z；横向用 X，不再用 Z。
                center.z += WRIST_BACK;

                // 腕高前馈用实测「腕→卷曲指尖」落差 wristDrop（替代经验值 reach*0.5），
                // 叠加实测指尖与目标键面的闭环残差 heightBias（跨音符持续、不在抬指时回弹，
                // 消除“先高后低”的迟滞），使指尖精确落到键面并与黑/白键真实顶面一致。
                if (tipHasMeas[side]) {
                    const err = (center.y + KEY_CLEAR) - tipMeasY[side];
                    heightBias[side] += err * kf;
                }
                heightBias[side] = THREE.MathUtils.clamp(heightBias[side], -0.06, 0.06);
                // 腕高纵向协调：强奏稍沉腕（借用自重）、弱奏稍抬腕，叠加轻微呼吸起伏，
                // 让手腕随力度"活"起来而非锁死在固定高度（幅度小，不破坏指尖贴键）。
                const dynFloat = (0.5 - dynamics) * WRIST_DYN_AMP + Math.sin(swayT * 2.0) * WRIST_BREATH;
                target = new THREE.Vector3(center.x, center.y + KEY_CLEAR + wristDrop[side] + heightBias[side] + dynFloat, center.z);
            } else {
                // 无按住音符：不刻意回归「完全中立初始位置」。真实演奏者弹完一个非主要音区的音符后，
                // 会把手停在该音区保持稳定（停在本位寄存器 handReg），而非先回正再临时甩臂
                // （多走一段路够不着后续音 + 肌肉紧张不自主抽搐）。无手本位时才落到中立休止位。
                // 高度仍保持轻搁键面、不回弹。
                const restMidi = side === 'L' ? 48 : 72;
                const kp = keyWorldPos(restMidi);
                const lingerX = (handReg[side] !== null) ? keyXAt(handReg[side]) : kp.x;
                target = new THREE.Vector3(lingerX, kp.y + KEY_CLEAR + heightBias[side], kp.z);
            }
            moveWrist(side, target, dt);
            placeArmAndHand(side, curWrist[side], active[side], dt, side === 'L' ? ELBOW_MIN_FLEX : ELBOW_FLEX_R);

            // 阶段5：腕 Z 平滑度采样（|加速度|的 EMA，jerk 代理）——越小越平滑，供量化日志评估
            if (PERF_METRICS) {
                const wz = curWrist[side].z;
                if (prevWristZ[side] !== null) {
                    const dtClamp = Math.max(dt, 0.0001);
                    const vel = (wz - prevWristZ[side]) / dtClamp;
                    const acc = (vel - prevWristVel[side]) / dtClamp;
                    wristJerk[side] += (Math.abs(acc) - wristJerk[side]) * (1 - Math.exp(-BIAS_DAMP * dtClamp));
                    prevWristVel[side] = vel;
                }
                prevWristZ[side] = wz;
            }
        }
        // 双手摆放完毕，统一刷新一次世界矩阵后实测指尖高度，供下一帧闭环修正；
        // 相比原先每只手各自多次 updateMatrixWorld 更省（见 measureTipContacts）。
        root.updateMatrixWorld(true);
        measureTipContacts();
        publishFingertips();

        // 触键诊断：每秒打印一次左右手「指尖−键面」间隙与闭环偏置，用于验证贴合度与闭环是否钳死。
        // 额外输出实际腕高/目标腕高/肩高，用于区分“IK 够不到腕目标”与“手指指向异常”两类根因。
        tipLogAcc += dt;
        if (phase === 'playing' && tipLogAcc >= 1.0) {
            tipLogAcc = 0;
            const gapL = tipHasMeas.L ? (tipMeasY.L - keyTopY).toFixed(3) : '—';
            const gapR = tipHasMeas.R ? (tipMeasY.R - keyTopY).toFixed(3) : '—';
            const aL = armBones('L'), aR = armBones('R');
            const wp = (hb) => hb && hb.getWorldPosition(new THREE.Vector3());
            const wL = wp(aL.hand), wR = wp(aR.hand);
            const sL = wp(aL.arm), sR = wp(aR.arm);
            const fmt = (v) => v ? v.y.toFixed(3) : '—';
            console.log(`[perf] 触键间隙 L=${gapL}m R=${gapR}m | bias L=${heightBias.L.toFixed(3)} R=${heightBias.R.toFixed(3)}`);
            console.log(`[perf] 腕高 L实际=${fmt(wL)} 目标=${(curWrist.L && curWrist.L.y.toFixed(3))} 肩=${fmt(sL)} | R实际=${fmt(wR)} 目标=${(curWrist.R && curWrist.R.y.toFixed(3))} 肩=${fmt(sR)} | 键面=${keyTopY.toFixed(3)}`);
            const d2r = 180 / Math.PI;
            console.log(`[perf] 肘屈 L=${(elbowFlexAngle('L') * d2r).toFixed(1)}° R=${(elbowFlexAngle('R') * d2r).toFixed(1)}°`);

            // 拟人度/平滑度量化指标（阶段5）：触键精度、指弓、腕姿、腕平滑度四项客观指标，
            // 用于评估「是否仍僵硬/僵尸手」而非主观感受。
            if (PERF_METRICS) {
                let touched = 0, total = 0, archSum = 0, archN = 0;
                for (const s of ['L', 'R']) {
                    const hb = s === 'L' ? handL : handR;
                    for (const m of active[s]) {
                        total++;
                        const fi = fingerMap[s][m];
                        const tip = hb.fingers[fi] && hb.fingers[fi][3];
                        if (tip) {
                            tip.getWorldPosition(V);
                            // 触键精度：指尖落在键面 ±20mm 内计为命中（F1 精度代理）
                            if (Math.abs(V.y - keyWorldPos(m).y) < 0.02) touched++;
                            // 指弓：PIP+DIP 屈曲角绝对值之和（越大指弓越明显，评估僵硬手）
                            archSum += Math.abs(curFlex[s][fi][1]) + Math.abs(curFlex[s][fi][2]);
                            archN++;
                        }
                    }
                }
                const archDeg = archN ? (archSum / archN) * d2r : 0;
                console.log(`[perf·量化] 触键精度=${total ? (touched + '/' + total) : '—'} | 指弓均值=${archDeg.toFixed(1)}° ` +
                    `| 腕roll L=${(wristPose.L.roll * d2r).toFixed(1)}° R=${(wristPose.R.roll * d2r).toFixed(1)}° ` +
                    `| 腕yaw L=${(wristPose.L.yaw * d2r).toFixed(1)}° R=${(wristPose.R.yaw * d2r).toFixed(1)}° ` +
                    `| 平滑度 L=${wristJerk.L.toFixed(2)} R=${wristJerk.R.toFixed(2)} m/s²`);
            }
        }
    }

    // 双手摆放完成后统一实测「按弦指尖的世界 Y（取最低点）」，避免重复矩阵刷新。
    function measureTipContacts() {
        for (const side of ['L', 'R']) {
            tipMeasY[side] = Infinity;
            tipHasMeas[side] = false;
            const notes = active[side];
            if (!notes || !notes.length) continue;
            const hb = side === 'L' ? handL : handR;
            for (const m of notes) {
                const fi = fingerMap[side][m];
                const tip = hb.fingers[fi] && hb.fingers[fi][3];
                if (tip) {
                    tip.getWorldPosition(V);
                    if (V.y < tipMeasY[side]) tipMeasY[side] = V.y;
                }
            }
            tipHasMeas[side] = isFinite(tipMeasY[side]) && tipMeasY[side] < 1e6;
        }
    }

    // 将 10 根手指的指尖世界坐标写入 app.fingertipsWorld，供物理引擎指尖传感器同步（接触检测/碰撞反馈）。
    // 顺序约定：[左手拇..小 5 指, 右手拇..小 5 指]，与物理侧 physFingers 的下标一一对应。
    function publishFingertips() {
        const fw = app.fingertipsWorld || (app.fingertipsWorld = []);
        let idx = 0;
        for (const side of ['L', 'R']) {
            const hb = side === 'L' ? handL : handR;
            for (let i = 0; i < 5; i++) {
                const tip = hb.fingers[i] && hb.fingers[i][3];
                if (tip) {
                    tip.getWorldPosition(V);
                    const p = fw[idx] || (fw[idx] = { x: 0, y: 0, z: 0 });
                    p.x = V.x; p.y = V.y; p.z = V.z;
                }
                idx++;
            }
        }
    }

    // ============================================================
    // 姿态：站立 / 行走 / 落座 / 手臂默认
    // ============================================================
    function applyLocalRot(name, x, y, z) {
        const b = B[name];
        if (!b || !restQuat[name]) return;
        const dq = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
        b.quaternion.copy(restQuat[name]).multiply(dq);
    }

    // 记录某块骨骼的目标旋转增量（帧率无关，稍后由 smoothPose 阻尼逼近）
    function setPoseTarget(name, x, y, z) {
        const t = poseTarget[name] || (poseTarget[name] = { x: 0, y: 0, z: 0 });
        t.x = x; t.y = y; t.z = z;
    }

    // 每帧把当前姿态阻尼逼近目标，再写入骨骼（消除相位切换时的突变）
    function smoothPose(dt) {
        const k = 1 - Math.exp(-POSE_SMOOTH * Math.max(dt, 0.0001));
        for (const name in poseTarget) {
            const t = poseTarget[name];
            let c = poseCur[name];
            if (!c) c = poseCur[name] = { x: 0, y: 0, z: 0 };
            c.x += (t.x - c.x) * k;
            c.y += (t.y - c.y) * k;
            c.z += (t.z - c.z) * k;
            applyLocalRot(name, c.x, c.y, c.z);
        }
    }

    // 姿态目标清空 + 当前值归零（每次演奏开始前重置，避免残留上一场的肢体角度）
    function resetPoseState() {
        for (const k in poseTarget) delete poseTarget[k];
        for (const k in poseCur) delete poseCur[k];
    }

    function resetPose() {
        for (const name in B) if (B[name].isBone) B[name].quaternion.copy(restQuat[name]);
    }

    // 手臂自然下垂到目标（带平滑追踪）：肘部接近伸直、微屈，避免僵硬支臂
    // 面向 -Z 时「后」= +Z，肘部略向后，弯曲轴取 +Z。
    function armHang(side, dt) {
        const a = armBones(side);
        const s = side === 'L' ? 1 : -1;
        const shoulder = a.arm.getWorldPosition(new THREE.Vector3());
        const dir = new THREE.Vector3(s * 0.05, -0.97, 0.10).normalize();
        const dst = shoulder.clone().add(dir.clone().multiplyScalar(armLen[side].upper + armLen[side].fore));
        moveWrist(side, dst, dt);
        placeArmAndHand(side, curWrist[side], [], dt, HANG_ELBOW_FLEX, new THREE.Vector3(0, 0, 1));
    }

    // 行走时手臂自然下垂摆臂：与同侧腿反向，肘部微屈、随摆动自然折叠（t = 完整步态周期数）
    function armSwing(side, t, dt) {
        const a = armBones(side);
        const s = side === 'L' ? 1 : -1;
        const w = t * Math.PI * 2;
        const sw = Math.sin(w);
        const swing = (side === 'L' ? -sw : sw) * 0.44;   // 与同侧腿反向，摆幅更自然
        const shoulder = a.arm.getWorldPosition(new THREE.Vector3());
        // 手臂基本贴体下垂，前后摆臂；肘部随摆动轻微加大屈曲（前摆屈膝时手臂更放松）
        const dir = new THREE.Vector3(s * 0.05, -0.95, 0.12 + swing).normalize();
        const dst = shoulder.clone().add(dir.clone().multiplyScalar(armLen[side].upper + armLen[side].fore));
        moveWrist(side, dst, dt);
        const flex = HANG_ELBOW_FLEX + Math.max(0, swing) * 0.15;   // 前摆时肘部更放松弯曲
        placeArmAndHand(side, curWrist[side], [], dt, flex, new THREE.Vector3(0, 0, 1));
    }

    function setStandPose() {
        setPoseTarget(BIND.lUpLeg, 0, 0, 0);
        setPoseTarget(BIND.rUpLeg, 0, 0, 0);
        setPoseTarget(BIND.lLeg, 0, 0, 0);
        setPoseTarget(BIND.rLeg, 0, 0, 0);
        setLean(0);
    }

    // 演奏前倾姿态（0=直立 1=完全前倾）：逐节弯腰并压低头部，让肩膀贴近琴键
    function setLean(amount) {
        setPoseTarget(BIND.spine, LEAN_SPINE * amount, 0, 0);
        setPoseTarget(BIND.spine2, LEAN_SPINE2 * amount, 0, 0);
        setPoseTarget(BIND.neck, LEAN_NECK * amount, 0, 0);
        setPoseTarget(BIND.head, LEAN_HEAD * amount, 0, 0);
        // 肩关节前旋（前伸）：经实测该模型肩胛骨沿局部 Z 轴旋转才能把肩向正前方（+Z）送出、
        //     而非沿 X 轴（那是抬/降臂的外展方向）。前伸拉近肩→键距离，配合沉肘形成自然前伸。
        setPoseTarget(BIND.lShoulder, 0, 0, LEAN_SHOULDER * amount);
        setPoseTarget(BIND.rShoulder, 0, 0, LEAN_SHOULDER * amount);
    }

    // 落座姿态：随 amount（0→1）边下降边屈腿，避免瞬间折腿
    function setSitPose(amount) {
        setPoseTarget(BIND.lUpLeg, SIT_THIGH * amount, 0, 0);
        setPoseTarget(BIND.rUpLeg, SIT_THIGH * amount, 0, 0);
        setPoseTarget(BIND.lLeg, SIT_CALF * amount, 0, 0);
        setPoseTarget(BIND.rLeg, SIT_CALF * amount, 0, 0);
    }

    // 自然步态：t 为「完整步态周期数」。髋交替前后摆、摆动相屈膝、踝协调、躯干微对侧扭转，
    // 各关节同步联动，幅度贴合人体自然行走，杜绝机械匀速摆腿。
    function walkGait(t) {
        const w = t * Math.PI * 2;
        const s = Math.sin(w), c = Math.cos(w);
        setPoseTarget(BIND.lUpLeg, s * 0.46, 0, 0);
        setPoseTarget(BIND.rUpLeg, -s * 0.46, 0, 0);
        // 屈膝（小腿向后=负）仅在摆动相，支撑相接近伸直
        setPoseTarget(BIND.lLeg, -Math.max(0, c) * 0.50, 0, 0);
        setPoseTarget(BIND.rLeg, -Math.max(0, -c) * 0.50, 0, 0);
        // 踝：足跟着地背屈 / 蹬离跖屈，幅度小、与步态同步
        setPoseTarget(BIND.lFoot, Math.max(0, -s) * 0.16, 0, 0);
        setPoseTarget(BIND.rFoot, Math.max(0, s) * 0.16, 0, 0);
        // 躯干沿竖直轴轻微对侧扭转 + 头部稳定，增强整体协调感
        setPoseTarget(BIND.spine, 0, Math.sin(w) * 0.04, 0);
        setPoseTarget(BIND.head, Math.sin(w + Math.PI) * 0.02, 0, 0);
    }

    // ============================================================
    // 谱面事件调度
    // ============================================================
    function buildEvents() {
        events = [];
        for (const n of norm.notes) {
            events.push({ t: n.t0, type: 'on', midi: n.midi, vel: n.vel, dur: n.dur, inst: n.inst || 'piano' });
            events.push({ t: n.t0 + n.dur, type: 'off', midi: n.midi, inst: n.inst || 'piano' });
        }
        // 延音踏板（CC64）踩/抬事件，与音符事件合并排序
        for (const s of (norm.sustains || [])) {
            events.push({ t: s.t0, type: s.down ? 'sustainOn' : 'sustainOff' });
        }
        events.sort((a, b) => a.t - b.t);
        evIdx = 0;

        // 阶段1：动态左右手分界线（替代固定 60=C4）——按乐曲音符分布自动确定最佳分界，
        // 解决跨手/八度/交叉弹奏时的手部分配错误（如左手弹高音、右手弹低音的情况）。
        // 取去重后音高的中位数作为分界：音域均衡时分界落在中央，左手低音/右手高音；
        // 音域整体偏高/偏低时分界随之偏移，避免某一整只手空闲或频繁跨手。
        // 注意：仅按「钢琴轨道」的音符分布确定，排除小提琴等其他乐器对钢琴手区划分的干扰。
        const pianoMidis = norm.notes.filter(n => (n.inst || 'piano') === 'piano').map(n => n.midi);
        if (pianoMidis.length) {
            const uniq = [...new Set(pianoMidis)].sort((a, b) => a - b);
            handSplit = uniq[Math.floor(uniq.length / 2)];
        }
    }

    function processEvent(ev) {
        // 延音踏板（CC64）：驱动右脚踏板姿态与踏板下沉动画
        if (ev.type === 'sustainOn' || ev.type === 'sustainOff') {
            pedalDown = (ev.type === 'sustainOn');
            if (world.pressSustainPedal) world.pressSustainPedal(pedalDown);
            setPoseTarget(BIND.rFoot, pedalDown ? PEDAL_FOOT_ROT : 0, 0, 0);
            return;
        }
        // 乐器路由：
        //  - 'piano'：正常钢琴演奏（驱动琴键 + 手指动画）
        //  - 'violin'：驱动舞台上小提琴模型的弦振/发光/按弦指示 + 高品质小提琴真实采样
        //  - 'percussion' / 'other'：忽略（打击乐/其他伴奏，暂不参与演奏，后续可单独接入）
        if (ev.inst && ev.inst !== 'piano') {
            if (ev.inst === 'violin') {
                try {
                    // ev.vel 已由 normalizeScore / midiParser 归一化为 0~1，直接使用（勿再 /127）
                    const v = THREE.MathUtils.clamp(ev.vel || 0.8, 0, 1);
                    if (ev.type === 'on') {
                        // 演奏模型：把位 + 弓法 + 技法（揉弦/滑音/跳弓/颤音）推断
                        // 产出 performance 描述符，供音频引擎与 3D 可视化共同消费
                        const perf = vperf.nextNote({ midi: ev.midi, vel: v, dur: ev.dur, t: ev.t });
                        if (app.violin) app.violin.noteOn(ev.midi, v, perf);   // 弦身振动 + 发光 + 左手指位/揉弦指示
                        if (app.violinBow) app.violinBow.stroke(v, perf);      // 弓拉弓往复（触点/压力/跳弓/颤音）
                        audio.violinNoteOn(ev.midi, v, perf);                   // 高品质小提琴音色（含技法调制）
                    } else {
                        if (app.violin) app.violin.noteOff(ev.midi);
                        audio.violinNoteOff(ev.midi);
                    }
                } catch (err) {
                    console.error('[perf] violin event error:', err && err.message ? err.message : err);
                }
            }
            return;
        }
        const hand = handForMidi(ev.midi);
        if (ev.type === 'on') {
            // 同手最多 5 指：新音符导致该手按住数超过手指上限时，释放「最早按下」的音符让位。
            // 仅释放视觉按键、不提前 noteOff——该音随后由自身 off 事件在正确时刻结音，消除吞音。
            const held = active[hand];
            while (held.length >= 5) {
                let oldest = held[0];
                for (const m of held) if (noteOnT[hand][m] < noteOnT[hand][oldest]) oldest = m;
                world.pressPianoKey(oldest, false);
                held.splice(held.indexOf(oldest), 1);
                delete fingerMap[hand][oldest];
                delete noteVel[hand][oldest];
                delete noteOnT[hand][oldest];
            }
            audio.noteOn(ev.midi, ev.vel);
            world.pressPianoKey(ev.midi, true, (ev.vel || 80) / 127);
            if (!active[hand].includes(ev.midi)) active[hand].push(ev.midi);
            noteOnT[hand][ev.midi] = ev.t;
            // 由音符力度驱动动态强度（用于身体前倾幅度）
            const v = THREE.MathUtils.clamp((ev.vel || 80) / 127, 0, 1);
            dynTarget = Math.max(dynTarget, v);
            // 记录当前按住音符的力度，供每指 IK 按力度缩放抬指高度/触键深度
            noteVel[hand][ev.midi] = v;
        } else {
            audio.noteOff(ev.midi);
            world.pressPianoKey(ev.midi, false);
            const i = active[hand].indexOf(ev.midi);
            if (i >= 0) active[hand].splice(i, 1);
            delete fingerMap[hand][ev.midi];
            delete noteVel[hand][ev.midi];
            delete noteOnT[hand][ev.midi];
        }
    }

    function releaseAllVisual() {
        for (const k of app.pianoKeys || []) if (k.down) world.pressPianoKey(k.midi, false);
        active.L.length = 0; active.R.length = 0;
        fingerMap.L = {}; fingerMap.R = {};
        noteVel.L = {}; noteVel.R = {};
        noteOnT.L = {}; noteOnT.R = {};
        // 复位延音踏板与右脚踏板姿态
        pedalDown = false;
        if (world.pressSustainPedal) world.pressSustainPedal(false);
    }

    // ============================================================
    // 启动 / 停止
    // ============================================================
    function start(scoreArg) {
        if (!modelRoot || !skinnedMesh) { console.warn('[performer] 未加载到人物模型'); return; }
        console.log('[performer] start 诊断:', JSON.stringify({
            bones: Object.keys(B).length,
            lArm: !!B[BIND.lArm], lFore: !!B[BIND.lFore], lHand: !!B[BIND.lHand],
            rArm: !!B[BIND.rArm], rFore: !!B[BIND.rFore], rHand: !!B[BIND.rHand],
            keys: (app.pianoKeys || []).length,
            k0mesh: !!(app.pianoKeys && app.pianoKeys[0] && app.pianoKeys[0].mesh)
        }));
        releaseAllVisual();
        const score = (typeof scoreArg === 'string') ? getScoreById(scoreArg) : scoreArg;
        norm = normalizeScore(score);
        currentTitle = norm.title;
        buildEvents();
        // 轨道识别报告：统计各乐器音符数量，帮助确认钢琴 / 小提琴轨道是否正确分离
        const instCount = {};
        for (const n of norm.notes) { const k = n.inst || 'piano'; instCount[k] = (instCount[k] || 0) + 1; }
        console.log('[performer] 轨道识别:', currentTitle, JSON.stringify(instCount));
        // 将谱面调度暴露给幕布魔法屏：供「下落音符条」实时推算未来音符的键位与落地时刻；handSplit 用于左右手分色
        app.pianoSchedule = { playing: false, elapsed: 0, events, handSplit };
        ensureKeyMap();
        // 先复位骨骼到绑定姿态再测量臂长/指长：若沿用上一场残留的手指卷曲/落座姿态，
        // 手指骨链的直线距离会被低估，进而干扰手腕高度标定与指尖-琴键贴合精度。
        resetPose();
        measureArms();
        measureWristDrop();
        measureHandChains();
        console.log('[performer] 指腕落差校准', JSON.stringify({
            wristDropL: +wristDrop.L.toFixed(4),
            wristDropR: +wristDrop.R.toFixed(4),
            keyTopY: +keyTopY.toFixed(4)
        }));

        // 标定坐姿高度：髋部落在琴凳面。standingHipY 已在应用 PERFORMER_SCALE 之后
        // 于加载时实测（已含缩放），故直接用其世界高度；且与 root 当前位置无关，
        // 避免上一场演奏结束后 root 已位于琴凳处造成位置累积/漂移（偶次播放坠地 bug）。
        // 凳面高度与 concertHall.js 中坐垫顶保持一致（0.50m + 坐垫间隙），
        // 使髋部落点同步、双脚平稳踩地、大腿接近水平。
        const benchTopY = STAGE_Y + 0.50 + SIT_SEAT_CLEAR;
        sitRootY = benchTopY - standingHipY;

        root.position.copy(enterStart);
        root.rotation.set(0, walkYaw, 0);
        root.visible = true;
        resetPoseState();
        setStandPose();

        // 复位平滑状态，保证每场演奏从干净状态开始
        curWrist.L = null; curWrist.R = null;
        for (const s of ['L', 'R']) for (let i = 0; i < 5; i++) curFlex[s][i] = [0, 0, 0];
        for (const s of ['L', 'R']) for (let i = 0; i < 5; i++) curAbd[s][i] = 0;
        fingerClock.L = [0, 0, 0, 0, 0]; fingerClock.R = [0, 0, 0, 0, 0];
        fingerPrev.L = [false, false, false, false, false]; fingerPrev.R = [false, false, false, false, false];
        heightBias.L = 0; heightBias.R = 0;
        tipMeasY.L = Infinity; tipMeasY.R = Infinity;
        tipHasMeas.L = false; tipHasMeas.R = false;
        dynTarget = 0.45; dynamics = 0.45;

        armHang('L', 0.5); armHang('R', 0.5);

        phase = 'entering'; phaseT = 0; phaseDur = enterDist / WALK_SPEED;
    }

    function stop() {
        releaseAllVisual();
        phase = 'finished'; phaseT = 0; phaseDur = 1.0;
    }

    // ============================================================
    // 每帧更新
    // ============================================================
    function update(dt) {
        if (phase === 'hidden') return;
        // 实时刷新幕布魔法屏的谱面时钟：仅在演奏阶段标记 playing，并推进已播放时长
        const sch = app.pianoSchedule;
        if (sch) {
            if (phase === 'playing') { sch.playing = true; sch.elapsed = audio.now() - playStart; }
            else sch.playing = false;
        }
        phaseT += dt;
        const t = Math.min(1, phaseT / phaseDur);
        const e = ease(t);
        swayT += dt;

        root.updateMatrixWorld(true);

        if (phase === 'entering') {
            // 直线匀速前行：位置用 smoothstep 缓动（起止柔和加减速），方向恒定朝琴凳。
            const p = new THREE.Vector3().lerpVectors(enterStart, enterEnd, e);
            root.position.copy(p);
            root.rotation.y = walkYaw;
            // 步态相位由「已走距离」推导（步幅锁定），使脚步严格贴合地面位移，消除“脚底打滑/漂移”。
            const cycles = (enterDist * e) / STRIDE_LEN;   // 已完成的完整步态周期数
            walkGait(cycles);
            armSwing('L', cycles, dt);
            armSwing('R', cycles, dt);
            if (t >= 1) { phase = 'turning'; phaseT = 0; phaseDur = 1.0; }
        } else if (phase === 'turning') {
            root.rotation.y = walkYaw + (SIT_YAW - walkYaw) * e;
            setStandPose();
            armHang('L', dt);
            armHang('R', dt);
            if (t >= 1) { phase = 'sitting'; phaseT = 0; phaseDur = 1.2; }
        } else if (phase === 'sitting') {
            const from = new THREE.Vector3(enterEnd.x, STAGE_Y, enterEnd.z);
            const to = new THREE.Vector3(benchX, sitRootY, benchZ);
            root.position.lerpVectors(from, to, e);
            root.rotation.y = SIT_YAW;
            setSitPose(e);   // 边下降边屈腿
            setLean(e);   // 落座同时逐渐前倾弯腰、压低头部
            armHang('L', dt);
            armHang('R', dt);
            if (t >= 1) {
                phase = 'playing'; phaseT = 0;
                playStart = audio.now(); evIdx = 0;
                updateHands(dt);
            }
        } else if (phase === 'playing') {
            const cur = audio.now();
            const elapsed = cur - playStart;
            while (evIdx < events.length && events[evIdx].t <= elapsed) {
                processEvent(events[evIdx]); evIdx++;
            }
            setSitPose(1);
            // 力度追踪：强音加深前倾、弱音回落，约 0.3-0.5s 平滑过渡
            dynTarget += (0.45 - dynTarget) * (1 - Math.exp(-0.8 * Math.max(dt, 0.0001)));
            dynamics += (dynTarget - dynamics) * (1 - Math.exp(-DYNAMICS_SMOOTH * Math.max(dt, 0.0001)));
            const leanAmount = LEAN_PIANO_FRAC + (1 - LEAN_PIANO_FRAC) * dynamics;
            setLean(leanAmount);
            // 叠加轻微腰部律动；躯干不再扭转，避免左右肩前后错位导致双肘屈曲不一致
            setPoseTarget(BIND.spine,
                LEAN_SPINE * leanAmount + Math.sin(swayT * 2.2) * 0.02,
                0,
                0);
            // 肩关节额外自由度：左右完全镜像对称（去除不对称耸肩/前伸律动），
            // 使左右肩位一致、双肘屈曲角度统一；仅保留同步的微弱呼吸起伏避免僵直。
            setPoseTarget(BIND.lShoulder,
                Math.sin(swayT * 1.7) * 0.02,
                0,
                LEAN_SHOULDER * leanAmount);
            setPoseTarget(BIND.rShoulder,
                Math.sin(swayT * 1.7) * 0.02,
                0,
                LEAN_SHOULDER * leanAmount);
            updateHands(dt);
            if (evIdx >= events.length) { phase = 'finished'; phaseT = 0; phaseDur = 1.2; }
        } else if (phase === 'finished') {
            releaseAllVisual();
            setSitPose(1);
            armHang('L', dt);
            armHang('R', dt);
            if (t >= 1) { phase = 'idle'; }
        } else if (phase === 'idle') {
            setSitPose(1);
        }

        // 统一阻尼推进腿部/脊柱姿态，使相位切换与步态变化平滑过渡
        smoothPose(dt);
    }

    root.visible = false;

    return {
        root,
        start,
        stop,
        update,
        get phase() { return phase; },
        get playing() { return phase === 'playing'; },
        get title() { return currentTitle; }
    };
}