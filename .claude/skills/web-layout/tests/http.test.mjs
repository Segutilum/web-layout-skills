import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';
import { readJsonBody, tokenFrom, originOk, checkToken } from '../scripts/lib/http.mjs';
import { parseArgs, createConfig, pidAlive } from '../scripts/lib/config.mjs';
import { createApiHandler } from '../scripts/lib/api.mjs';

function reqWith(body, headers = {}) {
  const req = Readable.from([Buffer.from(body)]);
  req.headers = headers;
  return req;
}

test('readJsonBody parses valid JSON', async () => {
  assert.deepEqual(await readJsonBody(reqWith('{"a":1}')), { a: 1 });
});

test('readJsonBody rejects invalid JSON', async () => {
  await assert.rejects(() => readJsonBody(reqWith('{bad')), (error) => error.code === 'E_INVALID_JSON');
});

test('readJsonBody rejects bodies over the limit', async () => {
  await assert.rejects(
    () => readJsonBody(reqWith('{"a":"' + 'x'.repeat(64) + '"}'), 10),
    (error) => error.code === 'E_TOO_LARGE',
  );
});

test('token and origin guards', () => {
  const req = reqWith('', { 'x-layout-token': 'abc', origin: 'http://127.0.0.1:5000' });
  assert.equal(tokenFrom(req), 'abc');
  assert.equal(checkToken(req, 'abc'), true);
  assert.equal(checkToken(req, 'wrong'), false);
  assert.equal(originOk(req, 'http://127.0.0.1:5000'), true);
  assert.equal(originOk(req, 'http://127.0.0.1:5001'), false);
});

test('parseArgs validates root, ports, and idle minutes', () => {
  const parsed = parseArgs(['--root', '.', '--page', 'index.html', '--editor-port', '1234', '--idle-minutes', '5']);
  assert.equal(parsed.page, 'index.html');
  assert.equal(parsed.editorPort, 1234);
  assert.equal(parsed.idleMinutes, 5);
  assert.throws(() => parseArgs(['--page', 'x']), (error) => error.code === 'E_USAGE');
  assert.throws(() => parseArgs(['--root', '.', '--editor-port', '99999']), (error) => error.code === 'E_USAGE');
});

test('createConfig generates 32-byte hex tokens and an idle duration', () => {
  const config = createConfig(parseArgs(['--root', '.', '--idle-minutes', '2']));
  assert.match(config.editorToken, /^[0-9a-f]{64}$/);
  assert.match(config.runtimeToken, /^[0-9a-f]{64}$/);
  assert.equal(config.idleMs, 120000);
});

test('pidAlive is false for an impossible pid', () => {
  assert.equal(pidAlive(999999), false);
  assert.equal(pidAlive(0), false);
});

test('disk write failures map to 500 without leaking the raw message', async (t) => {
  t.mock.method(console, 'error', () => {});
  const failingWorkspace = {
    saveEditorManifest: async () => {
      throw Object.assign(new Error('EACCES: permission denied, open C:\\secret'), { code: 'EACCES' });
    },
  };
  let origin = '';
  const handler = createApiHandler({
    workspace: failingWorkspace,
    config: { editorToken: 'tok', runtimeToken: 'rt' },
    getEditorOrigin: () => origin,
    getPreviewOrigin: () => 'http://127.0.0.1:5001',
    shutdown: () => {},
  });
  const server = http.createServer((req, res) => {
    handler(req, res, new URL(req.url, origin || 'http://127.0.0.1'));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  try {
    const response = await fetch(origin + '/api/manifest?page=index.html', {
      method: 'PUT',
      headers: { 'X-Layout-Token': 'tok', Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest: { modules: [] } }),
    });
    assert.equal(response.status, 500);
    const text = await response.text();
    const json = JSON.parse(text);
    assert.equal(json.ok, false);
    assert.equal(json.error.code, 'E_WRITE_FAILED');
    assert.equal(json.error.message, 'server-side write failure');
    assert.equal(text.includes('C:\\secret'), false);
    assert.equal(text.includes('EACCES'), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
