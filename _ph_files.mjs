const slugs = ['velour_velvet', 'herringbone_parquet', 'marble_01'];
for (const slug of slugs) {
    const res = await fetch(`https://api.polyhaven.com/files/${slug}`, { headers: { 'User-Agent': 'MyAssetBrowser/1.0' } });
    const j = await res.json();
    console.log(`\n===== ${slug} =====`);
    // 打印 2k jpg 各图层下载链接
    const picks = [];
    for (const [mapName, resMap] of Object.entries(j)) {
        const k2 = resMap?.['2k'] || resMap?.['1k'];
        const jpg = k2?.jpg;
        if (jpg?.url) picks.push(`${mapName}: ${jpg.url}  (${(jpg.size/1024/1024).toFixed(2)}MB)`);
    }
    console.log(picks.join('\n'));
}