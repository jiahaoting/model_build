import * as THREE from 'three';
import { PLAYER } from './config.js';

// ============================================================
// 🚶 第一人称漫游（移动 / 视线 / 碰撞）+ 👆 交互系统
// ============================================================
export function createPlayer(app, ui, audio) {
    const { scene, camera, renderer, controls } = app;
    const colliders = app.colliders;
    const videoScreens = app.videoScreens;
    const playerLight = app.playerLight;

    // 采用 YXZ 欧拉顺序：yaw(Y) → pitch(X) → roll(Z)，保证三者解耦，
    // 避免 lookAt 用世界 up 向量重正交化时在俯仰极限处出现的镜头翻转。
    camera.rotation.order = 'YXZ';

    // —— 状态 ——
    const fp = {
        enabled: false, pitch: 0, yaw: 0,
        pos: new THREE.Vector3(...PLAYER.startPos),
        velocity: new THREE.Vector3(),
        moveSpeed: PLAYER.moveSpeed, runSpeed: PLAYER.runSpeed, radius: PLAYER.radius,
        eyeHeight: PLAYER.eyeHeight, bobTimer: 0, bobCurrent: 0,
        bobOffsetY: 0, bobOffsetRoll: 0,
        bobFreqWalk: PLAYER.bobFreqWalk, bobFreqRun: PLAYER.bobFreqRun,
        bobAmpWalk: PLAYER.bobAmpWalk, bobAmpRun: PLAYER.bobAmpRun,
        bobRollWalk: PLAYER.bobRollWalk, bobRollRun: PLAYER.bobRollRun,
        lookSensitivity: PLAYER.lookSensitivity,
        acceleration: PLAYER.acceleration, deceleration: PLAYER.deceleration,
        stepAccum: 0
    };
    const keys = {};
    app.fp = fp;
    app.keys = keys;

    let lastOrbitPos = new THREE.Vector3();
    let lastOrbitTarget = new THREE.Vector3();

    // —— 视线 ——
    function onMouseMove(e) {
        if (!fp.enabled || document.pointerLockElement !== renderer.domElement) return;
        const sens = fp.lookSensitivity;
        fp.yaw   -= e.movementX * sens;
        fp.pitch -= e.movementY * sens;
        const limit = Math.PI / 2 - 0.05;
        fp.pitch = Math.max(-limit, Math.min(limit, fp.pitch));
    }

    // —— 移动碰撞 ——
    function intersectsXZ(box, px, pz, r) {
        const cx = Math.max(box.min.x, Math.min(px, box.max.x));
        const cz = Math.max(box.min.z, Math.min(pz, box.max.z));
        const dx = px - cx, dz = pz - cz;
        return (dx*dx + dz*dz) < r*r;
    }
    function canMoveTo(nx, nz) {
        for (const c of colliders) {
            if (!c.enabled) continue;
            if (intersectsXZ(c.box, nx, nz, fp.radius)) return false;
        }
        return true;
    }

    function updateFP(dt) {
        if (!fp.enabled) return;
        let ix = 0, iz = 0;
        if (keys['KeyW']) iz -= 1;
        if (keys['KeyS']) iz += 1;
        if (keys['KeyA']) ix -= 1;
        if (keys['KeyD']) ix += 1;
        const len = Math.hypot(ix, iz);
        const isMoving = len > 0;
        if (isMoving) { ix /= len; iz /= len; }
        const isRunning = keys['ShiftLeft'] || keys['ShiftRight'];
        const speed = isRunning ? fp.runSpeed : fp.moveSpeed;
        const fwdX = -Math.sin(fp.yaw), fwdZ = -Math.cos(fp.yaw);
        const rightX = Math.cos(fp.yaw), rightZ = -Math.sin(fp.yaw);

        // 目标速度（世界 XZ），以加速度向目标平滑过渡（加速/减速阻尼）
        const targetVX = (fwdX * (-iz) + rightX * ix) * speed;
        const targetVZ = (fwdZ * (-iz) + rightZ * ix) * speed;
        const smoothK = 1 - Math.exp(-(isMoving ? fp.acceleration : fp.deceleration) * dt);
        fp.velocity.x += (targetVX - fp.velocity.x) * smoothK;
        fp.velocity.z += (targetVZ - fp.velocity.z) * smoothK;

        const dx = fp.velocity.x * dt;
        const dz = fp.velocity.z * dt;
        let actuallyMoved = false;
        if (canMoveTo(fp.pos.x + dx, fp.pos.z)) { fp.pos.x += dx; actuallyMoved = true; }
        if (canMoveTo(fp.pos.x, fp.pos.z + dz)) { fp.pos.z += dz; actuallyMoved = true; }

        // 脚步声（按行进距离触发）
        if (isMoving && actuallyMoved) {
            fp.stepAccum += Math.hypot(dx, dz);
            const stepLen = isRunning ? PLAYER.stepRun : PLAYER.stepWalk;
            if (fp.stepAccum > stepLen) {
                fp.stepAccum = 0;
                if (audio) audio.playFootstep(isRunning);
            }
        }

        const bobFreq = isRunning ? fp.bobFreqRun : fp.bobFreqWalk;
        const bobAmp  = isRunning ? fp.bobAmpRun  : fp.bobAmpWalk;
        const bobRoll = isRunning ? fp.bobRollRun : fp.bobRollWalk;
        if (isMoving && actuallyMoved) {
            fp.bobTimer += dt * bobFreq;
            const bobTargetY    = Math.sin(fp.bobTimer * 2) * bobAmp;
            const bobTargetRoll = Math.sin(fp.bobTimer) * bobRoll;
            fp.bobCurrent += (1.0 - fp.bobCurrent) * Math.min(1, dt * 8);
            fp.bobOffsetY += (bobTargetY - fp.bobOffsetY) * Math.min(1, dt * 12);
            fp.bobOffsetRoll += (bobTargetRoll - fp.bobOffsetRoll) * Math.min(1, dt * 12);
        } else {
            fp.bobTimer = 0;
            fp.bobOffsetY    *= Math.max(0, 1 - dt * 8);
            fp.bobOffsetRoll *= Math.max(0, 1 - dt * 8);
            fp.bobCurrent    += (0 - fp.bobCurrent) * Math.min(1, dt * 6);
        }

        camera.position.set(fp.pos.x, fp.eyeHeight + fp.bobOffsetY, fp.pos.z);
        // 直接以 YXZ 欧拉角写入朝向，杜绝 lookAt + Math.tan 在俯仰极限处的数值奇异性
        // 造成的镜头翻转；pitch 已在输入层被严格夹紧在 ±(π/2-0.05) 内。
        camera.rotation.set(fp.pitch, fp.yaw, fp.bobOffsetRoll);
    }

    // —— 模式切换 ——
    function toggleMode() {
        fp.enabled = !fp.enabled;
        if (fp.enabled) {
            lastOrbitPos.copy(camera.position);
            lastOrbitTarget.copy(controls.target);
            fp.pos.set(camera.position.x, 1.7, camera.position.z);
            const dir = new THREE.Vector3();
            camera.getWorldDirection(dir);
            fp.yaw = Math.atan2(-dir.x, -dir.z);
            fp.pitch = Math.asin(dir.y);
            fp.pitch = Math.max(-(Math.PI/2 - 0.05), Math.min(Math.PI/2 - 0.05, fp.pitch));
            controls.enabled = false;
            playerLight.intensity = 1.2;
            ui.setMode('第一人称漫游');
            ui.setHint('漫游模式：<b>WASD</b> 移动 ｜ <b>Shift</b> 奔跑 ｜ 鼠标转视角 ｜ 点击屏幕锁定鼠标 ｜ <b>左键/E键</b> 播放正前方屏幕 ｜ <b>ESC</b> 解锁 ｜ <b>C</b> 切轨道模式');
        } else {
            if (document.pointerLockElement) document.exitPointerLock();
            controls.enabled = true;
            playerLight.intensity = 0;
            camera.position.copy(lastOrbitPos);
            controls.target.copy(lastOrbitTarget);
            controls.update();
            ui.setMode('轨道浏览');
            ui.setHint('轨道模式：左键拖动旋转 ｜ 滚轮缩放 ｜ 右键平移 ｜ 点击屏幕播放视频 ｜ 按 <b>C</b> 切换漫游模式');
        }
    }

    // —— 交互 ——
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    function interactWithScreen() {
        const screenMeshes = videoScreens.map(s => s.screen);
        const intersects = raycaster.intersectObjects(screenMeshes);
        if (intersects.length > 0) {
            const hit = intersects[0].object;
            const screenData = videoScreens.find(s => s.screen === hit);
            if (screenData) {
                const { videoEl, screenLight, title, description } = screenData;
                videoScreens.forEach(s => {
                    if (s.videoEl) { try { s.videoEl.pause(); } catch(e){} }
                    s.screenLight.intensity = 0;
                });
                if (videoEl) {
                    if (videoEl.paused) {
                        videoEl.play().catch(() => {});
                        screenLight.intensity = 5;
                    } else {
                        videoEl.pause();
                        screenLight.intensity = 0;
                    }
                } else {
                    screenLight.intensity = (screenLight.intensity > 0) ? 0 : 4;
                }
                ui.showVideo(title, description);
            }
            return;
        }

        // 钢琴交互：点击钢琴演奏一个随机音符（五声音阶）
        if (app.piano) {
            const pianoHits = raycaster.intersectObjects(app.piano.children, true);
            if (pianoHits.length > 0) audio.playPianoNote();
        }
    }

    let pointerDownPos = null;
    let pointerDownTime = 0;
    let pointerDownButton = -1;
    let fpJustLocked = false;

    function bindInput() {
        document.addEventListener('mousemove', onMouseMove);

        document.addEventListener('pointerlockchange', () => {
            ui.setCrosshair(document.pointerLockElement === renderer.domElement);
        });

        window.addEventListener('keydown', e => {
            keys[e.code] = true;
            if (e.code === 'KeyC' && !e.repeat) toggleMode();
            if (e.code === 'Escape' && fp.enabled && document.pointerLockElement) document.exitPointerLock();
        });
        window.addEventListener('keyup', e => { keys[e.code] = false; });

        window.addEventListener('keydown', e => {
            if (e.code === 'KeyE' && fp.enabled && document.pointerLockElement === renderer.domElement) {
                raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
                interactWithScreen();
            }
        });

        renderer.domElement.addEventListener('contextmenu', (e) => { e.preventDefault(); });

        renderer.domElement.addEventListener('pointerdown', (e) => {
            pointerDownButton = e.button;
            pointerDownPos = { x: e.clientX, y: e.clientY };
            pointerDownTime = Date.now();
            fpJustLocked = false;
            if (fp.enabled && document.pointerLockElement !== renderer.domElement) {
                fpJustLocked = true;
                renderer.domElement.requestPointerLock();
            }
        });

        renderer.domElement.addEventListener('pointerup', (e) => {
            if (!pointerDownPos) return;
            const dx = e.clientX - pointerDownPos.x;
            const dy = e.clientY - pointerDownPos.y;
            const moved = Math.hypot(dx, dy);
            const elapsed = Date.now() - pointerDownTime;
            const wasLeft = (pointerDownButton === 0 && e.button === 0);
            const wasLockClick = fpJustLocked;
            pointerDownPos = null;
            pointerDownButton = -1;
            fpJustLocked = false;

            if (wasLockClick) return;
            if (!wasLeft || moved > 6 || elapsed > 350) return;
            if (fp.enabled && document.pointerLockElement !== renderer.domElement) return;

            if (fp.enabled) {
                raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
            } else {
                mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
                mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
                raycaster.setFromCamera(mouse, camera);
            }
            interactWithScreen();
        });

        renderer.domElement.addEventListener('pointercancel', () => {
            pointerDownPos = null;
            pointerDownButton = -1;
        });
    }

    bindInput();

    return { fp, keys, updateFP, toggleMode };
}