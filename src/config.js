// ============================================================
// 🎛 场景配置（配置驱动 · 可扩展）
// 新增展厅 / 展品 / 灯光 / 摆件 / 资源：只需在此文件追加条目。
// ============================================================

// 展品（音乐影像作品）——未来接入更多作品仅需在此追加
export const EXHIBITS = [
    { title: '音乐影像作品 #1',
      description: '这是我的第一部音乐影像作品，探索了声音与画面的韵律关系。实验性地将电子音乐与抽象视觉结合。',
      video: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4' },
    { title: '音乐影像作品 #2',
      description: '第二部作品，氛围向音乐可视化。使用粒子系统和流体模拟呈现音乐的动态质感。',
      video: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4' }
];

// 展厅空间尺寸
export const ROOM_H = 8;      // 层高
export const WALL_T = 0.2;    // 墙厚
export const DOOR_W = 4.0;    // 门宽
export const DOOR_H = 5.5;    // 门高

// 展厅布局（沿 Z 轴串联；doors 声明哪面墙开门）
export const ROOMS = [
    { id: 'entrance', name: '入口大厅', cx: 0, cz: 0,   w: 18, d: 16, doors: { north: true }, accent: 0x667eea },
    { id: 'hallA',    name: '音乐厅 A', cx: 0, cz: -17, w: 18, d: 18, doors: { south: true, north: true }, accent: 0x4a6a8a },
    { id: 'hallB',    name: '音乐厅 B', cx: 0, cz: -35, w: 18, d: 18, doors: { south: true }, accent: 0x5acba0 }
];

// 第一人称漫游（玩家）参数
export const PLAYER = {
    startPos: [0, 1.7, 5],
    eyeHeight: 1.7,
    radius: 0.35,
    moveSpeed: 5.0,
    runSpeed: 10.0,
    bobFreqWalk: 9.0, bobFreqRun: 13.0,
    bobAmpWalk: 0.06, bobAmpRun: 0.11,
    bobRollWalk: 0.012, bobRollRun: 0.022,
    // 平滑移动：加速度 / 阻尼（越大越灵敏）
    acceleration: 14.0,
    deceleration: 10.0,
    // 鼠标灵敏度（设置面板可调）
    lookSensitivity: 0.002,
    // 脚步距离阈值
    stepWalk: 1.8, stepRun: 2.6
};

// 相机
export const CAMERA = {
    fov: 60, near: 0.1, far: 300,
    position: [0, 4, 8]
};

// 渲染器
export const RENDERER = {
    antialias: true,
    powerPreference: 'high-performance',
    maxPixelRatio: 2,
    toneMappingExposure: 0.78
};

// 轨道控制器
export const ORBIT = {
    enableDamping: true, dampingFactor: 0.05,
    minDistance: 2, maxDistance: 60,
    minPolarAngle: 0.1, maxPolarAngle: Math.PI / 2.05,
    target: [0, 2.5, -15]
};

// 视觉基调（纯黑背景 + 指数雾）
export const VISUALS = {
    background: 0x000000,
    fogDensity: 0.015
};

// Bloom 辉光
export const BLOOM = {
    strength: 0.4, radius: 0.6, threshold: 0.8
};

// 布局与装饰摆件位置（可扩展的重点锚点）
export const LAYOUT = {
    stage:      { cx: 0, cz: -20, w: 7, d: 5 },
    piano:      { x: 0, z: -20, rotY: 0 },
    pianoBench: { x: 0, z: -18, rotY: 0 },
    pianist:    { x: 0, z: -18.5 },

    pianoSpot: {
        position: [0, ROOM_H - 0.5, -19],
        target:   [0, 0.65, -20],
        color: 0xf0e8d8, intensity: 2.4, distance: 25,
        angle: Math.PI / 12, penumbra: 0.9, decay: 1.5,
        shadowMapSize: 2048, shadowBias: -0.0005, shadowFocus: 1.0
    },
    lightBeam: { x: 0, y: ROOM_H - 0.5, z: -19, targetZ: -20, color: 0xfff0d8, radius: 1.5 },

    equalizer: { x: -9 + 0.15, y: 1.5, z: -35, rotY: Math.PI / 2 },

    // 与 EXHIBITS 按索引一一对应
    screens: [
        { position: [9 - 0.2, ROOM_H / 2, -17], rotationY: -Math.PI / 2 },
        { position: [9 - 0.2, ROOM_H / 2, -35], rotationY: -Math.PI / 2 }
    ],

    pillars: [[-8, 7], [8, 7], [-8, -24], [8, -24], [-8, -42], [8, -42]],
    benches: [[-6, -3], [6, -3], [-6, -15], [6, -15], [-6, -33], [6, -33]],
    plants:  [[-8, 4], [8, 4], [-8, -25], [8, -25], [-8, -43], [8, -43]],

    dustCenters: [[0, 0], [0, -17], [0, -35], [0, -20]],

    ceilingLights:      [[0, 0], [0, -17], [0, -35]],
    ceilingExtraLights: [[-6, -17], [6, -17], [-6, -35], [6, -35]],
    footLights: [
        [-2, -8, 0x667eea], [2, -8, 0x667eea],
        [-2, -26, 0x4a6a8a], [2, -26, 0x4a6a8a]
    ]
};

// ============================================================
// ⚙ 用户设置（画质 / 音量 / 灵敏度 / FPS）
// ============================================================
export const SETTINGS = {
    quality: 'high',        // low | medium | high
    volume: 0.8,            // 0 ~ 1
    sensitivity: 0.002,     // 鼠标灵敏度
    showFps: false
};

// 画质预设（直接影响渲染器/阴影/Bloom）
// shadowType 使用字符串标识，在 main.js 中映射为 THREE 常量
export const QUALITY_PRESETS = {
    low:    { label: '低', pixelRatio: 1.0, shadows: false, bloom: false, shadowType: 'basic' },
    medium: { label: '中', pixelRatio: 1.5, shadows: true,  bloom: true,  shadowType: 'pcf' },
    high:   { label: '高', pixelRatio: 2.0, shadows: true,  bloom: true,  shadowType: 'pcfsoft' }
};