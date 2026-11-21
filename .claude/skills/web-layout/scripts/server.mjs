#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { parseArgs, readServerJson, writeServerJson, clearServerJson, pidAlive } from './lib/config.mjs';
import { createApp } from './lib/app.mjs';

function openBrowser(url) {
  const platform = process.platform;
  const command = platform === 'win32' ? 'cmd' : platform === 'darwin' ? 'open' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.unref();
  } catch {
    /* the URL is still printed */
  }
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  if (opts.stop) {
    const existing = await readServerJson(opts.root);
    if (!existing) {
      console.error('no running web-layout server for ' + opts.root);
      process.exit(1);
    }
    try {
      process.kill(existing.pid);
    } catch (error) {
      console.error('could not stop pid ' + existing.pid + ': ' + error.message);
    }
    await clearServerJson(opts.root);
    return;
  }

  const existing = await readServerJson(opts.root);
  if (existing && pidAlive(existing.pid)) {
    console.log(JSON.stringify({ type: 'web-layout-server', reused: true, ...existing }));
    return;
  }

  const app = await createApp({
    root: opts.root,
    page: opts.page,
    editorPort: opts.editorPort,
    previewPort: opts.previewPort,
    idleMinutes: opts.idleMinutes,
    onClose: () => clearServerJson(opts.root),
  });

  const info = {
    type: 'web-layout-server',
    pid: process.pid,
    root: app.config.root,
    page: opts.page,
    editorUrl: app.editorUrl,
    previewUrl: app.previewUrl,
    editorOrigin: app.editorOrigin,
    previewOrigin: app.previewOrigin,
    editorToken: app.config.editorToken,
    runtimeToken: app.config.runtimeToken,
    startedAt: new Date().toISOString(),
  };
  await writeServerJson(opts.root, info);
  console.log(JSON.stringify(info));
  if (opts.open) openBrowser(app.editorUrl);

  const stop = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((error) => {
  if (error && error.code === 'E_USAGE') {
    console.error(error.message);
    process.exit(2);
  }
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
