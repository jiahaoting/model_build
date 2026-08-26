import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CinematicShader } from './shaders.js';
import { createResourceManager } from './resources.js';
import { createConcertWorld } from './concertHall.js';
import { createConcertAudioManager } from './concertAudio.js';
import { createPerformer } from './concertPerformer.js';
import { Violin } from './violin.js';
import { ViolinBow } from './violinBow.js';
import { getScores } from './scores.js';
import { parseMidiFile } from './midiParser.js';
const RENDER_CFG = { antialias: true, powerPreference: 'high-performance', maxPixelRatio: 2, exposure: 1.18 };
const CAMERA_CFG = { fov: 60, near: 0.1, far: 200, position: [0, 8, 16] };
const ORBIT_CFG = { minDistance: 2, maxDistance: 60, target: [0, 2.5, -8] };
const BLOOM_CFG = { strength: 0.72, radius: 0.7, threshold: 0.72 };
const SETTINGS = { quality: 'high', volume: 0.8, sensitivity: 0.002, showFps: false };
const QUALITY_PRESETS = {
    low:    { label: '低', pixelRatio: 1.0, shadows: false, bloom: false },
    medium: { label: '中', pixelRatio: 1.5, shadows: true,  bloom: true },
    high:   { label: '高', pixelRatio: 2.0, shadows: true,  bloom: true }
};
const PLAYER = {
    startPos: [0, 1.7, 10], eyeHeight: 1.7, radius: 0.4,
    moveSpeed: 5.0, runSpeed: 10.0, acceleration: 14.0, deceleration: 10.0,
    lookSensitivity: 0.002, gamepadLookSpeed: 2.6, jumpSpeed: 6.5, gravity: 22.0,
    bobFreqWalk: 9.0, bobFreqRun: 13.0, bobAmpWalk: 0.05, bobAmpRun: 0.1,
    bobRollWalk: 0.01, bobRollRun: 0.02, stepWalk: 1.8, stepRun: 2.6
};
const PIANO_MAP = {
    white: [
        { code: 'KeyZ', semitone: 0 }, { code: 'KeyX', semitone: 2 }, { code: 'KeyC', semitone: 4 },
        { code: 'KeyV', semitone: 5 }, { code: 'KeyB', semitone: 7 }, { code: 'KeyN', semitone: 9 },
        { code: 'KeyM', semitone: 11 }, { code: 'Comma', semitone: 12 }, { code: 'Period', semitone: 14 },
        { code: 'Slash', semitone: 16 }
    ],
    black: [
        { code: 'KeyS', semitone: 1 }, { code: 'KeyD', semitone: 3 }, { code: 'KeyG', semitone: 6 },
        { code: 'KeyH', semitone: 8 }, { code: 'KeyJ', semitone: 10 }, { code: 'KeyL', semitone: 13 },
        { code: 'Semicolon', semitone: 15 }
    ]
};
const PIANO_BASE_MIDI = 36;
const PIANO_OCTAVE_MIN = -2, PIANO_OCTAVE_MAX = 6;
const el = (id) => document.getElementById(id);
const ui = {
    loading: el('loading'), modeText: el('mode-text'), controlsHint: el('controls-hint'), crosshair: el('crosshair'),
    fpsBadge: el('fps-badge'), fpsValue: el('fps-value'), settingsPanel: el('settings-panel'),
    btnSettings: el('btn-settings'), btnCloseSettings: el('btn-close-settings'),
    qualityButtons: { low: el('q-low'), medium: el('q-medium'), high: el('q-high') },
    volumeSlider: el('set-volume'), sensSlider: el('set-sensitivity'), showFps: el('set-fps'),
    interactPrompt: el('interact-prompt'), btnScores: el('btn-scores'), scorePanel: el('score-panel'),
    btnCloseScores: el('btn-close-scores'), scoreList: el('score-list'), nowPlaying: el('now-playing'),
    midiUpload: el('midi-upload'), soundBadge: el('sound-badge'), btnTestTone: el('btn-test-tone'),
    hideLoading() { this.loading.style.display = 'none'; },
    setMode(t) { this.modeText.textContent = t; },
    setHint(h) { this.controlsHint.innerHTML = h; },
    setCrosshair(on) { this.crosshair.style.display = on ? 'block' : 'none'; },
    toggleSettings(open) {
        const show = (open === undefined) ? (this.settingsPanel.style.display !== 'flex') : open;
        this.settingsPanel.style.display = show ? 'flex' : 'none';
    },
    setQuality(key) { for (const k in this.qualityButtons) this.qualityButtons[k].classList.toggle('active', k === key); },
    setFps(t) { this.fpsValue.textContent = t; },
    setInteract(show, text) {
        if (!this.interactPrompt) return;
        if (!show || !text) { this.interactPrompt.style.display = 'none'; this.interactPrompt.innerHTML = ''; return; }
        this.interactPrompt.innerHTML = text;
        this.interactPrompt.style.display = 'block';
    }
};
function createPlayer(app, ui, audio, groundY) {
    const { camera, renderer, controls } = app;
    const colliders = app.colliders;
    camera.rotation.order = 'YXZ';
    const fp = {
        enabled: false, yaw: 0, pitch: 0, curYaw: 0, curPitch: 0,
        pos: new THREE.Vector3(...PLAYER.startPos), velocity: new THREE.Vector3(),
        ground: 0, fall: 0, vy: 0, bobTimer: 0, bobOffsetY: 0, bobOffsetRoll: 0,
        seatSway: 0, stepAccum: 0, seat: null, nearSeat: null,
        sit: { active: false, target: 'stand', tweenT: 0, fromEye: new THREE.Vector3(), toEye: new THREE.Vector3(), fromYaw: 0, toYaw: 0, fromPitch: 0, toPitch: 0 },
        lookSensitivity: PLAYER.lookSensitivity, lookSmooth: 30.0, skipMouseMoves: 0
    };
    const keys = {};
    app.fp = fp;
    app.keys = keys;
    const PITCH_LIMIT = Math.PI / 2 - 0.05;
    const SIT_DURATION = 0.6;
    const INTERACT_RANGE = 2.0;
    function clampPitch(p) { return Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, p)); }
    function lerpAngle(a, b, t) { const d = Math.atan2(Math.sin(b - a), Math.cos(b - a)); return a + d * t; }
    function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
    let lastOrbitPos = new THREE.Vector3();
    let lastOrbitTarget = new THREE.Vector3();
    const gamepad = {
        prevJump: false, prevInteract: false,
        read() {
            const list = navigator.getGamepads ? navigator.getGamepads() : [];
            let g = null;
            for (const c of list) { if (c) { g = c; break; } }
            if (!g) { this.prevJump = this.prevInteract = false; return null; }
            const dz = 0.15;
            const ax = (i) => { const v = g.axes[i]; return (v && Math.abs(v) > dz) ? v : 0; };
            const jump = !!(g.buttons[0] && g.buttons[0].pressed);
            const interact = !!(g.buttons[2] && g.buttons[2].pressed);
            const r = { moveX: ax(0), moveY: ax(1), lookX: ax(2), lookY: ax(3), jumpEdge: jump && !this.prevJump, interactEdge: interact && !this.prevInteract };
            this.prevJump = jump;
            this.prevInteract = interact;
            return r;
        }
    };
    function onMouseMove(e) {
        if (!fp.enabled || document.pointerLockElement !== renderer.domElement) return;
        if (fp.skipMouseMoves > 0) { fp.skipMouseMoves--; return; }
        fp.yaw   -= e.movementX * fp.lookSensitivity;
        fp.pitch -= e.movementY * fp.lookSensitivity;
        fp.pitch = clampPitch(fp.pitch);
    }
    function intersectsXZ(box, px, pz, r) {
        const cx = Math.max(box.min.x, Math.min(px, box.max.x));
        const cz = Math.max(box.min.z, Math.min(pz, box.max.z));
        const dx = px - cx, dz = pz - cz;
        return (dx * dx + dz * dz) < r * r;
    }
    function canMoveTo(nx, nz) {
        for (const c of colliders) {
            if (!c.enabled) continue;
            if (intersectsXZ(c.box, nx, nz, PLAYER.radius)) return false;
        }
        return true;
    }
    function findNearbySeat() {
        let best = null, bestD = INTERACT_RANGE;
        for (const s of app.seats || []) {
            const dx = fp.pos.x - s.eyeX;
            const dz = fp.pos.z - s.eyeZ;
            const d = Math.hypot(dx, dz);
            if (d < bestD) { bestD = d; best = s; }
        }
        return best;
    }
    function startSit(seat) {
        fp.seat = seat; fp.sit.target = 'sit'; fp.sit.active = true; fp.sit.tweenT = 0;
        fp.sit.fromEye.copy(camera.position); fp.sit.fromYaw = fp.curYaw; fp.sit.fromPitch = fp.curPitch;
        fp.sit.toEye.set(seat.eyeX, seat.eyeY, seat.eyeZ); fp.sit.toYaw = seat.yaw; fp.sit.toPitch = 0;
        fp.yaw = seat.yaw; fp.pitch = 0; fp.nearSeat = null;
    }
    function startStand() {
        const seat = fp.seat;
        if (!seat) return;
        fp.sit.target = 'stand'; fp.sit.active = true; fp.sit.tweenT = 0;
        fp.sit.fromEye.copy(camera.position); fp.sit.fromYaw = fp.curYaw; fp.sit.fromPitch = fp.curPitch;
        fp.sit.toEye.set(seat.standX, seat.standY, seat.standZ); fp.sit.toYaw = fp.curYaw; fp.sit.toPitch = fp.curPitch;
    }
    function trySit() { if (!fp.enabled || fp.sit.active || fp.seat) return; if (fp.nearSeat) startSit(fp.nearSeat); }
    function tryStand() { if (!fp.enabled || fp.sit.active || !fp.seat) return; startStand(); }
    function onInteract() { if (!fp.enabled || fp.sit.active) return; if (fp.seat) tryStand(); else trySit(); }
    function tryJump() { if (fp.seat || fp.sit.active) return; if (fp.fall > 0) return; fp.vy = PLAYER.jumpSpeed; fp.fall = 0.001; }
    function updateSitTween(dt) {
        fp.sit.tweenT += dt / SIT_DURATION;
        const t = Math.min(1, fp.sit.tweenT);
        const e = easeInOutCubic(t);
        camera.position.lerpVectors(fp.sit.fromEye, fp.sit.toEye, e);
        const yaw = lerpAngle(fp.sit.fromYaw, fp.sit.toYaw, e);
        const pitch = fp.sit.fromPitch + (fp.sit.toPitch - fp.sit.fromPitch) * e;
        camera.rotation.set(pitch, yaw, 0);
        fp.curYaw = yaw; fp.curPitch = pitch;
        if (t >= 1) {
            fp.sit.active = false; fp.curYaw = fp.sit.toYaw; fp.curPitch = fp.sit.toPitch;
            fp.yaw = fp.sit.toYaw; fp.pitch = fp.sit.toPitch;
            fp.pos.x = fp.sit.toEye.x; fp.pos.z = fp.sit.toEye.z;
            fp.fall = 0; fp.vy = 0; fp.bobTimer = 0; fp.bobOffsetY = 0; fp.bobOffsetRoll = 0;
            if (fp.sit.target === 'stand') { fp.seat = null; fp.ground = groundY(fp.pos.x, fp.pos.z); }
            else { fp.ground = fp.sit.toEye.y - PLAYER.eyeHeight; }
            camera.position.copy(fp.sit.toEye);
            camera.rotation.set(fp.curPitch, fp.curYaw, 0);
        }
    }
    function updateSeated(dt) {
        const seat = fp.seat;
        fp.seatSway += dt;
        const sway = Math.sin(fp.seatSway * 1.6) * 0.004;
        camera.position.set(seat.eyeX, seat.eyeY + sway, seat.eyeZ);
        camera.rotation.set(fp.curPitch, fp.curYaw, 0);
    }
    function updateFP(dt) {
        if (!fp.enabled) { ui.setInteract(false); return; }
        const gp = gamepad.read();
        if (gp && (gp.lookX || gp.lookY)) {
            fp.yaw   -= gp.lookX * PLAYER.gamepadLookSpeed * dt;
            fp.pitch -= gp.lookY * PLAYER.gamepadLookSpeed * dt;
            fp.pitch = clampPitch(fp.pitch);
        }
        const lookK = 1 - Math.exp(-fp.lookSmooth * dt);
        fp.curYaw   += (fp.yaw   - fp.curYaw)   * lookK;
        fp.curPitch += (fp.pitch - fp.curPitch) * lookK;
        if (fp.sit.active) { ui.setInteract(false); }
        else if (fp.seat) { ui.setInteract(true, '按 <span class="key">ESC</span> 起身'); }
        else { fp.nearSeat = findNearbySeat(); ui.setInteract(!!fp.nearSeat, '按 <span class="key">F</span> 坐下'); }
        if (gp && gp.interactEdge) onInteract();
        if (fp.sit.active) { updateSitTween(dt); return; }
        if (fp.seat) { updateSeated(dt); return; }
        let ix = 0, iz = 0;
        if (keys['KeyW']) iz -= 1;
        if (keys['KeyS']) iz += 1;
        if (keys['KeyA']) ix -= 1;
        if (keys['KeyD']) ix += 1;
        if (gp) { ix += gp.moveX; iz += gp.moveY; }
        const len = Math.hypot(ix, iz);
        const isMoving = len > 0;
        if (isMoving) { ix /= len; iz /= len; }
        const isRunning = keys['ShiftLeft'] || keys['ShiftRight'];
        const speed = isRunning ? PLAYER.runSpeed : PLAYER.moveSpeed;
        const fwdX = -Math.sin(fp.curYaw), fwdZ = -Math.cos(fp.curYaw);
        const rightX = Math.cos(fp.curYaw), rightZ = -Math.sin(fp.curYaw);
        const targetVX = (fwdX * (-iz) + rightX * ix) * speed;
        const targetVZ = (fwdZ * (-iz) + rightZ * ix) * speed;
        const smoothK = 1 - Math.exp(-(isMoving ? PLAYER.acceleration : PLAYER.deceleration) * dt);
        fp.velocity.x += (targetVX - fp.velocity.x) * smoothK;
        fp.velocity.z += (targetVZ - fp.velocity.z) * smoothK;
        const dx = fp.velocity.x * dt, dz = fp.velocity.z * dt;
        let moved = false;
        if (canMoveTo(fp.pos.x + dx, fp.pos.z)) { fp.pos.x += dx; moved = true; }
        if (canMoveTo(fp.pos.x, fp.pos.z + dz)) { fp.pos.z += dz; moved = true; }
        if (isMoving && moved) {
            fp.stepAccum += Math.hypot(dx, dz);
            const stepLen = isRunning ? PLAYER.stepRun : PLAYER.stepWalk;
            if (fp.stepAccum > stepLen) { fp.stepAccum = 0; audio.playFootstep(isRunning); }
        }
        if (gp && gp.jumpEdge) tryJump();
        if (fp.fall > 0) { fp.vy -= PLAYER.gravity * dt; fp.fall += fp.vy * dt; if (fp.fall <= 0) { fp.fall = 0; fp.vy = 0; } }
        const targetGround = groundY(fp.pos.x, fp.pos.z);
        fp.ground += (targetGround - fp.ground) * Math.min(1, dt * 12);
        const bobFreq = isRunning ? PLAYER.bobFreqRun : PLAYER.bobFreqWalk;
        const bobAmp = isRunning ? PLAYER.bobAmpRun : PLAYER.bobAmpWalk;
        const bobRoll = isRunning ? PLAYER.bobRollRun : PLAYER.bobRollWalk;
        if (isMoving && moved && fp.fall <= 0) {
            fp.bobTimer += dt * bobFreq;
            fp.bobOffsetY = Math.sin(fp.bobTimer * 2) * bobAmp;
            fp.bobOffsetRoll = Math.sin(fp.bobTimer) * bobRoll;
        } else {
            fp.bobTimer = 0;
            fp.bobOffsetY *= Math.max(0, 1 - dt * 8);
            fp.bobOffsetRoll *= Math.max(0, 1 - dt * 8);
        }
        camera.position.set(fp.pos.x, fp.ground + fp.fall + PLAYER.eyeHeight + fp.bobOffsetY, fp.pos.z);
        camera.rotation.set(fp.curPitch, fp.curYaw, fp.bobOffsetRoll);
    }
    function resetSeatState() {
        fp.seat = null; fp.nearSeat = null; fp.sit.active = false;
        fp.fall = 0; fp.vy = 0; fp.bobTimer = 0; fp.bobOffsetY = 0; fp.bobOffsetRoll = 0;
        ui.setInteract(false);
    }
    function toggleMode() {
        fp.enabled = !fp.enabled;
        if (fp.enabled) {
            resetSeatState();
            lastOrbitPos.copy(camera.position);
            lastOrbitTarget.copy(controls.target);
            fp.pos.set(camera.position.x, 1.7, camera.position.z);
            fp.ground = 0;
            const dir = new THREE.Vector3();
            camera.getWorldDirection(dir);
            fp.yaw = Math.atan2(-dir.x, -dir.z);
            fp.pitch = Math.asin(dir.y);
            fp.pitch = clampPitch(fp.pitch);
            fp.curYaw = fp.yaw; fp.curPitch = fp.pitch;
            controls.enabled = false;
            ui.setMode('第一人称漫游');
            ui.setHint('漫游模式：<b>WASD</b> 移动 ｜ <b>Space</b> 跳跃 ｜ <b>Shift</b> 奔跑 ｜ 鼠标转视角 ｜ 靠近座位按 <b>F</b> 坐下 / <b>ESC</b> 起身 ｜ 就座琴凳后弹奏钢琴 ｜ <b>C</b> 切轨道');
        } else {
            if (document.pointerLockElement) document.exitPointerLock();
            resetSeatState();
            controls.enabled = true;
            camera.position.copy(lastOrbitPos);
            controls.target.copy(lastOrbitTarget);
            controls.update();
            ui.setMode('轨道浏览');
            ui.setHint('轨道模式：左键拖动旋转 ｜ 滚轮缩放 ｜ 右键平移 ｜ 点击钢琴弹奏 ｜ 按 <b>C</b> 切换漫游');
        }
    }
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    function playPiano(ndc) {
        if (!app.piano) return;
        raycaster.setFromCamera(ndc, camera);
        const hits = raycaster.intersectObjects(app.piano.children, true);
        if (hits.length > 0) audio.playPianoNote();
    }
    let pointerDownPos = null, pointerDownTime = 0, pointerDownButton = -1, fpJustLocked = false;
    function bindInput() {
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('pointerlockchange', () => {
            const locked = document.pointerLockElement === renderer.domElement;
            ui.setCrosshair(locked);
            if (locked) fp.skipMouseMoves = 2;
        });
        window.addEventListener('keydown', e => {
            keys[e.code] = true;
            const atPiano = !!(fp.seat && fp.seat.isPiano && !fp.sit.active);
            if (e.code === 'KeyC' && !e.repeat && !atPiano) toggleMode();
            if (e.code === 'Escape' && fp.enabled) {
                if (fp.seat) { e.preventDefault(); tryStand(); }
                else if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
            }
            if (e.code === 'Space' && fp.enabled) { e.preventDefault(); if (!e.repeat) tryJump(); }
            if (e.code === 'KeyF' && fp.enabled && !e.repeat) trySit();
        });
        window.addEventListener('keyup', e => { keys[e.code] = false; });
        window.addEventListener('keydown', e => {
            if (e.code === 'KeyE' && fp.enabled && document.pointerLockElement === renderer.domElement) {
                playPiano(new THREE.Vector2(0, 0));
            }
        });
        renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
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
            pointerDownPos = null; pointerDownButton = -1; fpJustLocked = false;
            if (wasLockClick) return;
            if (!wasLeft || moved > 6 || elapsed > 350) return;
            if (fp.enabled && document.pointerLockElement !== renderer.domElement) return;
            if (fp.enabled) { playPiano(new THREE.Vector2(0, 0)); }
            else { mouse.x = (e.clientX / window.innerWidth) * 2 - 1; mouse.y = -(e.clientY / window.innerHeight) * 2 + 1; playPiano(mouse); }
        });
        renderer.domElement.addEventListener('pointercancel', () => { pointerDownPos = null; pointerDownButton = -1; });
    }
    bindInput();
    return { fp, keys, updateFP, toggleMode };
}
function createPianoController(app, audio, world) {
    const hintEl = document.getElementById('piano-hint');
    const octaveEl = document.getElementById('piano-octave');
    const velEl = document.getElementById('piano-velocity');
    const state = { octave: 0, velocity: 0.75, sustain: false, wasActive: false, activeKeys: new Map() };
    function isActive() { const fp = app.fp; return !!(fp && fp.enabled && fp.seat && fp.seat.isPiano && !fp.sit.active); }
    function noteToMidi(semitone) { const m = PIANO_BASE_MIDI + semitone + state.octave * 12; return (m < 21 || m > 108) ? -1 : m; }
    function codeToMidi(code) {
        for (const k of PIANO_MAP.white) if (k.code === code) return noteToMidi(k.semitone);
        for (const k of PIANO_MAP.black) if (k.code === code) return noteToMidi(k.semitone);
        return -1;
    }
    function haptic() { try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) {} }
    function refreshHint() {
        if (hintEl) hintEl.style.display = isActive() ? 'block' : 'none';
        if (octaveEl) octaveEl.textContent = (state.octave >= 0 ? '+' : '') + state.octave;
        if (velEl) velEl.textContent = Math.round(state.velocity * 100) + '%';
    }
    function releaseAll() {
        for (const [code, midi] of state.activeKeys) { audio.noteOff(midi); if (world.pressPianoKey) world.pressPianoKey(midi, false); }
        state.activeKeys.clear();
        if (state.sustain) { state.sustain = false; audio.setSustain(false); }
    }
    function onKeyDown(e) {
        if (!isActive()) return;
        if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) { state.sustain = true; audio.setSustain(true); } return; }
        if (e.code === 'KeyQ' && !e.repeat) { state.octave = Math.max(PIANO_OCTAVE_MIN, state.octave - 1); refreshHint(); return; }
        if (e.code === 'KeyW' && !e.repeat) { state.octave = Math.min(PIANO_OCTAVE_MAX, state.octave + 1); refreshHint(); return; }
        if (e.code === 'Minus' && !e.repeat) { state.octave = Math.max(PIANO_OCTAVE_MIN, state.octave - 1); refreshHint(); return; }
        if (e.code === 'Equal' && !e.repeat) { state.octave = Math.min(PIANO_OCTAVE_MAX, state.octave + 1); refreshHint(); return; }
        if (e.code === 'ArrowUp' && !e.repeat) { state.velocity = Math.min(1, state.velocity + 0.05); refreshHint(); return; }
        if (e.code === 'ArrowDown' && !e.repeat) { state.velocity = Math.max(0.2, state.velocity - 0.05); refreshHint(); return; }
        const VEL_PRESETS = { Digit1: 0.2, Digit2: 0.4, Digit3: 0.6, Digit4: 0.8, Digit5: 1.0 };
        if (VEL_PRESETS[e.code] !== undefined && !e.repeat) { state.velocity = VEL_PRESETS[e.code]; refreshHint(); return; }
        if (e.code === 'KeyR' && !e.repeat) { state.octave = 0; state.velocity = 0.75; refreshHint(); return; }
        const midi = codeToMidi(e.code);
        if (midi < 0) return;
        if (e.repeat) return;
        e.preventDefault();
        state.activeKeys.set(e.code, midi);
        audio.noteOn(midi, state.velocity);
        if (world.pressPianoKey) world.pressPianoKey(midi, true, state.velocity);
        haptic();
    }
    function onKeyUp(e) {
        const midi = codeToMidi(e.code);
        if (midi >= 0) {
            if (state.activeKeys.has(e.code)) { state.activeKeys.delete(e.code); audio.noteOff(midi); if (world.pressPianoKey) world.pressPianoKey(midi, false); }
            return;
        }
        if (e.code === 'Space' && state.sustain) { state.sustain = false; audio.setSustain(false); }
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    function update() {
        const active = isActive();
        if (state.wasActive && !active) releaseAll();
        state.wasActive = active;
        refreshHint();
    }
    refreshHint();
    return { update, state };
}
async function init() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x080604);
    scene.fog = new THREE.FogExp2(0x080604, 0.008);
    const camera = new THREE.PerspectiveCamera(CAMERA_CFG.fov, window.innerWidth / window.innerHeight, CAMERA_CFG.near, CAMERA_CFG.far);
    camera.position.set(...CAMERA_CFG.position);
    const renderer = new THREE.WebGLRenderer({ antialias: RENDER_CFG.antialias, powerPreference: RENDER_CFG.powerPreference });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER_CFG.maxPixelRatio));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = RENDER_CFG.exposure;
    renderer.useLegacyLights = true;
    document.body.appendChild(renderer.domElement);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.06;
    controls.minDistance = ORBIT_CFG.minDistance; controls.maxDistance = ORBIT_CFG.maxDistance;
    controls.minPolarAngle = 0.08; controls.maxPolarAngle = Math.PI / 2.02;
    controls.target.set(...ORBIT_CFG.target);
    controls.update();
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), BLOOM_CFG.strength, BLOOM_CFG.radius, BLOOM_CFG.threshold);
    composer.addPass(bloomPass);
    const cinematicPass = new ShaderPass(CinematicShader);
    cinematicPass.uniforms.uTeal.value = 0.03;
    cinematicPass.uniforms.uOrange.value = 0.025;
    cinematicPass.uniforms.uContrast.value = 1.06;
    cinematicPass.uniforms.uVignette.value = 0.7;
    composer.addPass(cinematicPass);
    composer.addPass(new OutputPass());
    const app = {
        scene, camera, renderer, controls, composer, bloomPass, cinematicPass,
        clock: new THREE.Clock(), colliders: [], dustSystems: [],
        maxAnisotropy: renderer.capabilities.getMaxAnisotropy(),
        assets: null, piano: null, pianoSpot: null, fp: null, keys: {}
    };
    const audio = createConcertAudioManager();
    audio.attach(camera);
    const resources = createResourceManager({
        maxAnisotropy: app.maxAnisotropy,
        onProgress: (p) => { ui.loading.textContent = `正在加载音乐厅… ${Math.round(p * 100)}%`; }
    });
    resources.setManifest([
        { id: 'piano', type: 'model', url: 'assets/models/piano.glb' },
        { id: 'performer', type: 'model', url: 'assets/models/jared_leto_avatar.glb' },
        { id: 'hdri', type: 'hdr', url: 'assets/env/mirrored_hall_2k.hdr' }
    ]);
    await resources.load();
    app.assets = resources.assets;
    const hdri = app.assets && app.assets.hdri;
    if (hdri && hdri.isTexture) { scene.environment = pmrem.fromEquirectangular(hdri).texture; }
    else { scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; }
    pmrem.dispose();
    const world = createConcertWorld(app);
    world.buildWorld();
    const player = createPlayer(app, ui, audio, world.groundY);
    const piano = createPianoController(app, audio, world);
    const performer = createPerformer(app, audio, world);
    const violin = new Violin();
    try {
        await violin.load('assets/models/violin.glb');
        violin.root.position.set(-3.0, 2.4, -10.5);
        violin.root.userData.baseY = 2.4;
        const violinBasis = new THREE.Matrix4().set(0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1);
        violin.root.quaternion.setFromRotationMatrix(violinBasis);
        scene.add(violin.root);
        app.violin = violin;
    } catch (err) { console.warn('[violin] 小提琴模型加载失败（不影响钢琴演奏）', err); }
    if (app.violin) {
        const bow = new ViolinBow();
        try { await bow.load('assets/models/violin_bow.glb'); scene.add(bow.root); app.violinBow = bow; }
        catch (err) { console.warn('[violinBow] 小提琴弓加载失败（不影响演奏）', err); }
    }
    const unlock = () => { audio.resume(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    function applyQuality(key) {
        const q = QUALITY_PRESETS[key];
        if (!q) return;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
        renderer.shadowMap.enabled = q.shadows;
        bloomPass.enabled = q.bloom;
        ui.setQuality(key);
    }
    for (const key in ui.qualityButtons) { ui.qualityButtons[key].addEventListener('click', () => applyQuality(key)); }
    applyQuality(SETTINGS.quality);
    ui.volumeSlider.value = Math.round(SETTINGS.volume * 100);
    ui.sensSlider.value = Math.round(SETTINGS.sensitivity * 100000);
    ui.volumeSlider.addEventListener('input', () => audio.setVolume(ui.volumeSlider.value / 100));
    ui.sensSlider.addEventListener('input', () => { player.fp.lookSensitivity = ui.sensSlider.value / 100000; });
    ui.showFps.addEventListener('change', () => { ui.fpsBadge.style.display = ui.showFps.checked ? 'block' : 'none'; });
    ui.btnSettings.addEventListener('click', () => ui.toggleSettings());
    ui.btnCloseSettings.addEventListener('click', () => ui.toggleSettings(false));
    function updateSoundBadge() {
        if (!ui.soundBadge) return;
        const st = audio.samplerStatus;
        if (st === 'ready') { let html = '音色：<span class="st-ready">真实采样（Steinway · 4 力度层）</span>'; if (audio.testing) html += ' · 试听中…'; ui.soundBadge.innerHTML = html; }
        else if (st === 'loading') { const pct = Math.round(audio.samplerProgress * 100); ui.soundBadge.innerHTML = '音色：<span class="st-loading">加载真实采样… ' + pct + '%</span>'; }
        else if (st === 'failed') { ui.soundBadge.innerHTML = '音色：<span class="st-failed">真实采样不可用 · 回退合成音色（点此重试）</span>'; }
        else { ui.soundBadge.textContent = '音色：待首次交互后加载'; }
        ui.soundBadge.classList.toggle('retryable', st === 'failed');
    }
    updateSoundBadge();
    ui.soundBadge.addEventListener('click', () => { if (audio.samplerStatus === 'failed') { audio.retrySampler(); updateSoundBadge(); } });
    ui.btnTestTone.addEventListener('click', () => { audio.resume(); audio.testRun(); updateSoundBadge(); });
    function playScore(score, btn) {
        audio.resume();
        try { performer.start(score); } catch (err) { console.error('[performer] 启动失败:', err); }
        ui.scoreList.querySelectorAll('.score-item').forEach(el => el.classList.remove('active'));
        if (btn) btn.classList.add('active');
        ui.nowPlaying.style.display = 'block';
        ui.nowPlaying.textContent = `正在演奏：《${score.title}》 — ${score.composer || '佚名'}`;
        ui.scorePanel.style.display = 'none';
    }
    function addScoreItem(score) {
        const btn = document.createElement('button');
        btn.className = 'score-item';
        btn.innerHTML = `<span class="sc-title"></span><span class="sc-composer"></span>`;
        btn.querySelector('.sc-title').textContent = score.title;
        btn.querySelector('.sc-composer').textContent = score.composer || '佚名';
        btn.addEventListener('click', () => playScore(score, btn));
        ui.scoreList.appendChild(btn);
        return btn;
    }
    function buildScorePanel() { ui.scoreList.innerHTML = ''; for (const s of getScores()) addScoreItem(s); }
    async function loadFolderMidis() {
        let list;
        try { list = await (await fetch('./midi/list.json')).json(); }
        catch (err) { console.error('[midi] 获取曲目列表失败', err); return; }
        const scores = await Promise.all(list.map(async (item) => {
            try { const buf = await (await fetch(item.url)).arrayBuffer(); return parseMidiFile(buf, item.name); }
            catch (err) { console.error('[midi] 解析失败', item.name, err); return null; }
        }));
        for (const score of scores) if (score) addScoreItem(score);
    }
    function handleMidiFile(file) {
        if (!file) return;
        const title = file.name.replace(/\.(mid|midi)$/i, '');
        const reader = new FileReader();
        reader.onload = () => {
            let score;
            try { score = parseMidiFile(reader.result, title); }
            catch (err) { console.error('[midi] 解析失败', err); alert('解析 MIDI 失败：' + err.message); return; }
            const btn = addScoreItem(score);
            playScore(score, btn);
        };
        reader.onerror = () => alert('读取文件失败，请重试');
        reader.readAsArrayBuffer(file);
    }
    ui.midiUpload.addEventListener('change', (ev) => { handleMidiFile(ev.target.files[0]); ev.target.value = ''; });
    function openScores() { ui.scorePanel.style.display = 'flex'; }
    function closeScores() { ui.scorePanel.style.display = 'none'; }
    ui.btnScores.addEventListener('click', openScores);
    ui.btnCloseScores.addEventListener('click', closeScores);
    buildScorePanel();
    loadFolderMidis();
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        composer.setSize(window.innerWidth, window.innerHeight);
    });
    let fpsFrames = 0, fpsLast = performance.now();
    function animate() {
        requestAnimationFrame(animate);
        const dt = Math.min(app.clock.getDelta(), 0.1);
        const t = app.clock.getElapsedTime();
        fpsFrames++;
        const now = performance.now();
        if (now - fpsLast >= 1000) {
            const fps = Math.round(fpsFrames * 1000 / (now - fpsLast));
            ui.setFps(fps + ' FPS');
            ui.fpsBadge.textContent = fps + ' FPS';
            fpsFrames = 0; fpsLast = now;
            updateSoundBadge();
        }
        cinematicPass.uniforms.uTime.value = t;
        if (app.pianoSpot) app.pianoSpot.intensity = (app.pianoSpotBase ?? 2.4) + Math.sin(t * 0.5) * 0.06;
        world.updateConcert(dt);
        audio.update(camera);
        player.updateFP(dt);
        piano.update();
        try { performer.update(dt); } catch (err) { console.error('[performer update]', err); }
        if (app.violin) {
            app.violin.update(dt);
            const baseY = app.violin.root.userData.baseY ?? app.violin.root.position.y;
            app.violin.root.position.y = baseY + Math.sin(t * 0.9) * 0.06;
        }
        if (app.violinBow && app.violin && app.violin._ready) { app.violinBow.update(dt, app.violin.getBowMount()); }
        if (controls.enabled) controls.update();
        composer.render();
    }
    ui.hideLoading();
    animate();
    openScores();
}
init();