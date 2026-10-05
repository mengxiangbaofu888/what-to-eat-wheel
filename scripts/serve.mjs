/**
 * serve.mjs · 本地静态服务器 + 视觉接口代理
 *
 * 两个作用：
 *   1. 用 http://localhost 打开页面，手机的「添加到主屏幕」、剪贴板、摄像头权限都更正常；
 *   2. 代理 /api/vision —— 浏览器直接调第三方的视觉模型接口经常被 CORS 拦下来，
 *      走本地服务器转发就没有跨域问题了（Key 只在内存里过一下，不落盘、不外传）。
 *
 * 用法：node scripts/serve.mjs [端口]
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const PORT = Number(process.argv[2] || process.env.PORT || 5178);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

async function readBody(req, limit = 32 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('请求体太大（图片太多或太大）');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** 转发到真正的视觉模型接口，把原始响应原样吐回去 */
async function handleVisionProxy(req, res) {
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (e) {
    return send(res, 400, JSON.stringify({ error: { message: '代理收到的请求不是合法 JSON：' + e.message } }), { 'Content-Type': 'application/json; charset=utf-8' });
  }

  const { baseUrl, apiKey, payload: inner } = payload || {};
  if (!baseUrl || !apiKey || !inner) {
    return send(res, 400, JSON.stringify({ error: { message: '代理缺少 baseUrl / apiKey / payload' } }), { 'Content-Type': 'application/json; charset=utf-8' });
  }

  let url = String(baseUrl).trim().replace(/\/+$/, '');
  if (!/\/chat\/completions$/.test(url)) url += '/chat/completions';

  const started = Date.now();
  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(inner),
      signal: AbortSignal.timeout(120000),
    });
    const text = await upstream.text();
    console.log(`[proxy] ${upstream.status} ${url} ${Date.now() - started}ms`);
    return send(res, upstream.status, text, { 'Content-Type': 'application/json; charset=utf-8' });
  } catch (e) {
    console.log(`[proxy] 失败 ${url} ${e.message}`);
    return send(res, 502, JSON.stringify({ error: { message: '本地代理转发失败：' + e.message } }), { 'Content-Type': 'application/json; charset=utf-8' });
  }
}

async function handleStatic(req, res) {
  let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/favicon.ico') return send(res, 204, '');

  const target = normalize(join(DIST, pathname));
  if (!target.startsWith(DIST + sep)) return send(res, 403, 'Forbidden');

  try {
    const info = await stat(target);
    if (info.isDirectory()) return send(res, 404, 'Not found');
    const data = await readFile(target);
    return send(res, 200, data, { 'Content-Type': MIME[extname(target).toLowerCase()] || 'application/octet-stream' });
  } catch {
    return send(res, 404, 'Not found（先跑 npm run build）');
  }
}

const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/vision') return handleVisionProxy(req, res);
  if (req.method === 'GET' || req.method === 'HEAD') return handleStatic(req, res);
  return send(res, 405, 'Method not allowed');
});

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('❌ dist/index.html 不存在，先执行：npm run build');
  process.exit(1);
}

function listen(port) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`端口 ${port} 被占用，换 ${port + 1} …`);
      listen(port + 1);
    } else {
      console.error(err);
      process.exit(1);
    }
  });
  server.listen(port, '0.0.0.0', () => {
    const lan = lanAddress();
    console.log('');
    console.log('  吃啥转盘已经跑起来了 🎡');
    console.log(`  本机：   http://127.0.0.1:${port}`);
    if (lan) console.log(`  手机：   http://${lan}:${port}（手机连同一个 WiFi）`);
    console.log('  拍照识别请在「设置」里勾选「通过本地代理请求」，就不会有跨域问题。');
    console.log('  Ctrl+C 停止');
    console.log('');
  });
}

function lanAddress() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '';
}

listen(PORT);
