import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../scripts/lib/app.mjs';

async function fixture() {
  const source = path.resolve('.claude/skills/web-layout/tests/fixtures/site');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wl-startup-'));
  await fs.cp(source, root, { recursive: true });
  return root;
}

function freePorts(count) {
  const servers = [];
  const ports = [];
  return new Promise((resolve, reject) => {
    const next = (index) => {
      if (index === count) {
        for (const server of servers) server.close();
        resolve(ports);
        return;
      }
      const server = net.createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        ports.push(server.address().port);
        servers.push(server);
        next(index + 1);
      });
    };
    next(0);
  });
}

function occupy(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function canBind(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

test('a failed second bind closes the first listener and leaves server.json alone', async () => {
  const root = await fixture();
  const [editorPort, previewPort] = await freePorts(2);
  const blocker = await occupy(previewPort);
  const serverJson = path.join(root, '.web-layout', 'server.json');
  await fs.mkdir(path.dirname(serverJson), { recursive: true });
  const existing = JSON.stringify({ pid: 424242, editorUrl: 'http://127.0.0.1:1/' });
  await fs.writeFile(serverJson, existing);

  try {
    await assert.rejects(
      () => createApp({ root, page: 'index.html', editorPort, previewPort, idleMinutes: 0 }),
      (error) => error && error.code === 'EADDRINUSE',
    );
    assert.equal(await canBind(editorPort), true, 'the first listener must be released');
    assert.equal(await fs.readFile(serverJson, 'utf8'), existing, 'a pre-existing server.json must survive');
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
  }
});
