import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../scripts/lib/app.mjs';
import { saveManifest } from '../scripts/lib/manifest.mjs';
import { sourceVersion, styleVersion } from '../scripts/lib/version.mjs';

async function fixture() {
  const source = path.resolve('.claude/skills/web-layout/tests/fixtures/site');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wl-server-'));
  await fs.cp(source, root, { recursive: true });
  return root;
}

function manifest(page, src) {
  return {
    schema: 1,
    page,
    generatedBy: 'agent',
    sourceVersion: src,
    stylesheets: ['styles.css'],
    modules: [
      { id: 'site-header', role: 'header', label: 'Header', ref: 'header.site-header', matchIndex: 0, tag: 'header', classes: 'site-header', text: 'Fixture', fingerprint: 'header|site-header|Fixture', container: false, layout: 'flow' },
      { id: 'hero', role: 'hero', label: 'Hero', ref: 'section.hero', matchIndex: 0, tag: 'section', classes: 'hero', text: 'Hero', fingerprint: 'section|hero|Hero', container: true, layout: 'column', children: [
        { id: 'hero-title', role: 'heading', label: 'Title', ref: 'section.hero h2', matchIndex: 0, tag: 'h2', classes: '', text: 'Hero', fingerprint: 'h2||Hero', container: false, layout: 'flow' },
      ] },
      { id: 'features', role: 'section', label: 'Features', ref: 'section.features', matchIndex: 0, tag: 'section', classes: 'features', text: 'Features', fingerprint: 'section|features|Features', container: false, layout: 'flow' },
      { id: 'site-footer', role: 'footer', label: 'Footer', ref: 'footer.site-footer', matchIndex: 0, tag: 'footer', classes: 'site-footer', text: 'Footer', fingerprint: 'footer|site-footer|Footer', container: false, layout: 'flow' },
    ],
  };
}

test('two listeners serve preview, API, and shutdown', async () => {
  const root = await fixture();
  let closed = false;
  const app = await createApp({ root, page: 'index.html', editorPort: 0, previewPort: 0, idleMinutes: 0, onClose: () => { closed = true; } });
  try {
    const preview = await fetch(app.previewUrl);
    assert.equal(preview.status, 200);
    const html = await preview.text();
    assert.match(html, /window\.__WEB_LAYOUT__/);
    assert.match(html, /\/__layout\/runtime\.js/);
    assert.match(preview.headers.get('content-security-policy'), new RegExp('frame-ancestors ' + app.editorOrigin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    const forbidden = await fetch(app.editorOrigin + '/api/pages');
    assert.equal(forbidden.status, 403);

    const token = app.config.editorToken;
    const pages = await fetch(app.editorOrigin + '/api/pages', { headers: { 'X-Layout-Token': token } });
    assert.equal(pages.status, 200);
    assert.deepEqual((await pages.json()).value.pages, ['about.html', 'index.html']);

    const src = await sourceVersion(root, 'index.html');
    await saveManifest(root, 'index.html', manifest('index.html', src), { sourceVersion: src });
    const state = await fetch(app.editorOrigin + '/api/state?page=index.html', { headers: { 'X-Layout-Token': token } });
    assert.equal(state.status, 200);
    const stateBody = (await state.json()).value;
    assert.equal(stateBody.manifestStatus, 'ok');
    assert.equal(stateBody.previewOrigin, app.previewOrigin);
    assert.match(stateBody.runtimeToken, /^[0-9a-f]{64}$/);

    const badOrigin = await fetch(app.editorOrigin + '/api/intent', {
      method: 'POST',
      headers: { 'X-Layout-Token': token, 'Content-Type': 'application/json', Origin: 'http://evil.example' },
      body: JSON.stringify({ intent: {} }),
    });
    assert.equal(badOrigin.status, 403);

    const style = await styleVersion(root, 'index.html');
    const intent = {
      schema: 1, kind: 'web-layout-intent', page: 'index.html',
      sourceVersion: src, styleVersion: style,
      changes: { moved: [{ module: 'hero', to: { parent: '__root__', index: 2 } }], added: [], removed: [] },
      modules: [{ id: 'hero', ref: 'section.hero', note: 'Tighter' }],
      tree: [{ id: '__root__', children: [
        { id: 'site-header' }, { id: 'features' }, { id: 'hero' }, { id: 'site-footer' },
      ] }],
    };
    const intentRes = await fetch(app.editorOrigin + '/api/intent', {
      method: 'POST',
      headers: { 'X-Layout-Token': token, 'Content-Type': 'application/json', Origin: app.editorOrigin },
      body: JSON.stringify({ intent }),
    });
    assert.equal(intentRes.status, 200);
    const intentBody = (await intentRes.json()).value;
    assert.equal(intentBody.path, '.web-layout/intent.json');
    assert.ok(intentBody.warnings.find((w) => w.class === 'hero'));
    const written = JSON.parse(await fs.readFile(path.join(root, '.web-layout', 'intent.json'), 'utf8'));
    assert.equal(written.context.manifestStatus, 'ok');

    const runtime = await fetch(app.previewOrigin + '/__layout/constants.js');
    assert.equal(runtime.status, 200);
    assert.match(await runtime.text(), /PALETTE/);

    assert.equal((await fetch(app.previewOrigin + '/../secret')).status, 404);
    assert.equal((await fetch(app.previewOrigin + '/.git/config')).status, 404);

    const shutdown = await fetch(app.editorOrigin + '/api/shutdown', {
      method: 'POST',
      headers: { 'X-Layout-Token': token, Origin: app.editorOrigin },
    });
    assert.equal(shutdown.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(closed, true);
  } finally {
    await app.close();
  }
});

test('editor file server serves runtime assets', async () => {
  const root = await fixture();
  const app = await createApp({ root, page: 'index.html', editorPort: 0, previewPort: 0, idleMinutes: 0 });
  try {
    const res = await fetch(app.editorOrigin + '/runtime/constants.js', { headers: { Connection: 'close' } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/javascript/);
    assert.ok((await res.text()).length > 0);
  } finally {
    await app.close();
  }
});

test('API guards reject a wrong origin and an invalid manifest', async () => {
  const root = await fixture();
  const app = await createApp({ root, page: 'index.html', editorPort: 0, previewPort: 0, idleMinutes: 0 });
  try {
    const token = app.config.editorToken;

    const manifestRes = await fetch(app.editorOrigin + '/api/manifest?page=index.html', {
      method: 'PUT',
      headers: { 'X-Layout-Token': token, 'Content-Type': 'application/json', Origin: app.editorOrigin },
      body: '{}',
    });
    assert.equal(manifestRes.status, 400);
    assert.equal((await manifestRes.json()).error.code, 'E_MANIFEST_INVALID');

    const intentRes = await fetch(app.editorOrigin + '/api/intent', {
      method: 'POST',
      headers: { 'X-Layout-Token': token, 'Content-Type': 'application/json', Origin: 'http://evil.example' },
      body: JSON.stringify({ intent: {} }),
    });
    assert.equal(intentRes.status, 403);
  } finally {
    await app.close();
  }
});

test('createApp rejects a root that does not exist or is not a directory', async () => {
  const missing = path.join(os.tmpdir(), 'wl-missing-' + process.pid + '-' + Date.now());
  await assert.rejects(
    () => createApp({ root: missing, page: 'index.html', editorPort: 0, previewPort: 0, idleMinutes: 0 }),
    (error) => error && error.code === 'E_USAGE',
  );

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wl-file-root-'));
  const file = path.join(dir, 'root.txt');
  await fs.writeFile(file, 'not a directory');
  await assert.rejects(
    () => createApp({ root: file, page: 'index.html', editorPort: 0, previewPort: 0, idleMinutes: 0 }),
    (error) => error && error.code === 'E_USAGE',
  );
});
