const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.hdr': 'image/vnd.radiance',
    '.ico': 'image/x-icon',
    '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.mid': 'audio/midi',
    '.midi': 'audio/midi',
    '.wasm': 'application/wasm'
};

http.createServer((req, res) => {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';

    // 调试截图上传：POST /upload/<filename>（body 为原始字节，保存到项目根目录）
    if (req.method === 'POST' && urlPath.startsWith('/upload/')) {
        const name = path.basename(urlPath.slice(8));
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            fs.writeFile(path.join(__dirname, name), Buffer.concat(chunks), (err) => {
                res.writeHead(err ? 500 : 200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
                res.end(err ? 'fail' : 'ok');
            });
        });
        return;
    }

    // 曲目列表接口：返回 midi/ 目录下全部 .mid/.midi 文件的名称与访问地址
    if (urlPath === '/api/midis') {
        const dir = path.join(__dirname, 'midi');
        fs.readdir(dir, (err, files) => {
            if (err) {
                res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ error: 'midi dir not found' }));
                return;
            }
            const midis = files
                .filter(f => /\.(mid|midi)$/i.test(f))
                .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
                .map(f => ({
                    name: f.replace(/\.(mid|midi)$/i, ''),
                    url: '/midi/' + encodeURIComponent(f)
                }));
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify(midis));
        });
        return;
    }

    const filePath = path.join(__dirname, urlPath);
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found: ' + urlPath);
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const ct = MIME[ext] || 'application/octet-stream';
        res.writeHead(200, {
            'Content-Type': ct,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Access-Control-Allow-Origin': '*'
        });
        res.end(data);
    });
}).listen(8080, () => console.log('Server running at http://localhost:8080/'));
