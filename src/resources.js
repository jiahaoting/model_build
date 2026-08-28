import { TextureLoader, AudioLoader } from 'three';
import { createMarbleTextures, createWallTextures, createKeyboardTexture } from './textures.js';

// ============================================================
// 📦 资源加载管线（统一入口 + 进度回调 + 可扩展）
// - 程序化纹理：即时生成（Phase 0 已用）
// - 外部资源（GLTF / 贴图 / 音频 / HDRI）：通过 manifest 接入，
//   在 Phase 2/3/4 填充（钢琴 GLB、PBR 贴图、CC0 音频、HDRI 等）。
//   加载器按需动态导入，避免启动时加载未用模块。
// ============================================================
export function createResourceManager({ maxAnisotropy, onProgress = () => {} }) {
    let _manifest = [];

    return {
        textures: null,
        assets: {},

        setManifest(manifest) { _manifest = manifest || []; },

        async load() {
            // 阶段一：程序化纹理（同步快）
            this.textures = {
                marble: createMarbleTextures(maxAnisotropy),
                wall: createWallTextures(),
                keyboard: createKeyboardTexture()
            };
            onProgress(0.5, '程序化纹理就绪');

            // 阶段二：外部资源（按 id 存入 assets，供场景装配；单项失败不阻断整体）
            this.assets = {};
            const total = Math.max(1, _manifest.length);
            let done = 0;
            for (const entry of _manifest) {
                try {
                    const result = await this.loadEntry(entry);
                    if (entry.id) this.assets[entry.id] = result;
                } catch (err) {
                    console.warn(`[resources] 加载失败（将回退）: ${entry.id || entry.type}`, err);
                }
                done += 1;
                onProgress(0.5 + (done / total) * 0.5, entry.id || entry.type);
            }
            onProgress(1, '资源加载完成');
            return this.textures;
        },

        async loadEntry(entry) {
            switch (entry.type) {
                case 'texture': return this.loadTexture(entry);
                case 'model':   return this.loadModel(entry);
                case 'audio':   return this.loadAudio(entry);
                case 'hdr':     return this.loadHDRI(entry);
                default: throw new Error(`未知资源类型: ${entry.type}`);
            }
        },

        async loadTexture({ url }) {
            return new TextureLoader().loadAsync(url);
        },

        async loadModel({ url }) {
            const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
            const loader = new GLTFLoader();
            // Draco 解压（剧院等大场景 GLB 使用 Draco 网格压缩；解码器走 CDN 按需加载）
            if (/\.glb(\?|$)/i.test(url)) {
                const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js');
                const draco = new DRACOLoader();
                draco.setDecoderPath('assets/draco/');   // 本地解码器，避免 jsdelivr CDN 在 Worker 内跨域/断流导致 "network error"
                loader.setDRACOLoader(draco);
            }
            return loader.loadAsync(url);
        },

        async loadAudio({ url }) {
            return new AudioLoader().loadAsync(url);
        },

        // HDRI 环境贴图（Radiance .hdr —— EquirectangularReflectionMapping）
        async loadHDRI({ url }) {
            const { RGBELoader } = await import('three/addons/loaders/RGBELoader.js');
            return new RGBELoader().loadAsync(url);
        }
    };
}