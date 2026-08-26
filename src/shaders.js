// ============================================================
// 🎬 电影色彩分级 Shader（青橙调 + 暗角 + 对比度 + 饱和度 + 胶片颗粒）
// ============================================================
export const CinematicShader = {
    uniforms: {
        tDiffuse: { value: null },
        uVignette: { value: 0.8 },
        uVignetteFalloff: { value: 0.45 },
        uTeal: { value: 0.10 },
        uOrange: { value: 0.005 },
        uContrast: { value: 1.10 },
        uSaturation: { value: 1.02 },
        uTime: { value: 0 }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uVignette, uVignetteFalloff, uTeal, uOrange, uContrast, uSaturation, uTime;
        varying vec2 vUv;

        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
        }

        void main() {
            vec4 col = texture2D(tDiffuse, vUv);

            // 对比度
            col.rgb = (col.rgb - 0.5) * uContrast + 0.5;

            // 亮度
            float luma = dot(col.rgb, vec3(0.299, 0.587, 0.114));

            // 饱和度
            col.rgb = mix(vec3(luma), col.rgb, uSaturation);

            // 青橙分级：暗部偏青，亮部偏暖
            float shadowMask = 1.0 - smoothstep(0.0, 0.5, luma);
            col.b += shadowMask * uTeal;
            col.r -= shadowMask * uTeal * 0.4;
            col.g += shadowMask * uTeal * 0.2;

            float highMask = smoothstep(0.5, 1.0, luma);
            col.r += highMask * uOrange;
            col.g += highMask * uOrange * 0.5;
            col.b -= highMask * uOrange * 0.3;

            // 暗角
            vec2 c = vUv - 0.5;
            float dist = length(c);
            float vig = 1.0 - smoothstep(uVignetteFalloff, 0.85, dist) * uVignette;
            col.rgb *= vig;

            // 胶片颗粒（非常微弱）
            float grain = (hash(vUv * 1000.0 + uTime) - 0.5) * 0.02;
            col.rgb += grain;

            gl_FragColor = col;
        }
    `
};