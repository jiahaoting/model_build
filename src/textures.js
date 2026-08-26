import * as THREE from 'three';

// ============================================================
// 🎨 程序化纹理生成器（写实电影风）
// ============================================================

// 大理石颜色纹理 + 凹凸贴图（同步生成）
export function createMarbleTextures(maxAnisotropy, size = 1024) {
    // --- 颜色纹理 ---
    const cCanvas = document.createElement('canvas');
    cCanvas.width = cCanvas.height = size;
    const ctx = cCanvas.getContext('2d');
    const baseGrad = ctx.createLinearGradient(0, 0, size, size);
    baseGrad.addColorStop(0, '#0e0e16');
    baseGrad.addColorStop(0.5, '#14141e');
    baseGrad.addColorStop(1, '#0c0c14');
    ctx.fillStyle = baseGrad; ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 12000; i++) {
        const v = Math.random();
        ctx.fillStyle = `rgba(${60+v*30},${60+v*30},${90+v*40},${Math.random()*0.04})`;
        ctx.fillRect(Math.random()*size, Math.random()*size, 2, 2);
    }
    for (let v = 0; v < 25; v++) {
        ctx.strokeStyle = `rgba(${80+Math.random()*40},${80+Math.random()*40},${120+Math.random()*40},${0.03+Math.random()*0.08})`;
        ctx.lineWidth = 0.5 + Math.random() * 2.5;
        ctx.beginPath();
        let x = Math.random()*size, y = Math.random()*size;
        ctx.moveTo(x, y);
        for (let s = 0; s < 40; s++) {
            x += (Math.random()-0.5)*60; y += (Math.random()-0.5)*60;
            ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
    for (let i = 0; i < 35; i++) {
        const x = Math.random()*size, y = Math.random()*size, r = 20+Math.random()*100;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, 'rgba(80,80,110,0.06)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad; ctx.fillRect(x-r, y-r, r*2, r*2);
    }
    const colorTex = new THREE.CanvasTexture(cCanvas);
    colorTex.wrapS = colorTex.wrapT = THREE.RepeatWrapping;
    colorTex.colorSpace = THREE.SRGBColorSpace;
    colorTex.anisotropy = maxAnisotropy;

    // --- 凹凸贴图（灰度高度图）---
    const bCanvas = document.createElement('canvas');
    bCanvas.width = bCanvas.height = size;
    const bctx = bCanvas.getContext('2d');
    bctx.fillStyle = '#808080'; bctx.fillRect(0, 0, size, size);
    for (let v = 0; v < 25; v++) {
        bctx.strokeStyle = `rgba(${30+Math.random()*20},${30+Math.random()*20},${30+Math.random()*20},${0.2+Math.random()*0.3})`;
        bctx.lineWidth = 0.5 + Math.random() * 2.5;
        bctx.beginPath();
        let x = Math.random()*size, y = Math.random()*size;
        bctx.moveTo(x, y);
        for (let s = 0; s < 40; s++) {
            x += (Math.random()-0.5)*60; y += (Math.random()-0.5)*60;
            bctx.lineTo(x, y);
        }
        bctx.stroke();
    }
    for (let i = 0; i < 8000; i++) {
        const v = 110 + Math.random() * 40;
        bctx.fillStyle = `rgba(${v},${v},${v},0.3)`;
        bctx.fillRect(Math.random()*size, Math.random()*size, 1, 1);
    }
    const bumpTex = new THREE.CanvasTexture(bCanvas);
    bumpTex.wrapS = bumpTex.wrapT = THREE.RepeatWrapping;
    bumpTex.anisotropy = maxAnisotropy;

    return { colorTex, bumpTex };
}

// 墙面颜色纹理 + 凹凸贴图
export function createWallTextures(size = 512) {
    // --- 颜色纹理 ---
    const cCanvas = document.createElement('canvas');
    cCanvas.width = cCanvas.height = size;
    const ctx = cCanvas.getContext('2d');
    const baseGrad = ctx.createLinearGradient(0, 0, 0, size);
    baseGrad.addColorStop(0, '#0f1220');
    baseGrad.addColorStop(0.5, '#0c0f1a');
    baseGrad.addColorStop(1, '#0a0c16');
    ctx.fillStyle = baseGrad; ctx.fillRect(0, 0, size, size);
    const panelW = size / 5;
    for (let i = 0; i <= 5; i++) {
        const x = i * panelW;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke();
        ctx.strokeStyle = 'rgba(60,60,90,0.1)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x+3, 0); ctx.lineTo(x+3, size); ctx.stroke();
    }
    for (let h = 1; h < 4; h++) {
        ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, h * size/4); ctx.lineTo(size, h * size/4); ctx.stroke();
    }
    for (let i = 0; i < 6000; i++) {
        const v = Math.random();
        ctx.fillStyle = `rgba(${22+v*35},${25+v*40},${60+v*70},${Math.random()*0.06})`;
        ctx.fillRect(Math.random()*size, Math.random()*size, 2, 2);
    }
    for (let i = 0; i < 8; i++) {
        const x = Math.random()*size, y = Math.random()*size, r = 20+Math.random()*60;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, 'rgba(0,0,0,0.08)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad; ctx.fillRect(x-r, y-r, r*2, r*2);
    }
    const colorTex = new THREE.CanvasTexture(cCanvas);
    colorTex.wrapS = colorTex.wrapT = THREE.RepeatWrapping;
    colorTex.colorSpace = THREE.SRGBColorSpace;

    // --- 凹凸贴图 ---
    const bCanvas = document.createElement('canvas');
    bCanvas.width = bCanvas.height = size;
    const bctx = bCanvas.getContext('2d');
    bctx.fillStyle = '#808080'; bctx.fillRect(0, 0, size, size);
    for (let i = 0; i <= 5; i++) {
        const x = i * panelW;
        bctx.strokeStyle = 'rgba(20,20,20,0.9)'; bctx.lineWidth = 5;
        bctx.beginPath(); bctx.moveTo(x, 0); bctx.lineTo(x, size); bctx.stroke();
    }
    for (let h = 1; h < 4; h++) {
        bctx.strokeStyle = 'rgba(30,30,30,0.5)'; bctx.lineWidth = 3;
        bctx.beginPath(); bctx.moveTo(0, h * size/4); bctx.lineTo(size, h * size/4); bctx.stroke();
    }
    for (let i = 0; i < 10000; i++) {
        const v = 100 + Math.random() * 60;
        bctx.fillStyle = `rgba(${v},${v},${v},0.25)`;
        bctx.fillRect(Math.random()*size, Math.random()*size, 1, 1);
    }
    const bumpTex = new THREE.CanvasTexture(bCanvas);
    bumpTex.wrapS = bumpTex.wrapT = THREE.RepeatWrapping;

    return { colorTex, bumpTex };
}

// 文本纹理（门牌 / 房间名牌）
export function createTextTexture(text, subtitle, accentColor = '#667eea') {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, 'rgba(18,18,30,0.95)'); grad.addColorStop(1, 'rgba(8,8,16,0.95)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 1024, 256);
    ctx.strokeStyle = accentColor; ctx.lineWidth = 3; ctx.strokeRect(6, 6, 1012, 244);
    ctx.fillStyle = '#e8e8ff';
    ctx.font = 'bold 72px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 512, subtitle ? 95 : 128);
    if (subtitle) {
        ctx.fillStyle = accentColor;
        ctx.font = '36px "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillText(subtitle, 512, 175);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

// 钢琴键盘纹理
export function createKeyboardTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#d8d0c0'; ctx.fillRect(0, 0, 1024, 128);
    const numKeys = 52;
    const kw = 1024 / numKeys;
    ctx.strokeStyle = '#666'; ctx.lineWidth = 1;
    for (let i = 0; i <= numKeys; i++) {
        ctx.beginPath(); ctx.moveTo(i*kw, 0); ctx.lineTo(i*kw, 128); ctx.stroke();
    }
    const grad = ctx.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, 'rgba(0,0,0,0.35)');
    grad.addColorStop(0.3, 'rgba(0,0,0,0.1)');
    grad.addColorStop(1, 'rgba(0,0,0,0.05)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 1024, 128);
    for (let i = 0; i < numKeys; i++) {
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.fillRect(i * kw, 0, 2, 128);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}