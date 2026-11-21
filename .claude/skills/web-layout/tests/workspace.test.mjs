import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWorkspace } from '../scripts/lib/workspace.mjs';
import { saveManifest } from '../scripts/lib/manifest.mjs';
import { sourceVersion, styleVersion } from '../scripts/lib/version.mjs';

async function fixture() {
  const source = path.resolve('.claude/skills/web-layout/tests/fixtures/site');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wl-workspace-'));
  await fs.cp(source, root, { recursive: true });
  return root;
}

function manifest(root, sourceVersionValue) {
  return {
    schema: 1,
    page: 'index.html',
    generatedBy: 'agent',
    sourceVersion: sourceVersionValue,
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

test('state reports pages, versions, and manifest status', async () => {
  const root = await fixture();
  const ws = createWorkspace({ root });
  const before = await ws.state('index.html');
  assert.deepEqual(before.pages, ['about.html', 'index.html']);
  assert.equal(before.manifestStatus, 'missing');
  assert.match(before.sourceVersion, /^sha256:/);
  assert.match(before.styleVersion, /^sha256:/);
  assert.deepEqual(before.stylesheets, ['styles.css']);
  const src = await sourceVersion(root, 'index.html');
  await saveManifest(root, 'index.html', manifest(root, src), { sourceVersion: src });
  const after = await ws.state('index.html');
  assert.equal(after.manifestStatus, 'ok');
  assert.equal(after.manifest.modules.length, 4);
});

test('saveEditorManifest preserves unknown fields and updates the version', async () => {
  const root = await fixture();
  const ws = createWorkspace({ root });
  const src = await sourceVersion(root, 'index.html');
  await saveManifest(root, 'index.html', { ...manifest(root, src), unknownTop: 'keep' }, { sourceVersion: src });
  const incoming = { ...manifest(root, src), modules: manifest(root, src).modules.map((m) => ({ ...m, label: m.id === 'hero' ? 'Renamed' : m.label })) };
  const saved = await ws.saveEditorManifest('index.html', incoming);
  assert.equal(saved.unknownTop, 'keep');
  assert.equal(saved.generatedBy, 'editor');
  assert.equal(saved.modules.find((m) => m.id === 'hero').label, 'Renamed');
});

test('submitIntent validates, fills context, and writes the intent', async () => {
  const root = await fixture();
  const ws = createWorkspace({ root });
  const src = await sourceVersion(root, 'index.html');
  const style = await styleVersion(root, 'index.html');
  await saveManifest(root, 'index.html', manifest(root, src), { sourceVersion: src });
  const intent = {
    schema: 1,
    kind: 'web-layout-intent',
    page: 'index.html',
    sourceVersion: src,
    styleVersion: style,
    globalNote: 'Tighter',
    changes: { moved: [{ module: 'hero', to: { parent: '__root__', index: 2 } }], added: [], removed: [] },
    modules: [{ id: 'hero', ref: 'section.hero', note: 'Less padding' }],
    tree: [{ id: '__root__', children: [
      { id: 'site-header' }, { id: 'features' }, { id: 'hero' }, { id: 'site-footer' },
    ] }],
  };
  const result = await ws.submitIntent(intent);
  assert.equal(result.path, '.web-layout/intent.json');
  assert.equal(result.intent.context.manifestStatus, 'ok');
  assert.deepEqual(result.intent.context.stylesheets, ['styles.css']);
  assert.deepEqual(result.intent.context.sharedClassWarnings.find((w) => w.class === 'hero').pages, ['about.html']);
  const written = JSON.parse(await fs.readFile(path.join(root, '.web-layout', 'intent.json'), 'utf8'));
  assert.equal(written.globalNote, 'Tighter');
});

test('submitIntent rejects stale versions and missing manifests', async () => {
  const root = await fixture();
  const ws = createWorkspace({ root });
  const intent = {
    schema: 1, kind: 'web-layout-intent', page: 'index.html',
    sourceVersion: 'sha256:' + 'a'.repeat(64), styleVersion: 'sha256:' + 'b'.repeat(64),
    changes: { moved: [], added: [], removed: [] }, modules: [], tree: [{ id: '__root__', children: [] }],
  };
  await assert.rejects(() => ws.submitIntent(intent), (error) => error.code === 'E_MANIFEST');
  const src = await sourceVersion(root, 'index.html');
  const style = await styleVersion(root, 'index.html');
  await saveManifest(root, 'index.html', manifest(root, src), { sourceVersion: src });
  await assert.rejects(
    () => ws.submitIntent({ ...intent, sourceVersion: src, styleVersion: style }),
    (error) => error.code === 'E_TREE_INVALID' || error.code === 'E_EMPTY_CHANGES' || error.code === 'E_STALE_SOURCE',
  );
});
