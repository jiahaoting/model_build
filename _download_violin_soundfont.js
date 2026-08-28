// 下载小提琴采样（midi.js Soundfont 单文件 base64 格式）
// 到本地 samples/violin/，供 src/violinAudio.js 通过本地 smplr 的 Soundfont 加载器读取，
// 绕开境外 CDN（gleitz.github.io）访问不稳定问题。
// 音源：FluidR3_GM —— 比 MusyngKite 更干净、音准更稳的通用 MIDI 小提琴。
// 用法：node _download_violin_soundfont.js
const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/';
// 优先 mp3（各浏览器 decodeAudioData 均支持，兼容性最佳）；ogg 作为备用。
const FILES = ['violin-mp3.js', 'violin-ogg.js'];
const OUT_DIR = path.join(__dirname, 'samples', 'violin');
const RETRY = 3;

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
    req.setTimeout(120000, () => req.destroy(new Error('timeout')));
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
          if (attempt < RETRY) setTimeout(tryOnce, 2000 * attempt);
          else reject(err);
        });
    };
    tryOnce();
  });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const name of FILES) {
    const dest = path.join(OUT_DIR, name);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      console.log('跳过已存在：' + name);
      continue;
    }
    const url = BASE + name;
    console.log('下载 ' + url + ' …');
    try {
      const buf = await downloadWithRetry(url);
      fs.writeFileSync(dest, buf);
      console.log(`完成 ${name} (${(buf.length / 1024 / 1024).toFixed(2)} MB)`);
    } catch (e) {
      console.error(`下载失败 ${name}：${e.message}`);
    }
  }
  console.log('小提琴采样下载流程结束。');
}

main().catch((e) => { console.error(e); process.exit(1); });