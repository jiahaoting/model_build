import * as THREE from 'three';
import { ROOM_H, WALL_T, DOOR_W, DOOR_H, ROOMS, EXHIBITS, LAYOUT } from './config.js';
import { createTextTexture } from './textures.js';

// ============================================================
// 🏛 世界构建（房间 / 门 / 灯光 / 钢琴 / 舞台 / 展品 / 装饰 / 粒子）
// ============================================================
export function createWorld(app) {
    const { scene } = app;
    const colliders = app.colliders;
    const doors = app.doors;
    const videoScreens = app.videoScreens;
    const equalizerBars = app.equalizerBars;
    const dustSystems = app.dustSystems;
    const { marble: marbleTextures, wall: wallTextures } = app.textures;

    // ============================================================
    // 🧱 碰撞系统
    // ============================================================
    function addColliderFromMesh(id, mesh, pad = 0) {
        const box = new THREE.Box3().setFromObject(mesh);
        if (pad > 0) { box.min.x -= pad; box.max.x += pad; box.min.z -= pad; box.max.z += pad; }
        colliders.push({ id, box, enabled: true });
    }
    function addColliderBox(id, minX, maxX, minZ, maxZ) {
        colliders.push({ id, box: new THREE.Box3(
            new THREE.Vector3(minX, 0, minZ), new THREE.Vector3(maxX, ROOM_H, maxZ)
        ), enabled: true });
    }

    // ============================================================
    // 🎨 共享材质
    // ============================================================
    const marbleColorClone = marbleTextures.colorTex.clone();
    const marbleBumpClone = marbleTextures.bumpTex.clone();
    marbleColorClone.repeat.set(4, 4); marbleColorClone.needsUpdate = true;
    marbleBumpClone.repeat.set(4, 4); marbleBumpClone.needsUpdate = true;
    const floorMat = new THREE.MeshPhysicalMaterial({
        map: marbleColorClone,
        bumpMap: marbleBumpClone,
        bumpScale: 0.015,
        roughness: 0.15, metalness: 0.15,
        clearcoat: 0.6, clearcoatRoughness: 0.2,
        envMapIntensity: 0.8
    });
    const wallColorClone = wallTextures.colorTex.clone();
    const wallBumpClone = wallTextures.bumpTex.clone();
    wallColorClone.repeat.set(2, 1); wallColorClone.needsUpdate = true;
    wallBumpClone.repeat.set(2, 1); wallBumpClone.needsUpdate = true;
    const wallMat = new THREE.MeshStandardMaterial({
        map: wallColorClone,
        bumpMap: wallBumpClone,
        bumpScale: 0.02,
        color: 0x0f1120,
        roughness: 0.92, metalness: 0.03,
        envMapIntensity: 0.3
    });
    const ceilMat = new THREE.MeshStandardMaterial({
        color: 0x080810, roughness: 0.95, metalness: 0.02
    });

    // ============================================================
    // 🚪 自动门系统
    // ============================================================
    function buildDoor(room, side) {
        const zPos = side === 'south' ? room.cz + room.d / 2 : room.cz - room.d / 2;
        const sign = side === 'north' ? 1 : -1;
        const panelW = DOOR_W / 2;
        const doorMat = new THREE.MeshPhysicalMaterial({
            color: 0x14141e, roughness: 0.15, metalness: 0.85,
            emissive: 0x0a0a18, emissiveIntensity: 0.08,
            clearcoat: 0.8, clearcoatRoughness: 0.1,
            envMapIntensity: 1.2, reflectivity: 0.4
        });
        const glassMat = new THREE.MeshPhysicalMaterial({
            color: 0x6688aa, roughness: 0.02, metalness: 0,
            transmission: 0.92, transparent: true, opacity: 0.25,
            ior: 1.52, envMapIntensity: 2.0,
            clearcoat: 1.0, clearcoatRoughness: 0.0
        });
        const handleMat = new THREE.MeshStandardMaterial({
            color: 0xccccdd, roughness: 0.1, metalness: 0.95,
            emissive: 0x444466, emissiveIntensity: 0.1
        });

        function makePanel(hingeX, panelOffset) {
            const pivot = new THREE.Group();
            pivot.position.set(hingeX, 0, zPos);
            const panel = new THREE.Mesh(new THREE.BoxGeometry(panelW, DOOR_H, 0.08), doorMat);
            panel.position.set(panelOffset, DOOR_H / 2, 0);
            panel.castShadow = true;
            pivot.add(panel);
            const glass = new THREE.Mesh(
                new THREE.BoxGeometry(panelW * 0.6, DOOR_H * 0.45, 0.04), glassMat
            );
            glass.position.set(panelOffset, DOOR_H * 0.55, 0.05);
            pivot.add(glass);
            const handle = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 16), handleMat);
            handle.position.set(panelOffset + (panelOffset > 0 ? -0.15 : 0.15), DOOR_H * 0.5, 0.1);
            pivot.add(handle);
            const handleBar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.22, 8), handleMat);
            handleBar.rotation.z = Math.PI / 2;
            handleBar.position.copy(handle.position); handleBar.position.z = 0.08;
            pivot.add(handleBar);
            scene.add(pivot);
            return pivot;
        }

        const leftPivot = makePanel(-DOOR_W / 2, panelW / 2);
        const rightPivot = makePanel(DOOR_W / 2, -panelW / 2);

        const header = new THREE.Mesh(
            new THREE.BoxGeometry(DOOR_W + 0.4, ROOM_H - DOOR_H, WALL_T), wallMat
        );
        header.position.set(0, DOOR_H + (ROOM_H - DOOR_H) / 2, zPos);
        scene.add(header);

        // 门框
        const frameMat = new THREE.MeshStandardMaterial({ color: 0x3a3a55, roughness: 0.25, metalness: 0.85 });
        const frameTop = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W + 0.3, 0.1, 0.25), frameMat);
        frameTop.position.set(0, DOOR_H, zPos); scene.add(frameTop);
        const frameLeft = new THREE.Mesh(new THREE.BoxGeometry(0.1, DOOR_H, 0.25), frameMat);
        frameLeft.position.set(-DOOR_W / 2 - 0.05, DOOR_H / 2, zPos); scene.add(frameLeft);
        const frameRight = frameLeft.clone(); frameRight.position.x = DOOR_W / 2 + 0.05; scene.add(frameRight);

        // 指示牌
        const nextRoomName = side === 'north'
            ? ROOMS[ROOMS.indexOf(room) + 1]?.name
            : ROOMS[ROOMS.indexOf(room) - 1]?.name;
        if (nextRoomName) {
            const signTex = createTextTexture('→ ' + nextRoomName, null, '#a5b4fc');
            const sign = new THREE.Mesh(
                new THREE.PlaneGeometry(2.5, 0.6),
                new THREE.MeshBasicMaterial({ map: signTex, transparent: true })
            );
            sign.position.set(0, DOOR_H + 0.8, zPos + (side === 'north' ? -0.15 : 0.15));
            if (side === 'north') sign.rotation.y = Math.PI;
            scene.add(sign);
        }

        const doorCollider = {
            id: `door_${room.id}_${side}`,
            box: new THREE.Box3(
                new THREE.Vector3(-DOOR_W / 2, 0, zPos - 0.3),
                new THREE.Vector3(DOOR_W / 2, DOOR_H, zPos + 0.3)
            ),
            enabled: true
        };
        colliders.push(doorCollider);
        doors.push({ leftPivot, rightPivot, zPos, sign, openAmount: 0,
            collider: doorCollider, triggerDist: 4.0 });
    }

    function updateDoors(dt) {
        const px = app.fp.pos.x, pz = app.fp.pos.z;
        for (const door of doors) {
            const dist = Math.hypot(px, pz - door.zPos);
            const target = dist < door.triggerDist ? 1 : 0;
            door.openAmount += (target - door.openAmount) * Math.min(1, dt * 4);
            door.leftPivot.rotation.y  =  door.sign * (Math.PI / 2) * door.openAmount;
            door.rightPivot.rotation.y = -door.sign * (Math.PI / 2) * door.openAmount;
            door.collider.enabled = door.openAmount < 0.5;
        }
    }

    // ============================================================
    // 🏠 房间构建
    // ============================================================
    const builtWallKeys = new Set();

    function buildRoom(room) {
        const { cx, cz, w, d } = room;
        const x0 = cx - w / 2, x1 = cx + w / 2;
        const z0 = cz - d / 2, z1 = cz + d / 2;
        const doorHalf = DOOR_W / 2;

        const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorMat);
        floor.rotation.x = -Math.PI / 2; floor.position.set(cx, 0, cz);
        floor.receiveShadow = true; scene.add(floor);

        const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), ceilMat);
        ceil.rotation.x = Math.PI / 2; ceil.position.set(cx, ROOM_H, cz);
        scene.add(ceil);

        // 天花板横梁
        for (let bx = cx - w/2 + 3; bx < cx + w/2; bx += 4.5) {
            const beam = new THREE.Mesh(
                new THREE.BoxGeometry(0.15, 0.12, d),
                new THREE.MeshStandardMaterial({ color: 0x080812, roughness: 0.8 })
            );
            beam.position.set(bx, ROOM_H - 0.06, cz); scene.add(beam);
        }

        const baseboardMat = new THREE.MeshStandardMaterial({ color: 0x080812, roughness: 0.6, metalness: 0.3 });

        function wallX(zPos, xStart, xEnd) {
            const len = xEnd - xStart;
            if (len < 0.05) return;
            const key = `X_${zPos.toFixed(2)}_${xStart.toFixed(2)}_${xEnd.toFixed(2)}`;
            if (builtWallKeys.has(key)) return;
            builtWallKeys.add(key);
            const mid = (xStart + xEnd) / 2;
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, ROOM_H, WALL_T), wallMat);
            mesh.position.set(mid, ROOM_H / 2, zPos); mesh.receiveShadow = true; scene.add(mesh);
            const bb = new THREE.Mesh(new THREE.BoxGeometry(len, 0.15, 0.05), baseboardMat);
            bb.position.set(mid, 0.08, zPos + (zPos > cz ? 0.12 : -0.12)); scene.add(bb);
            addColliderBox('wall', mid - len/2 - 0.3, mid + len/2 + 0.3, zPos - 0.3, zPos + 0.3);
        }
        function wallZ(xPos, zStart, zEnd) {
            const len = zEnd - zStart;
            if (len < 0.05) return;
            const key = `Z_${xPos.toFixed(2)}_${zStart.toFixed(2)}_${zEnd.toFixed(2)}`;
            if (builtWallKeys.has(key)) return;
            builtWallKeys.add(key);
            const mid = (zStart + zEnd) / 2;
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(WALL_T, ROOM_H, len), wallMat);
            mesh.position.set(xPos, ROOM_H / 2, mid); mesh.receiveShadow = true; scene.add(mesh);
            const bb = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.15, len), baseboardMat);
            bb.position.set(xPos + (xPos > cx ? 0.12 : -0.12), 0.08, mid); scene.add(bb);
            addColliderBox('wall', xPos - 0.3, xPos + 0.3, mid - len/2 - 0.3, mid + len/2 + 0.3);
        }

        if (room.doors.south) { wallX(z1, x0, -doorHalf); wallX(z1, doorHalf, x1); buildDoor(room, 'south'); }
        else { wallX(z1, x0, x1); }
        if (room.doors.north) { wallX(z0, x0, -doorHalf); wallX(z0, doorHalf, x1); buildDoor(room, 'north'); }
        else { wallX(z0, x0, x1); }
        wallZ(x1, z0, z1); wallZ(x0, z0, z1);

        // 房间名牌
        const accentHex = '#' + room.accent.toString(16).padStart(6, '0');
        const nameTex = createTextTexture(room.name, 'Music Gallery', accentHex);
        const plaque = new THREE.Mesh(
            new THREE.PlaneGeometry(3.5, 0.9),
            new THREE.MeshBasicMaterial({ map: nameTex, transparent: true })
        );
        if (room.id === 'entrance') {
            plaque.position.set(x1 - 0.12, ROOM_H - 1.5, cz); plaque.rotation.y = -Math.PI / 2;
        } else {
            plaque.position.set(x0 + 0.12, ROOM_H - 1.5, cz); plaque.rotation.y = Math.PI / 2;
        }
        scene.add(plaque);

        // 房间氛围色光
        const moodLight = new THREE.PointLight(room.accent, 1.0, 16, 2);
        moodLight.position.set(cx, ROOM_H - 1.5, cz); scene.add(moodLight);
    }

    // ============================================================
    // 💡 电影级灯光系统
    // ============================================================
    function createCeilingLight(x, z, intensity = 1.4) {
        const rectLight = new THREE.RectAreaLight(0xe8eefc, intensity, 3.2, 3.2);
        rectLight.position.set(x, ROOM_H - 0.1, z); rectLight.rotation.x = Math.PI / 2;
        scene.add(rectLight);
        const fixtureMat = new THREE.MeshPhysicalMaterial({
            color: 0x0c0c14, roughness: 0.4, metalness: 0.8, clearcoat: 0.3
        });
        const fixture = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.12, 3.6), fixtureMat);
        fixture.position.set(x, ROOM_H - 0.04, z); fixture.receiveShadow = true; scene.add(fixture);
        const lamp = new THREE.Mesh(
            new THREE.PlaneGeometry(3.2, 3.2),
            new THREE.MeshBasicMaterial({ color: 0xe8eefc })
        );
        lamp.position.set(x, ROOM_H - 0.09, z); lamp.rotation.x = -Math.PI / 2; scene.add(lamp);
        const frameMat = new THREE.MeshPhysicalMaterial({
            color: 0x1a1a24, roughness: 0.2, metalness: 0.9, clearcoat: 0.5
        });
        for (const [dx, dz] of [[0,-1.6],[0,1.6]]) {
            const f = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.04, 0.06), frameMat);
            f.position.set(x, ROOM_H - 0.07, z + dz); scene.add(f);
        }
        for (const [dx, dz] of [[-1.6,0],[1.6,0]]) {
            const f = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 3.4), frameMat);
            f.position.set(x + dx, ROOM_H - 0.07, z); scene.add(f);
        }
    }

    function createWallSconce(x, z, facingY) {
        const g = new THREE.Group();
        const base = new THREE.Mesh(
            new THREE.CylinderGeometry(0.08, 0.12, 0.15, 8),
            new THREE.MeshStandardMaterial({ color: 0x2a2a3e, roughness: 0.3, metalness: 0.8 })
        );
        base.rotation.x = Math.PI / 2; base.position.z = 0.06; g.add(base);
        const shade = new THREE.Mesh(
            new THREE.SphereGeometry(0.18, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
            new THREE.MeshStandardMaterial({
                color: 0xfff0d0, emissive: 0x88aacc, emissiveIntensity: 0.8,
                roughness: 0.2, transparent: true, opacity: 0.85
            })
        );
        shade.position.set(0, 0.18, 0.14); shade.rotation.x = -Math.PI / 6; g.add(shade);
        const light = new THREE.PointLight(0x88aacc, 0.4, 6, 2);
        light.position.set(0, 0.18, 0.18); g.add(light);
        g.position.set(x, 3.2, z); g.rotation.y = facingY; scene.add(g);
    }

    function createFootLight(x, z, facingY, color = 0x4a6a8a) {
        const stripLight = new THREE.PointLight(color, 0.3, 3, 2);
        stripLight.position.set(x, 0.3, z); scene.add(stripLight);
        const strip = new THREE.Mesh(
            new THREE.BoxGeometry(0.8, 0.04, 0.04),
            new THREE.MeshBasicMaterial({ color })
        );
        strip.position.set(x, 0.12, z);
        strip.rotation.y = facingY;
        scene.add(strip);
    }

    // ============================================================
    // 🎹 三角钢琴模型
    // ============================================================
    function createGrandPiano(x, z, rotY = 0) {
        const g = new THREE.Group();

        const lacquerMat = new THREE.MeshPhysicalMaterial({
            color: 0x030303, roughness: 0.05, metalness: 0.3,
            clearcoat: 1.0, clearcoatRoughness: 0.02,
            envMapIntensity: 2.5, reflectivity: 0.5
        });
        const goldMat = new THREE.MeshStandardMaterial({
            color: 0xc8a84e, roughness: 0.15, metalness: 0.95,
            envMapIntensity: 1.5
        });
        const goldDarkMat = new THREE.MeshStandardMaterial({
            color: 0x8a7028, roughness: 0.3, metalness: 0.9
        });
        const feltMat = new THREE.MeshStandardMaterial({
            color: 0x0a0a12, roughness: 0.95
        });
        const keyWhiteMat = new THREE.MeshPhysicalMaterial({
            color: 0xf0ede5, roughness: 0.25, metalness: 0.0,
            clearcoat: 0.4, clearcoatRoughness: 0.3
        });
        const keyBlackMat = new THREE.MeshStandardMaterial({
            color: 0x080808, roughness: 0.2, metalness: 0.3
        });
        const woodInnerMat = new THREE.MeshStandardMaterial({
            color: 0x1a0e08, roughness: 0.6, metalness: 0.1
        });
        const stringMat = new THREE.MeshStandardMaterial({
            color: 0xddccaa, roughness: 0.3, metalness: 0.8
        });

        // === Piano body shape (grand piano wing shape) ===
        const shape = new THREE.Shape();
        shape.moveTo(-1.6, 0);
        shape.lineTo(1.6, 0);
        shape.lineTo(1.6, -0.8);
        shape.bezierCurveTo(1.6, -2.0, 0.9, -2.5, 0, -2.5);
        shape.bezierCurveTo(-0.9, -2.5, -1.6, -2.0, -1.6, -0.8);
        shape.lineTo(-1.6, 0);

        const extrudeSettings = {
            depth: 0.28, bevelEnabled: true,
            bevelThickness: 0.03, bevelSize: 0.03,
            bevelSegments: 4, curveSegments: 64
        };
        const body = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, extrudeSettings), lacquerMat);
        body.position.y = 0.72;
        body.castShadow = true;
        body.receiveShadow = true;
        g.add(body);

        // === Inner rim ===
        const innerShape = new THREE.Shape();
        innerShape.moveTo(-1.5, -0.05);
        innerShape.lineTo(1.5, -0.05);
        innerShape.lineTo(1.5, -0.75);
        innerShape.bezierCurveTo(1.5, -1.9, 0.85, -2.35, 0, -2.35);
        innerShape.bezierCurveTo(-0.85, -2.35, -1.5, -1.9, -1.5, -0.75);
        innerShape.lineTo(-1.5, -0.05);
        const innerRim = new THREE.Mesh(
            new THREE.ExtrudeGeometry(innerShape, { depth: 0.2, bevelEnabled: false, curveSegments: 48 }),
            woodInnerMat
        );
        innerRim.position.y = 0.76;
        innerRim.castShadow = true;
        g.add(innerRim);

        // === Soundboard ===
        const sbShape = new THREE.Shape();
        sbShape.moveTo(-1.3, -0.1);
        sbShape.lineTo(1.3, -0.1);
        sbShape.lineTo(1.3, -0.7);
        sbShape.bezierCurveTo(1.3, -1.7, 0.7, -2.1, 0, -2.1);
        sbShape.bezierCurveTo(-0.7, -2.1, -1.3, -1.7, -1.3, -0.7);
        sbShape.lineTo(-1.3, -0.1);
        const soundboard = new THREE.Mesh(
            new THREE.ExtrudeGeometry(sbShape, { depth: 0.02, bevelEnabled: false, curveSegments: 40 }),
            new THREE.MeshStandardMaterial({ color: 0x2a1a0a, roughness: 0.7 })
        );
        soundboard.position.y = 0.78;
        soundboard.receiveShadow = true;
        g.add(soundboard);

        // === Strings ===
        for (let i = 0; i < 20; i++) {
            const stringGeo = new THREE.CylinderGeometry(0.004, 0.004, 1.2 + i * 0.04, 4);
            const string = new THREE.Mesh(stringGeo, stringMat);
            string.rotation.z = Math.PI / 2;
            string.position.set(0, 0.82, -0.3 - i * 0.08);
            g.add(string);
        }

        // === Dampers ===
        for (let i = 0; i < 15; i++) {
            const damper = new THREE.Mesh(
                new THREE.BoxGeometry(0.04, 0.04, 0.04),
                goldDarkMat
            );
            damper.position.set(-0.6 + i * 0.08, 0.86, -0.5 - i * 0.08);
            g.add(damper);
        }

        // === Lid (open at ~40° angle) ===
        const lid = new THREE.Mesh(
            new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2, curveSegments: 64 }),
            lacquerMat
        );
        lid.position.set(0, 1.0, 0);
        lid.rotation.x = -Math.PI / 2 + 0.7;
        lid.castShadow = true;
        lid.name = 'pianoLid';
        g.add(lid);

        const lidInner = new THREE.Mesh(
            new THREE.ExtrudeGeometry(shape, { depth: 0.01, bevelEnabled: false, curveSegments: 48 }),
            new THREE.MeshStandardMaterial({ color: 0x4a3a1a, roughness: 0.4, side: THREE.DoubleSide })
        );
        lidInner.position.set(0, 0.999, 0);
        lidInner.rotation.x = -Math.PI / 2 + 0.7;
        g.add(lidInner);

        // === Lid support stick ===
        const supportStick = new THREE.Mesh(
            new THREE.CylinderGeometry(0.025, 0.03, 0.55, 8),
            goldMat
        );
        supportStick.position.set(1.2, 0.95, -0.4);
        supportStick.rotation.z = -0.3;
        g.add(supportStick);

        // === Keyboard base ===
        const kbBase = new THREE.Mesh(
            new THREE.BoxGeometry(3.0, 0.12, 0.65),
            lacquerMat
        );
        kbBase.position.set(0, 0.68, 0.15);
        kbBase.castShadow = true;
        g.add(kbBase);

        // === White keys (52 keys) ===
        const numWhite = 52;
        const whiteKeyW = 2.9 / numWhite;
        for (let i = 0; i < numWhite; i++) {
            const key = new THREE.Mesh(
                new THREE.BoxGeometry(whiteKeyW * 0.92, 0.03, 0.5),
                keyWhiteMat
            );
            key.position.set(-1.45 + i * whiteKeyW + whiteKeyW / 2, 0.745, 0.15);
            key.castShadow = true;
            key.receiveShadow = true;
            g.add(key);
        }

        // === Black keys ===
        const blackKeyPositions = [1, 3, 6, 8, 10];
        for (let octave = 0; octave < 7; octave++) {
            for (const pos of blackKeyPositions) {
                const keyIdx = octave * 12 + pos;
                if (keyIdx >= numWhite) break;
                const blackKey = new THREE.Mesh(
                    new THREE.BoxGeometry(whiteKeyW * 0.55, 0.04, 0.3),
                    keyBlackMat
                );
                blackKey.position.set(
                    -1.45 + keyIdx * whiteKeyW + whiteKeyW * 0.7,
                    0.765,
                    0.05
                );
                blackKey.castShadow = true;
                g.add(blackKey);
            }
        }

        // === Red felt strip ===
        const feltStrip = new THREE.Mesh(
            new THREE.BoxGeometry(2.9, 0.02, 0.08),
            feltMat
        );
        feltStrip.position.set(0, 0.755, -0.12);
        g.add(feltStrip);

        // === Gold decorative trim ===
        const trimPoints = [];
        const segs = 80;
        for (let i = 0; i <= segs; i++) {
            const t = i / segs;
            let px, pz;
            if (t < 0.25) {
                px = -1.6 + (t / 0.25) * 3.2;
                pz = 0;
            } else if (t < 0.35) {
                px = 1.6;
                pz = -(t - 0.25) / 0.1 * 0.8;
            } else if (t < 0.675) {
                const tt = (t - 0.35) / 0.325;
                px = 1.6 - tt * 1.6;
                pz = -0.8 - tt * 1.7;
            } else if (t < 0.925) {
                const tt = (t - 0.675) / 0.25;
                px = 0 - tt * 1.6;
                pz = -2.5 + tt * 1.7;
            } else {
                const tt = (t - 0.925) / 0.075;
                px = -1.6;
                pz = -0.8 + tt * 0.8;
            }
            trimPoints.push(new THREE.Vector3(px, 1.0, pz));
        }
        const trimCurve = new THREE.CatmullRomCurve3(trimPoints, true);
        const trimGeo = new THREE.TubeGeometry(trimCurve, 200, 0.015, 6, true);
        const trim = new THREE.Mesh(trimGeo, goldMat);
        g.add(trim);

        // === Brand name decal ===
        const brandCanvas = document.createElement('canvas');
        brandCanvas.width = 512; brandCanvas.height = 64;
        const bctx = brandCanvas.getContext('2d');
        bctx.fillStyle = '#0a0a0a';
        bctx.fillRect(0, 0, 512, 64);
        bctx.font = 'bold 28px Georgia, serif';
        bctx.textAlign = 'center';
        bctx.textBaseline = 'middle';
        bctx.fillStyle = '#c8a84e';
        bctx.fillText('STEINWAY & SONS', 256, 32);
        const brandTex = new THREE.CanvasTexture(brandCanvas);
        const brandDecal = new THREE.Mesh(
            new THREE.PlaneGeometry(1.8, 0.12),
            new THREE.MeshStandardMaterial({ map: brandTex, roughness: 0.4, metalness: 0.3 })
        );
        brandDecal.position.set(0, 0.74, 0.485);
        brandDecal.rotation.y = Math.PI;
        g.add(brandDecal);

        // === Music rest (谱架) ===
        const musicRest = new THREE.Mesh(
            new THREE.BoxGeometry(2.0, 0.7, 0.025),
            lacquerMat
        );
        musicRest.position.set(0, 1.15, -0.35);
        musicRest.castShadow = true;
        g.add(musicRest);

        // Sheet music texture
        const sheetCanvas = document.createElement('canvas');
        sheetCanvas.width = 512; sheetCanvas.height = 256;
        const sctx = sheetCanvas.getContext('2d');
        sctx.fillStyle = '#f5f0e0';
        sctx.fillRect(0, 0, 512, 256);
        sctx.strokeStyle = '#333';
        sctx.lineWidth = 1;
        for (let i = 0; i < 5; i++) {
            sctx.beginPath();
            sctx.moveTo(20, 40 + i * 12);
            sctx.lineTo(492, 40 + i * 12);
            sctx.stroke();
        }
        for (let i = 0; i < 8; i++) {
            sctx.beginPath();
            sctx.moveTo(60 + i * 55, 20);
            sctx.lineTo(60 + i * 55, 236);
            sctx.stroke();
        }
        sctx.fillStyle = '#111';
        sctx.font = '10px serif';
        for (let i = 0; i < 40; i++) {
            sctx.beginPath();
            sctx.arc(70 + (i % 8) * 55, 60 + Math.floor(i / 8) * 50, 3, 0, Math.PI * 2);
            sctx.fill();
        }
        const sheetTex = new THREE.CanvasTexture(sheetCanvas);
        const sheetMusic = new THREE.Mesh(
            new THREE.PlaneGeometry(1.8, 0.6),
            new THREE.MeshStandardMaterial({ map: sheetTex, roughness: 0.8 })
        );
        sheetMusic.position.set(0, 1.16, -0.335);
        g.add(sheetMusic);

        // === Legs (3 legs, tapered) ===
        const legPositions = [[-1.35, -0.2], [1.35, -0.2], [0, -2.2]];
        for (const [lx, lz] of legPositions) {
            const leg = new THREE.Mesh(
                new THREE.CylinderGeometry(0.06, 0.09, 0.72, 16),
                lacquerMat
            );
            leg.position.set(lx, 0.36, lz);
            leg.castShadow = true;
            g.add(leg);

            const ferrule = new THREE.Mesh(
                new THREE.CylinderGeometry(0.095, 0.08, 0.04, 16),
                goldMat
            );
            ferrule.position.set(lx, 0.02, lz);
            g.add(ferrule);

            const wheel = new THREE.Mesh(
                new THREE.SphereGeometry(0.04, 8, 6),
                goldDarkMat
            );
            wheel.position.set(lx, 0.0, lz);
            g.add(wheel);
        }

        // === Pedal assembly ===
        const pedalBase = new THREE.Mesh(
            new THREE.BoxGeometry(0.4, 0.03, 0.2),
            goldDarkMat
        );
        pedalBase.position.set(0, 0.12, 0.45);
        g.add(pedalBase);

        const lyre = new THREE.Mesh(
            new THREE.ConeGeometry(0.08, 0.35, 8),
            goldMat
        );
        lyre.position.set(0, 0.25, 0.45);
        lyre.rotation.x = Math.PI;
        g.add(lyre);

        for (let i = 0; i < 3; i++) {
            const pedal = new THREE.Mesh(
                new THREE.BoxGeometry(0.08, 0.02, 0.12),
                goldMat
            );
            pedal.position.set(-0.1 + i * 0.1, 0.1, 0.5);
            g.add(pedal);
        }

        // === Key cover ===
        const keyCover = new THREE.Mesh(
            new THREE.BoxGeometry(3.0, 0.04, 0.3),
            lacquerMat
        );
        keyCover.position.set(0, 0.78, -0.28);
        keyCover.castShadow = true;
        g.add(keyCover);

        // === Collisions ===
        addColliderBox('piano', x - 1.8, x + 1.8, z - 2.6, z + 0.5);

        g.position.set(x, 0, z);
        g.rotation.y = rotY;
        scene.add(g);
        return g;
    }

    // ============================================================
    // 🎹 GLB 三角钢琴（真实模型 + PBR + HDRI 环境反射）
    // ============================================================
    function createPianoFromGLB(gltf, x, z, rotY = 0) {
        const g = new THREE.Group();
        const model = gltf.scene || gltf;

        // 归一化尺寸：以最长水平轴（钢琴前后向）适配目标长度
        const rawBox = new THREE.Box3().setFromObject(model);
        const rawSize = rawBox.getSize(new THREE.Vector3());
        const targetLen = 2.6;
        const maxHoriz = Math.max(rawSize.x, rawSize.z);
        const s = maxHoriz > 0 ? targetLen / maxHoriz : 1;
        model.scale.setScalar(s);

        // 朝向校正：模型琴键朝 +X，旋转 -90° 使琴键朝向 +Z 观众
        model.rotation.set(0, rotY - Math.PI / 2, 0);

        // 贴地 + 居中到目标位置（基于缩放/旋转后的包围盒）
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        model.position.set(
            x - center.x,
            -box.min.y,
            z - center.z
        );

        // PBR 材质 & 阴影：按颜色特征将风格化模型调成写实黑钢琴，并接入 HDRI 环境反射
        model.traverse((obj) => {
            if (!obj.isMesh) return;
            obj.castShadow = true;
            obj.receiveShadow = true;
            const mat = obj.material;
            if (!mat || !mat.isMeshStandardMaterial) return;

            const r = mat.color.r, g = mat.color.g, b = mat.color.b;
            if (r > 0.95 && g > 0.95 && b > 0.95) {
                // 白键
                mat.color.setHex(0xf2efe6);
                mat.metalness = 0.0; mat.roughness = 0.25; mat.envMapIntensity = 0.6;
            } else if (r < 0.15 && g < 0.15 && b < 0.15) {
                // 黑键
                mat.metalness = 0.3; mat.roughness = 0.2; mat.envMapIntensity = 0.9;
            } else if (r > 0.95 && g > 0.85 && b < 0.35) {
                // 金色装饰件
                mat.color.setHex(0xc9a24b);
                mat.metalness = 0.95; mat.roughness = 0.25; mat.envMapIntensity = 1.6;
            } else if (Math.abs(r - g) < 0.03 && Math.abs(g - b) < 0.03 && r > 0.4 && r < 0.8) {
                // 灰色金属（踏板）
                mat.metalness = 0.8; mat.roughness = 0.3; mat.envMapIntensity = 1.2;
            } else {
                // 琴体 / 框架 → 黑色钢琴烤漆
                mat.color.setHex(0x0a0a0c);
                mat.metalness = 0.15; mat.roughness = 0.15; mat.envMapIntensity = 1.8;
            }
            mat.needsUpdate = true;
        });

        g.add(model);
        // 碰撞体（与原钢琴一致）
        addColliderBox('piano', x - 1.8, x + 1.8, z - 2.6, z + 0.5);

        scene.add(g);
        return g;
    }

    // 钢琴凳
    function createPianoBench(x, z, rotY = 0) {
        const g = new THREE.Group();
        const mat = new THREE.MeshPhysicalMaterial({
            color: 0x0a0a0a, roughness: 0.2, metalness: 0.3, clearcoat: 0.6
        });
        const seat = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 0.42), mat);
        seat.position.y = 0.5; seat.castShadow = true; seat.receiveShadow = true;
        g.add(seat);
        for (const [lx, lz] of [[-0.55, -0.16], [0.55, -0.16], [-0.55, 0.16], [0.55, 0.16]]) {
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.5, 8), mat);
            leg.position.set(lx, 0.25, lz); leg.castShadow = true;
            g.add(leg);
        }
        g.position.set(x, 0, z); g.rotation.y = rotY;
        scene.add(g);
    }

    // 舞台平台
    function createStage(cx, cz, w, d) {
        const stageMat = new THREE.MeshPhysicalMaterial({
            color: 0x0a0a12, roughness: 0.2, metalness: 0.5,
            clearcoat: 0.5, clearcoatRoughness: 0.15, envMapIntensity: 1.0
        });
        const stage = new THREE.Mesh(new THREE.BoxGeometry(w, 0.15, d), stageMat);
        stage.position.set(cx, 0.075, cz);
        stage.receiveShadow = true; stage.castShadow = true;
        scene.add(stage);
        const edgeMat = new THREE.MeshBasicMaterial({ color: 0x667eea });
        const edges = [
            [w, 0.02, 0.05, 0, 0.16, d/2],
            [w, 0.02, 0.05, 0, 0.16, -d/2],
            [0.05, 0.02, d, w/2, 0.16, 0],
            [0.05, 0.02, d, -w/2, 0.16, 0],
        ];
        for (const [ew, eh, ed, ex, ey, ez] of edges) {
            const edge = new THREE.Mesh(new THREE.BoxGeometry(ew, eh, ed), edgeMat);
            edge.position.set(cx + ex, ey, cz + ez);
            scene.add(edge);
        }
        const stageLight = new THREE.PointLight(0x667eea, 0.6, 6, 2);
        stageLight.position.set(cx, 0.2, cz + d/2);
        scene.add(stageLight);
    }

    // 体积光束
    function createLightBeam(x, y, z, targetZ, color = 0xeef2ff, radius = 1.5) {
        const height = y;
        const geo = new THREE.ConeGeometry(radius, height, 24, 1, true);
        const mat = new THREE.MeshBasicMaterial({
            color, transparent: true, opacity: 0.04,
            blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
        });
        const beam = new THREE.Mesh(geo, mat);
        beam.position.set(x, y / 2, z);
        scene.add(beam);
        return beam;
    }

    // ============================================================
    // 👤 半透明泛光弹钢琴人物（预留作品对接接口）
    // ============================================================
    function createPianist(x, z) {
        const g = new THREE.Group();

        const ghostMat = new THREE.MeshPhysicalMaterial({
            color: 0x4488ff,
            transparent: true,
            opacity: 0.35,
            roughness: 0.2,
            metalness: 0.0,
            emissive: 0x2266cc,
            emissiveIntensity: 0.6,
            transmission: 0.3,
            thickness: 0.5,
            side: THREE.DoubleSide
        });

        const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), ghostMat);
        head.position.set(0, 1.15, 0);
        g.add(head);

        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.08, 8), ghostMat);
        neck.position.set(0, 1.05, 0);
        g.add(neck);

        const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.35, 8, 12), ghostMat);
        torso.position.set(0, 0.78, 0.05);
        torso.rotation.x = 0.15;
        g.add(torso);

        const lUpperArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.2, 6, 8), ghostMat);
        lUpperArm.position.set(-0.18, 0.88, 0.08);
        lUpperArm.rotation.z = 0.3;
        lUpperArm.rotation.x = 0.2;
        g.add(lUpperArm);

        const lForearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.18, 6, 8), ghostMat);
        lForearm.position.set(-0.28, 0.78, 0.15);
        lForearm.rotation.x = 0.5;
        g.add(lForearm);

        const lHand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), ghostMat);
        lHand.position.set(-0.3, 0.72, 0.2);
        g.add(lHand);

        const rUpperArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.2, 6, 8), ghostMat);
        rUpperArm.position.set(0.18, 0.88, 0.08);
        rUpperArm.rotation.z = -0.3;
        rUpperArm.rotation.x = 0.2;
        g.add(rUpperArm);

        const rForearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.18, 6, 8), ghostMat);
        rForearm.position.set(0.28, 0.78, 0.15);
        rForearm.rotation.x = 0.5;
        g.add(rForearm);

        const rHand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), ghostMat);
        rHand.position.set(0.3, 0.72, 0.2);
        g.add(rHand);

        const lLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.3, 6, 8), ghostMat);
        lLeg.position.set(-0.1, 0.35, 0.05);
        lLeg.rotation.x = -0.3;
        g.add(lLeg);

        const rLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.3, 6, 8), ghostMat);
        rLeg.position.set(0.1, 0.35, 0.05);
        rLeg.rotation.x = -0.3;
        g.add(rLeg);

        const lFoot = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), ghostMat);
        lFoot.position.set(-0.1, 0.15, 0.18);
        g.add(lFoot);

        const rFoot = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), ghostMat);
        rFoot.position.set(0.1, 0.15, 0.18);
        g.add(rFoot);

        const glowMat = new THREE.MeshBasicMaterial({
            color: 0x4488ff,
            transparent: true,
            opacity: 0.08,
            side: THREE.BackSide
        });
        const glowShell = new THREE.Mesh(new THREE.SphereGeometry(0.8, 16, 12), glowMat);
        glowShell.position.set(0, 0.65, 0.05);
        glowShell.scale.set(0.8, 1.4, 0.8);
        g.add(glowShell);

        const figureLight = new THREE.PointLight(0x4488ff, 0.8, 4, 2);
        figureLight.position.set(0, 0.9, 0.1);
        g.add(figureLight);

        g.position.set(x, 0, z);
        g.name = 'pianistFigure';
        return g;
    }

    // ============================================================
    // 🎵 音乐均衡器可视化
    // ============================================================
    function createEqualizer(x, y, z, rotY) {
        const g = new THREE.Group();
        const numBars = 32;
        const barW = 0.12, barGap = 0.06;
        const totalW = numBars * (barW + barGap);
        const startX = -totalW / 2;
        for (let i = 0; i < numBars; i++) {
            const hue = i / numBars;
            const color = new THREE.Color().setHSL(0.55 + hue * 0.3, 0.8, 0.5);
            const bar = new THREE.Mesh(
                new THREE.BoxGeometry(barW, 1, 0.1),
                new THREE.MeshStandardMaterial({
                    color, emissive: color, emissiveIntensity: 0.8,
                    roughness: 0.3, metalness: 0.5
                })
            );
            bar.position.set(startX + i * (barW + barGap), 0, 0);
            bar.userData.baseFreq = 0.5 + (i / numBars) * 3.0;
            bar.userData.phase = i * 0.3;
            g.add(bar);
            equalizerBars.push(bar);
        }
        const back = new THREE.Mesh(
            new THREE.BoxGeometry(totalW + 0.3, 3.5, 0.05),
            new THREE.MeshStandardMaterial({ color: 0x0a0a14, roughness: 0.8 })
        );
        back.position.set(0, 1.2, -0.06);
        g.add(back);
        g.position.set(x, y, z);
        g.rotation.y = rotY;
        scene.add(g);
    }

    // ============================================================
    // 🖼️ 视频展示屏幕
    // ============================================================
    function createVideoScreen(exhibit, position, rotationY) {
        const group = new THREE.Group();
        const frameSize = { w: 5.0, h: 3.0, d: 0.15 };
        const frame = new THREE.Mesh(
            new THREE.BoxGeometry(frameSize.w, frameSize.h, frameSize.d),
            new THREE.MeshPhysicalMaterial({ color: 0x0a0a12, roughness: 0.15, metalness: 0.9, clearcoat: 0.7, clearcoatRoughness: 0.1, envMapIntensity: 1.2 })
        );
        frame.castShadow = true; group.add(frame);
        const screenSize = { w: frameSize.w - 0.3, h: frameSize.h - 0.3 };

        function makePosterTexture(title) {
            const pc = document.createElement('canvas');
            pc.width = 1024; pc.height = 600;
            const pctx = pc.getContext('2d');
            const bg = pctx.createLinearGradient(0, 0, 0, 600);
            bg.addColorStop(0, '#0a0a18'); bg.addColorStop(1, '#151528');
            pctx.fillStyle = bg; pctx.fillRect(0, 0, 1024, 600);
            for (let i = 0; i < 12; i++) {
                const bh = 20 + Math.random() * 200;
                pctx.fillStyle = `rgba(${80+Math.random()*80},${120+Math.random()*100},${200+Math.random()*55},${0.3+Math.random()*0.4})`;
                pctx.fillRect(60 + i * 75, 600 - bh, 50, bh);
            }
            pctx.fillStyle = 'rgba(255,255,255,0.85)';
            pctx.font = 'bold 48px "PingFang SC", "Microsoft YaHei", sans-serif';
            pctx.textAlign = 'center'; pctx.textBaseline = 'middle';
            pctx.fillText(title, 512, 200);
            pctx.fillStyle = 'rgba(180,200,255,0.6)';
            pctx.font = '24px "PingFang SC", sans-serif';
            pctx.fillText('▶  准备就绪 · 点击播放本地视频', 512, 320);
            const tex = new THREE.CanvasTexture(pc);
            tex.colorSpace = THREE.SRGBColorSpace;
            return tex;
        }
        const posterTexture = makePosterTexture(exhibit.title);
        let finalTexture = posterTexture;
        let videoEl = null;
        try {
            videoEl = document.createElement('video');
            videoEl.src = exhibit.video;
            videoEl.crossOrigin = 'anonymous';
            videoEl.loop = true; videoEl.muted = true; videoEl.playsInline = true; videoEl.preload = 'metadata';
            const timeoutTimer = setTimeout(() => { try { videoEl.pause(); } catch(e) {} }, 8000);
            videoEl.addEventListener('loadeddata', () => {
                clearTimeout(timeoutTimer);
                const vt = new THREE.VideoTexture(videoEl);
                vt.colorSpace = THREE.SRGBColorSpace;
                screen.material.map = vt;
                screen.material.needsUpdate = true;
                finalTexture = vt;
            });
            videoEl.addEventListener('error', () => {
                clearTimeout(timeoutTimer);
            });
        } catch (e) {
            videoEl = null;
        }
        const screen = new THREE.Mesh(
            new THREE.PlaneGeometry(screenSize.w, screenSize.h),
            new THREE.MeshBasicMaterial({ map: finalTexture, side: THREE.DoubleSide })
        );
        screen.position.z = frameSize.d / 2 + 0.001; group.add(screen);
        const screenLight = new THREE.RectAreaLight(0xffffff, 0, screenSize.w, screenSize.h);
        screenLight.position.z = frameSize.d / 2 + 0.01; group.add(screenLight);

        // 标题牌
        const titleCanvas = document.createElement('canvas');
        titleCanvas.width = 512; titleCanvas.height = 128;
        const ctx = titleCanvas.getContext('2d');
        ctx.fillStyle = '#0e0e18'; ctx.fillRect(0, 0, 512, 128);
        ctx.strokeStyle = '#667eea'; ctx.lineWidth = 2; ctx.strokeRect(4, 4, 504, 120);
        ctx.fillStyle = '#e8e8ff';
        ctx.font = 'bold 36px "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(exhibit.title, 256, 64);
        const titlePlate = new THREE.Mesh(
            new THREE.BoxGeometry(2.8, 0.5, 0.08),
            new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(titleCanvas), emissive: 0x222244, emissiveIntensity: 0.3 })
        );
        titlePlate.position.set(0, -frameSize.h / 2 - 0.5, 0); group.add(titlePlate);

        const spotLight = new THREE.SpotLight(0xe8ecf8, 0.9, 18, Math.PI / 7, 0.85, 1);
        spotLight.position.set(position.x, ROOM_H - 0.5, position.z);
        spotLight.target = group; spotLight.castShadow = true;
        spotLight.shadow.mapSize.set(1024, 1024); scene.add(spotLight);

        group.position.copy(position); group.rotation.y = rotationY;
        addColliderFromMesh(`screen_${exhibit.title}`, frame, 0.1);
        videoScreens.push({ group, screen, videoEl, posterTexture, screenLight,
            title: exhibit.title, description: exhibit.description });
        scene.add(group);
    }

    // ============================================================
    // 🪑 装饰摆件
    // ============================================================
    function createPillar(x, z) {
        const pillar = new THREE.Mesh(
            new THREE.CylinderGeometry(0.3, 0.35, ROOM_H, 24),
            new THREE.MeshPhysicalMaterial({
                color: 0x1a1a26, roughness: 0.35, metalness: 0.6,
                clearcoat: 0.4, clearcoatRoughness: 0.3, envMapIntensity: 0.8
            })
        );
        pillar.position.set(x, ROOM_H / 2, z);
        pillar.castShadow = true; pillar.receiveShadow = true; scene.add(pillar);
        const ringMat = new THREE.MeshStandardMaterial({ color: 0x3a3a55, roughness: 0.3, metalness: 0.8 });
        const ringTop = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.05, 8, 16), ringMat);
        ringTop.position.set(x, ROOM_H - 0.12, z); ringTop.rotation.x = Math.PI / 2; scene.add(ringTop);
        const ringBot = ringTop.clone(); ringBot.position.y = 0.12; scene.add(ringBot);
        addColliderBox(`pillar_${x}_${z}`, x - 0.45, x + 0.45, z - 0.45, z + 0.45);
    }

    // 中心雕塑（入口大厅）
    function createSculpture() {
        const sculptureGroup = new THREE.Group();
        const base = new THREE.Mesh(
            new THREE.CylinderGeometry(1.0, 1.2, 0.4, 32),
            new THREE.MeshPhysicalMaterial({ color: 0x222238, roughness: 0.3, metalness: 0.6, clearcoat: 0.5 })
        );
        base.position.y = 0.2; base.castShadow = true; base.receiveShadow = true;
        sculptureGroup.add(base);
        const sculpture = new THREE.Mesh(
            new THREE.IcosahedronGeometry(0.9, 1),
            new THREE.MeshPhysicalMaterial({
                color: 0x4455aa, roughness: 0.12, metalness: 0.95,
                clearcoat: 0.8, clearcoatRoughness: 0.1,
                envMapIntensity: 1.5,
                emissive: 0x223388, emissiveIntensity: 0.4
            })
        );
        sculpture.position.y = 1.7; sculpture.castShadow = true;
        sculptureGroup.add(sculpture);
        const halo = new THREE.Mesh(
            new THREE.RingGeometry(1.2, 1.6, 32),
            new THREE.MeshBasicMaterial({ color: 0x667eea, transparent: true, opacity: 0.3, side: THREE.DoubleSide })
        );
        halo.rotation.x = -Math.PI / 2; halo.position.y = 0.02;
        sculptureGroup.add(halo);
        sculptureGroup.position.set(0, 0, 0);
        scene.add(sculptureGroup);
        addColliderBox('sculpture', -1.3, 1.3, -1.3, 1.3);
        const sculpLight = new THREE.PointLight(0x667eea, 2.5, 12, 2);
        sculpLight.position.set(0, 4, 0); scene.add(sculpLight);
        return { sculpture, halo };
    }

    // 长凳
    function createBench(x, z) {
        const g = new THREE.Group();
        const seatMat = new THREE.MeshPhysicalMaterial({
            color: 0x161620, roughness: 0.55, metalness: 0.15,
            clearcoat: 0.25, clearcoatRoughness: 0.4, envMapIntensity: 0.5
        });
        const seat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 0.6), seatMat);
        seat.position.y = 0.5; seat.castShadow = true; seat.receiveShadow = true; g.add(seat);
        for (const [lx, lz] of [[-1.0,-0.25],[-1.0,0.25],[1.0,-0.25],[1.0,0.25]]) {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.08), seatMat);
            leg.position.set(lx, 0.25, lz); leg.castShadow = true; g.add(leg);
        }
        g.position.set(x, 0, z); scene.add(g);
    }

    // 植物
    function createPlant(x, z) {
        const g = new THREE.Group();
        const pot = new THREE.Mesh(
            new THREE.CylinderGeometry(0.35, 0.3, 0.6, 12),
            new THREE.MeshStandardMaterial({ color: 0x1a1a2a, roughness: 0.6, metalness: 0.3 })
        );
        pot.position.y = 0.3; pot.castShadow = true; pot.receiveShadow = true; g.add(pot);
        const leafMat = new THREE.MeshStandardMaterial({ color: 0x2a4a3a, roughness: 0.7, metalness: 0.1 });
        for (let i = 0; i < 8; i++) {
            const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.1, 1.0 + Math.random()*0.4, 6), leafMat);
            const angle = (i / 8) * Math.PI * 2;
            const r = 0.15 + Math.random() * 0.12;
            leaf.position.set(Math.cos(angle)*r, 0.9 + Math.random()*0.2, Math.sin(angle)*r);
            leaf.rotation.set((Math.random()-0.5)*0.6, angle, (Math.random()-0.5)*0.6);
            leaf.castShadow = true; g.add(leaf);
        }
        g.position.set(x, 0, z); scene.add(g);
        addColliderBox(`plant_${x}_${z}`, x - 0.4, x + 0.4, z - 0.4, z + 0.4);
    }

    // ============================================================
    // ✨ 漂浮尘埃粒子
    // ============================================================
    function createDustParticles(x, z) {
        const count = 100;
        const positions = new Float32Array(count * 3);
        const velocities = [];
        for (let i = 0; i < count; i++) {
            positions[i*3]   = x + (Math.random()-0.5) * 5;
            positions[i*3+1] = Math.random() * ROOM_H;
            positions[i*3+2] = z + (Math.random()-0.5) * 5;
            velocities.push({
                x: (Math.random()-0.5)*0.002, y: (Math.random()-0.5)*0.001,
                z: (Math.random()-0.5)*0.002
            });
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const mat = new THREE.PointsMaterial({
            color: 0xdde5ff, size: 0.05, transparent: true, opacity: 0.35,
            blending: THREE.AdditiveBlending, depthWrite: false
        });
        const points = new THREE.Points(geo, mat);
        scene.add(points);
        return { points, velocities, x, z, positions };
    }

    function updateDust() {
        for (const sys of dustSystems) {
            const pos = sys.positions;
            for (let i = 0; i < sys.velocities.length; i++) {
                pos[i*3]   += sys.velocities[i].x;
                pos[i*3+1] += sys.velocities[i].y;
                pos[i*3+2] += sys.velocities[i].z;
                if (pos[i*3+1] > ROOM_H) pos[i*3+1] = 0;
                if (pos[i*3+1] < 0) pos[i*3+1] = ROOM_H;
                if (Math.abs(pos[i*3] - sys.x) > 3) sys.velocities[i].x *= -1;
                if (Math.abs(pos[i*3+2] - sys.z) > 3) sys.velocities[i].z *= -1;
            }
            sys.points.geometry.attributes.position.needsUpdate = true;
        }
    }

    // ============================================================
    // 🏗 组装整个场景
    // ============================================================
    function buildWorld() {
        for (const room of ROOMS) buildRoom(room);

        // 灯光
        scene.add(new THREE.AmbientLight(0x303848, 0.40));
        scene.add(new THREE.HemisphereLight(0xdde5ff, 0x101420, 0.22));

        app.playerLight = new THREE.PointLight(0xfff0d8, 0, 8, 2);
        scene.add(app.playerLight);

        for (const [x, z] of LAYOUT.ceilingLights) createCeilingLight(x, z);
        for (const [x, z] of LAYOUT.ceilingExtraLights) createCeilingLight(x, z);

        // 每面墙 2 盏壁灯
        for (const room of ROOMS) {
            const z0 = room.cz - room.d/2, z1 = room.cz + room.d/2;
            const zMid = (z0 + z1) / 2;
            const zRange = (z1 - z0) * 0.3;
            createWallSconce(-9 + 0.15, zMid - zRange, Math.PI / 2);
            createWallSconce(-9 + 0.15, zMid + zRange, Math.PI / 2);
            createWallSconce(9 - 0.15, zMid - zRange, -Math.PI / 2);
            createWallSconce(9 - 0.15, zMid + zRange, -Math.PI / 2);
        }

        for (const [x, z, color] of LAYOUT.footLights) createFootLight(x, z, 0, color);

        // 舞台 + 钢琴 + 人物 + 凳子
        createStage(LAYOUT.stage.cx, LAYOUT.stage.cz, LAYOUT.stage.w, LAYOUT.stage.d);
        const pianoGltf = app.assets && app.assets.piano;
        if (pianoGltf && pianoGltf.scene) {
            app.piano = createPianoFromGLB(pianoGltf, LAYOUT.piano.x, LAYOUT.piano.z, LAYOUT.piano.rotY);
        } else {
            app.piano = createGrandPiano(LAYOUT.piano.x, LAYOUT.piano.z, LAYOUT.piano.rotY);
        }
        app.pianistFigure = createPianist(LAYOUT.pianist.x, LAYOUT.pianist.z);
        scene.add(app.pianistFigure);
        createPianoBench(LAYOUT.pianoBench.x, LAYOUT.pianoBench.z, LAYOUT.pianoBench.rotY);

        // 钢琴聚光灯
        const pianoSpotCfg = LAYOUT.pianoSpot;
        const pianoSpot = new THREE.SpotLight(
            pianoSpotCfg.color, pianoSpotCfg.intensity, pianoSpotCfg.distance,
            pianoSpotCfg.angle, pianoSpotCfg.penumbra, pianoSpotCfg.decay
        );
        pianoSpot.position.set(...pianoSpotCfg.position);
        pianoSpot.target.position.set(...pianoSpotCfg.target);
        pianoSpot.target.updateMatrixWorld();
        pianoSpot.castShadow = true;
        pianoSpot.shadow.mapSize.set(pianoSpotCfg.shadowMapSize, pianoSpotCfg.shadowMapSize);
        pianoSpot.shadow.bias = pianoSpotCfg.shadowBias;
        pianoSpot.shadow.focus = pianoSpotCfg.shadowFocus;
        scene.add(pianoSpot);
        scene.add(pianoSpot.target);

        // 体积光束
        createLightBeam(
            LAYOUT.lightBeam.x, LAYOUT.lightBeam.y, LAYOUT.lightBeam.z,
            LAYOUT.lightBeam.targetZ, LAYOUT.lightBeam.color, LAYOUT.lightBeam.radius
        );

        // 均衡器
        createEqualizer(LAYOUT.equalizer.x, LAYOUT.equalizer.y, LAYOUT.equalizer.z, LAYOUT.equalizer.rotY);

        // 视频展示屏幕（与 EXHIBITS 索引对应）
        EXHIBITS.forEach((exhibit, i) => {
            const cfg = LAYOUT.screens[i];
            if (!cfg) return;
            createVideoScreen(exhibit, new THREE.Vector3(...cfg.position), cfg.rotationY);
        });

        // 柱子 / 雕塑 / 长凳 / 植物
        for (const [x, z] of LAYOUT.pillars) createPillar(x, z);
        const { sculpture, halo } = createSculpture();
        app.sculpture = sculpture;
        app.halo = halo;
        for (const [x, z] of LAYOUT.benches) createBench(x, z);
        for (const [x, z] of LAYOUT.plants) createPlant(x, z);

        // 尘埃粒子
        for (const [x, z] of LAYOUT.dustCenters) dustSystems.push(createDustParticles(x, z));
    }

    return { buildWorld, updateDoors, updateDust };
}