import fs from 'fs';
import path from 'path';

const DIR = 'assets/textures';
fs.mkdirSync(DIR, { recursive: true });

const assets = {
    velour_velvet: { out: 'velvet', maps: ['diff', 'nor_gl', 'rough', 'ao'] },
    herringbone_parquet: { out: 'parquet', maps: ['diff', 'nor_gl', 'rough', 'ao'] },
    marble_01: { out: 'marble', maps: ['diff', 'nor_gl', 'rough', 'ao'] },
};

const MAPKEY = { diff: 'Diffuse', nor_gl: 'nor_gl', rough: 'Rough', ao: 'AO' };

for (const [slug, cfg] of Object.entries(assets)) {
    for (const m of cfg.maps) {
        const key = MAPKEY[m];
        const file = `${cfg.out}_${m}.jpg`;
        const dest = path.join(DIR, file);
        if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) { console.log('skip', file); continue; }
        // 从 files API 拿精确 URL（避免手动拼错）
        const res = await fetch(`https://api.polyhaven.com/files/${slug}`, { headers: { 'User-Agent': 'MyAssetBrowser/1.0' } });
        const j = await res.json();
        const url = j[key]?.['2k']?.jpg?.url;
        if (!url) { console.log('MISSING', slug, key); continue; }
        const r = await fetch(url, { headers: { 'User-Agent': 'MyAssetBrowser/1.0' } });
        if (!r.ok) { console.log('FAIL', url, r.status); continue; }
        const buf = Buffer.from(await r.arrayBuffer());
        fs.writeFileSync(dest, buf);
        console.log('OK', file, (buf.length / 1024 / 1024).toFixed(2) + 'MB');
    }
}
console.log('DONE');