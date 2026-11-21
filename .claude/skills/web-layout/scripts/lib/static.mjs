import path from 'node:path';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolveInsideRoot } from './paths.mjs';
import { injectPreviewHtml } from './inject.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

const MAX_FILE = 64 * 1024 * 1024;
const MAX_HTML = 10 * 1024 * 1024;

export function mimeOf(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function frameAncestors(editorOrigin) {
  return 'frame-ancestors ' + editorOrigin;
}

function setHeaders(res, editorOrigin, type) {
  res.setHeader('Content-Type', type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', frameAncestors(editorOrigin));
}

function notFound(res) {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('Not found');
}

function streamFile(res, abs) {
  const stream = createReadStream(abs);
  stream.on('error', () => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.statusCode = 500;
    res.removeHeader('Content-Length');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Read error');
  });
  stream.pipe(res);
}

export async function serveStaticFile(req, res, { root, urlPath, editorOrigin, runtimeToken, runtimeDir }) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.end('Method not allowed');
    return;
  }
  const fallback = req.url ? req.url.split('?')[0].split('#')[0] : '/';
  const pathname = String(urlPath || fallback || '/');
  if (pathname.startsWith('/__layout/')) {
    const rel = pathname.slice('/__layout/'.length);
    if (rel.includes('..') || rel.includes('\\') || rel.startsWith('.')) return notFound(res);
    const abs = path.resolve(runtimeDir, rel);
    if (!abs.startsWith(path.resolve(runtimeDir) + path.sep)) return notFound(res);
    let stat;
    try { stat = await fs.stat(abs); } catch { return notFound(res); }
    if (!stat.isFile()) return notFound(res);
    if (stat.size > MAX_FILE) {
      res.statusCode = 413;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('File too large');
      return;
    }
    setHeaders(res, editorOrigin, mimeOf(abs));
    if (req.method === 'HEAD') return res.end();
    streamFile(res, abs);
    return;
  }

  const abs = await resolveInsideRoot(root, pathname);
  if (!abs) return notFound(res);
  let stat;
  try { stat = await fs.stat(abs); } catch { return notFound(res); }
  if (!stat.isFile()) return notFound(res);
  if (stat.size > MAX_FILE) {
    res.statusCode = 413;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('File too large');
    return;
  }

  const type = mimeOf(abs);
  if (type.startsWith('text/html')) {
    if (stat.size > MAX_HTML) {
      res.statusCode = 413;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('HTML too large for preview');
      return;
    }
    const html = await fs.readFile(abs, 'utf8');
    const injected = injectPreviewHtml(html, { editorOrigin, runtimeToken });
    setHeaders(res, editorOrigin, type);
    res.setHeader('Content-Length', Buffer.byteLength(injected));
    if (req.method === 'HEAD') return res.end();
    res.end(injected);
    return;
  }

  setHeaders(res, editorOrigin, type);
  res.setHeader('Content-Length', stat.size);
  if (req.method === 'HEAD') return res.end();
  streamFile(res, abs);
}
