import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConfig } from './config.mjs';
import { createWorkspace } from './workspace.mjs';
import { createApiHandler } from './api.mjs';
import { serveStaticFile, serveEditorFile } from './static.mjs';

const editorDir = fileURLToPath(new URL('../../editor/', import.meta.url));
const runtimeDir = path.join(editorDir, 'runtime');

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

async function checkRoot(root) {
  let stat;
  try {
    stat = await fs.stat(root);
  } catch {
    throw Object.assign(new Error('root does not exist: ' + root), { code: 'E_USAGE' });
  }
  if (!stat.isDirectory()) {
    throw Object.assign(new Error('root is not a directory: ' + root), { code: 'E_USAGE' });
  }
}

export async function createApp({ root, page = '', editorPort = 0, previewPort = 0, idleMinutes = 60, onClose }) {
  const config = createConfig({ root, page, editorPort, previewPort, idleMinutes });
  await checkRoot(config.root);
  const workspace = createWorkspace({ root: config.root });
  let editorOrigin = '';
  let previewOrigin = '';
  let lastActivity = Date.now();
  let closed = false;
  let timer = null;
  const servers = [];

  const close = async () => {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(() => resolve()))));
    if (typeof onClose === 'function') await onClose();
  };
  const shutdown = () => { close().catch(() => {}); };

  const handler = createApiHandler({
    workspace,
    config,
    getEditorOrigin: () => editorOrigin,
    getPreviewOrigin: () => previewOrigin,
    shutdown,
  });

  const editorServer = http.createServer(async (req, res) => {
    lastActivity = Date.now();
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname.startsWith('/api/')) {
        await handler(req, res, url);
        return;
      }
      await serveEditorFile(req, res, { root: editorDir, urlPath: url.pathname });
    } catch {
      res.statusCode = 500;
      res.end('Internal error');
    }
  });

  const previewServer = http.createServer(async (req, res) => {
    lastActivity = Date.now();
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      await serveStaticFile(req, res, {
        root: config.root,
        urlPath: url.pathname,
        editorOrigin,
        runtimeToken: config.runtimeToken,
        runtimeDir,
      });
    } catch {
      res.statusCode = 500;
      res.end('Internal error');
    }
  });

  servers.push(editorServer, previewServer);
  let p1;
  let p2;
  try {
    p1 = await listen(editorServer, config.editorPort);
    p2 = await listen(previewServer, config.previewPort);
  } catch (error) {
    // A failed start must not leave the other listener bound. Do not call close()
    // here: server.json is only written after both binds succeed, and any existing
    // file may belong to a live instance.
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(() => resolve()))));
    throw error;
  }
  editorOrigin = 'http://127.0.0.1:' + p1;
  previewOrigin = 'http://127.0.0.1:' + p2;
  const encodedPage = String(page || '').split('/').map(encodeURIComponent).join('/');
  const editorUrl = editorOrigin + '/?page=' + encodeURIComponent(String(page || '')) + '#token=' + config.editorToken;
  const previewUrl = previewOrigin + (encodedPage ? '/' + encodedPage : '/');

  if (idleMinutes > 0) {
    timer = setInterval(() => {
      if (Date.now() - lastActivity > idleMinutes * 60000) shutdown();
    }, 30000);
    if (typeof timer.unref === 'function') timer.unref();
  }

  return {
    config,
    editorUrl,
    previewUrl,
    editorOrigin,
    previewOrigin,
    close,
    shutdown,
  };
}
