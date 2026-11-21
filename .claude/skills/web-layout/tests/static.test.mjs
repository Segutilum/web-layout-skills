import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { serveStaticFile } from '../scripts/lib/static.mjs';

const OPTS = { editorOrigin: 'http://127.0.0.1:5000', runtimeToken: 'abc' };

async function withServer(root, fn) {
  const server = http.createServer((req, res) => {
    serveStaticFile(req, res, { root, runtimeDir: path.resolve('.claude/skills/web-layout/editor/runtime'), ...OPTS })
      .catch((error) => { res.statusCode = 500; res.end(String(error)); });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try { await fn(origin); } finally { await new Promise((resolve) => server.close(resolve)); }
}

async function fixtureRoot() {
  const source = path.resolve('.claude/skills/web-layout/tests/fixtures/site');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wl-static-'));
  await fs.cp(source, root, { recursive: true });
  return root;
}

test('serves HTML with injection and security headers', async () => {
  const root = await fixtureRoot();
  await withServer(root, async (origin) => {
    const res = await fetch(origin + '/index.html');
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /window\.__WEB_LAYOUT__/);
    assert.match(text, /\/__layout\/runtime\.js/);
    assert.match(res.headers.get('content-security-policy'), /frame-ancestors http:\/\/127\.0\.0\.1:5000/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  });
});

test('serves CSS with the right MIME and supports HEAD', async () => {
  const root = await fixtureRoot();
  await withServer(root, async (origin) => {
    const res = await fetch(origin + '/styles.css');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/css/);
    const head = await fetch(origin + '/styles.css', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  });
});

test('rejects traversal, hidden files, and missing files', async () => {
  const root = await fixtureRoot();
  await fs.mkdir(path.join(root, '.hidden'));
  await fs.writeFile(path.join(root, '.hidden', 'secret.txt'), 'x');
  await withServer(root, async (origin) => {
    assert.equal((await fetch(origin + '/../secret')).status, 404);
    assert.equal((await fetch(origin + '/%2e%2e/secret')).status, 404);
    assert.equal((await fetch(origin + '/.hidden/secret.txt')).status, 404);
    assert.equal((await fetch(origin + '/missing.css')).status, 404);
  });
});

test('serves runtime assets from the runtime directory', async () => {
  const root = await fixtureRoot();
  await withServer(root, async (origin) => {
    const res = await fetch(origin + '/__layout/constants.js');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/javascript/);
    assert.match(await res.text(), /PALETTE/);
  });
});
