import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { CinematicShader } from './shaders.js';
import { CAMERA, RENDERER, ORBIT, VISUALS, BLOOM, SETTINGS, QUALITY_PRESETS } from './config.js';
import { createResourceManager } from './resources.js';
import { createWorld } from './scene.js';
import { createPlayer } from './player.js';
import { createAudioManager } from './audio.js';
import { initUI } from './ui.js';

// ============================================================
// 🚀 入口：组装场景、资源、玩家、UI、渲染循环
// ============================================================
async function init() {
    // 场景
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(VISUALS.background);
    scene.fog = new THREE.FogExp2(VISUALS.background, VISUALS.fogDensity);

    // 相机
    const camera = new THREE.PerspectiveCamera(
        CAMERA.fov, window.innerWidth / window.innerHeight, CAMERA.near, CAMERA.far
    );
    camera.position.set(...CAMERA.position);

    // 渲染器
    const renderer = new THREE.WebGLRenderer({
        antialias: RENDERER.antialias,
        powerPreference: RENDERER.powerPreference
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDERER.maxPixelRatio));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = RENDERER.toneMappingExposure;
    document.body.appendChild(renderer.domElement);

    // 环境光照（IBL）—— PMREM 生成器稍后在资源加载完成后用于 HDRI
    const pmremGenerator = new THREE.PMREMGenerator(renderer);

    // 轨道控制器
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = ORBIT.enableDamping;
    controls.dampingFactor = ORBIT.dampingFactor;
    controls.minDistance = ORBIT.minDistance;
    controls.maxDistance = ORBIT.maxDistance;
    controls.minPolarAngle = ORBIT.minPolarAngle;
    controls.maxPolarAngle = ORBIT.maxPolarAngle;
    controls.target.set(...ORBIT.target);
    controls.update();

    // 后期处理
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        BLOOM.strength, BLOOM.radius, BLOOM.threshold
    );
    composer.addPass(bloomPass);
    const cinematicPass = new ShaderPass(CinematicShader);
    composer.addPass(cinematicPass);
    composer.addPass(new OutputPass());

    // 共享应用状态
    const app = {
        scene, camera, renderer, controls, composer, bloomPass, cinematicPass,
        clock: new THREE.Clock(),
        colliders: [], doors: [], videoScreens: [], equalizerBars: [], dustSystems: [],
        fp: null, keys: {},
        textures: null,
        playerLight: null,
        piano: null, pianistFigure: null, sculpture: null, halo: null
    };

    const ui = initUI();
    const audio = createAudioManager();
    audio.attach(camera);
    audio.setVolume(SETTINGS.volume);

    // 资源加载（程序化纹理 + 可扩展外部资源管线）
    const resources = createResourceManager({
        maxAnisotropy: renderer.capabilities.getMaxAnisotropy(),
        onProgress: (p) => {
            ui.loading.textContent = `🎵 正在加载展厅… ${Math.round(p * 100)}%`;
        }
    });
    resources.setManifest([
        { id: 'piano', type: 'model', url: 'assets/models/piano.glb' },
        { id: 'hdri', type: 'hdr', url: 'assets/env/mirrored_hall_2k.hdr' }
    ]);
    app.textures = await resources.load();
    app.assets = resources.assets;

    // 环境光照（IBL）：优先 HDRI，失败回退 RoomEnvironment
    const hdri = app.assets && app.assets.hdri;
    if (hdri && hdri.isTexture) {
        scene.environment = pmremGenerator.fromEquirectangular(hdri).texture;
    } else {
        scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    }
    pmremGenerator.dispose();

    // 构建世界 + 玩家
    const world = createWorld(app);
    world.buildWorld();
    const player = createPlayer(app, ui, audio);

    // 首次交互解锁音频（页面级）
    const unlockAudio = () => { audio.resume(); window.removeEventListener('pointerdown', unlockAudio); window.removeEventListener('keydown', unlockAudio); };
    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);

    // 窗口自适应
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        composer.setSize(window.innerWidth, window.innerHeight);
    });

    // —— 设置面板联动 ——
    const SHADOW_TYPES = {
        basic: THREE.BasicShadowMap,
        pcf: THREE.PCFShadowMap,
        pcfsoft: THREE.PCFSoftShadowMap
    };

    function applyQuality(key) {
        const q = QUALITY_PRESETS[key];
        if (!q) return;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
        renderer.shadowMap.enabled = q.shadows;
        renderer.shadowMap.type = SHADOW_TYPES[q.shadowType];
        bloomPass.enabled = q.bloom;
        ui.setQuality(key);
    }

    for (const key in ui.qualityButtons) {
        ui.qualityButtons[key].addEventListener('click', () => applyQuality(key));
    }
    applyQuality(SETTINGS.quality);

    ui.volumeSlider.value = Math.round(SETTINGS.volume * 100);
    ui.sensSlider.value = Math.round(SETTINGS.sensitivity * 100000);
    ui.volumeSlider.addEventListener('input', () => audio.setVolume(ui.volumeSlider.value / 100));
    ui.sensSlider.addEventListener('input', () => { player.fp.lookSensitivity = ui.sensSlider.value / 100000; });

    // FPS 统计
    let fpsFrames = 0;
    let fpsLastTime = performance.now();
    ui.showFps.addEventListener('change', () => {
        ui.fpsBadge.style.display = ui.showFps.checked ? 'block' : 'none';
    });

    // 渲染循环
    function animate() {
        requestAnimationFrame(animate);
        const dt = Math.min(app.clock.getDelta(), 0.1);
        const t = app.clock.getElapsedTime();

        // FPS 统计（每秒刷新一次）
        fpsFrames++;
        const nowMs = performance.now();
        if (nowMs - fpsLastTime >= 1000) {
            const fps = Math.round(fpsFrames * 1000 / (nowMs - fpsLastTime));
            const txt = fps + ' FPS';
            ui.setFps(txt);
            ui.fpsBadge.textContent = txt;
            fpsFrames = 0;
            fpsLastTime = nowMs;
        }

        // 雕塑旋转 + 发光呼吸
        app.sculpture.rotation.y = t * 0.4;
        app.sculpture.rotation.x = t * 0.2;
        app.sculpture.material.emissiveIntensity = 0.35 + Math.sin(t * 2) * 0.15;
        app.halo.material.opacity = 0.15 + Math.sin(t * 2) * 0.12;
        app.halo.scale.setScalar(1 + Math.sin(t * 2) * 0.05);

        // 电影 shader 时间（胶片颗粒动画）
        cinematicPass.uniforms.uTime.value = t;

        // 均衡器动画
        for (const bar of app.equalizerBars) {
            const freq = bar.userData.baseFreq;
            const phase = bar.userData.phase;
            const height = 0.3 + Math.abs(Math.sin(t * freq + phase)) * 2.5 + Math.abs(Math.sin(t * freq * 2.3 + phase)) * 0.8;
            bar.scale.y = height;
            bar.position.y = height / 2;
            bar.material.emissiveIntensity = 0.5 + height * 0.2;
        }

        // 钢琴琴盖微微震动
        const lidMesh = app.piano.getObjectByName('pianoLid');
        if (lidMesh) lidMesh.rotation.x = -Math.PI / 2 + 0.7 + Math.sin(t * 8) * 0.005;

        // 钢琴师手部弹奏动画
        if (app.pianistFigure) {
            const tNow = performance.now() * 0.001;
            app.pianistFigure.children.forEach((child, i) => {
                if (i === 4 || i === 5 || i === 7 || i === 8) {
                    child.position.y += Math.sin(tNow * 4 + i * 1.5) * 0.002;
                }
            });
            const glow = app.pianistFigure.children[app.pianistFigure.children.length - 2];
            if (glow && glow.material) {
                glow.material.opacity = 0.06 + Math.sin(tNow * 2) * 0.03;
            }
            const flight = app.pianistFigure.children[app.pianistFigure.children.length - 1];
            if (flight && flight.isPointLight) {
                flight.intensity = 0.6 + Math.sin(tNow * 3) * 0.2;
            }
        }

        world.updateDust();
        world.updateDoors(dt);
        player.updateFP(dt);
        if (app.fp.enabled) app.playerLight.position.copy(camera.position);
        if (controls.enabled) controls.update();
        composer.render();
    }

    ui.hideLoading();
    animate();
}

init();