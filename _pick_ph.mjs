import fs from 'fs';
const data = JSON.parse(fs.readFileSync('_ph_textures.json', 'utf8'));
const kw = {
    floor: /floor|parquet|plank|wood/i,
    marble: /marble|granite|stone/i,
    wall: /plaster|brick|concrete|stucco|masonry|gypsum/i,
    fabric: /fabric|velvet|curtain|cloth|textile|silk/i,
};
const found = { floor: [], marble: [], wall: [], fabric: [] };
for (const [slug, info] of Object.entries(data)) {
    const name = (info.name || '') + ' ' + (info.category || '') + ' ' + (info.tags || []).join(' ');
    for (const k in kw) {
        if (kw[k].test(name)) found[k].push(slug + '  :: ' + info.name + '  :: ' + info.category);
    }
}
for (const k in found) {
    console.log(`\n== ${k} ==`);
    console.log(found[k].slice(0, 20).join('\n'));
}