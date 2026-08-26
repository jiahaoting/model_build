// 下载 SplendidGrandPiano 采样（仅 .ogg）到本地 samples/splendid-grand-piano/
// 供 concertAudio.js 通过 smplr 的 baseUrl 指向本地，绕开境外 CDN 访问不稳定问题。
// 用法：node _download_samples.js
const https = require('https');
const fs = require('fs');
const path = require('path');

const TREE_URL = 'https://api.github.com/repos/smpldsnds/sfzinstruments-splendid-grand-piano/git/trees/main?recursive=1';
const RAW_BASE = 'https://smpldsnds.github.io/sfzinstruments-splendid-grand-piano/samples/';
const OUT_DIR = path.join(__dirname, 'samples', 'splendid-grand-piano');
const RETRY = 3;          // 每文件重试次数
const DELAY_MS = 40;      // 请求间隔，避免触发限速

function httpsGet(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'model-build-sample-downloader' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects >= 5) return reject(new Error('too many redirects'));
        return httpsGet(res.headers.location, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
  });
}

function downloadWithRetry(url) {
  let attempt = 0;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      httpsGet(url)
        .then(resolve)
        .catch((err) => {
          attempt++;
          if (attempt < RETRY) setTimeout(tryOnce, DELAY_MS * attempt * 4);
          else reject(err);
        });
    };
    tryOnce();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('正在获取采样文件列表…');
  const treeJson = JSON.parse((await httpsGet(TREE_URL)).toString('utf8'));
  const names = treeJson.tree
    .map((e) => e.path)
    .filter((p) => p && p.startsWith('samples/') && p.endsWith('.ogg'))
    .map((p) => p.split('/').pop());
  console.log(`共 ${names.length} 个 .ogg 采样文件，开始下载…`);

  let done = 0, skipped = 0, failed = 0, totalBytes = 0;
  for (const name of names) {
    const dest = path.join(OUT_DIR, name);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) { skipped++; done++; continue; }
    const url = RAW_BASE + encodeURIComponent(name);
    try {
      const buf = await downloadWithRetry(url);
      fs.writeFileSync(dest, buf);
      totalBytes += buf.length;
      done++;
      process.stdout.write(`\r[${done}/${names.length}] ${name} (${Math.round(buf.length / 1024)} KB)`);
    } catch (e) {
      failed++;
      console.error(`\n下载失败：${name} — ${e.message}`);
    }
    await sleep(DELAY_MS);
  }
  console.log(`\n完成：成功 ${done}（其中跳过已存在 ${skipped}），失败 ${failed}，共 ${(totalBytes / 1024 / 1024).toFixed(1)} MB。`);
  if (failed > 0) console.log('有失败项，可重新运行本脚本续传（已下载文件会自动跳过）。');
}

main().catch((e) => { console.error(e); process.exit(1); });