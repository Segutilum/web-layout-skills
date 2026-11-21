import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  validateIntent,
  collectSharedClassWarnings,
  writeIntentAtomic,
  intentPath,
} from '../scripts/lib/intent.mjs';

const SOURCE = 'sha256:' + 'a'.repeat(64);
const STYLE = 'sha256:' + 'b'.repeat(64);

function manifest() {
  return {
    schema: 1,
    page: 'index.html',
    sourceVersion: SOURCE,
    modules: [
      { id: 'header', role: 'header', label: 'Header', ref: 'header', matchIndex: 0, tag: 'header', classes: 'site-header', text: 'H', fingerprint: 'header|site-header|H', container: false, layout: 'flow' },
      { id: 'hero', role: 'hero', label: 'Hero', ref: 'section.hero', matchIndex: 0, tag: 'section', classes: 'hero', text: 'Hero', fingerprint: 'section|hero|Hero', container: true, layout: 'column', children: [
        { id: 'hero-title', role: 'heading', label: 'Title', ref: 'section.hero h2', matchIndex: 0, tag: 'h2', classes: '', text: 'Hero', fingerprint: 'h2||Hero', container: false, layout: 'flow' },
      ] },
      { id: 'features', role: 'section', label: 'Features', ref: 'section.features', matchIndex: 0, tag: 'section', classes: 'features', text: 'F', fingerprint: 'section|features|F', container: false, layout: 'flow' },
      { id: 'footer', role: 'footer', label: 'Footer', ref: 'footer', matchIndex: 0, tag: 'footer', classes: 'site-footer', text: 'F', fingerprint: 'footer|site-footer|F', container: false, layout: 'flow' },
    ],
  };
}

function validIntent() {
  return {
    schema: 1,
    kind: 'web-layout-intent',
    page: 'index.html',
    sourceVersion: SOURCE,
    styleVersion: STYLE,
    globalNote: 'Tighter spacing',
    changes: {
      moved: [{ module: 'hero', from: { parent: '__root__', index: 1 }, to: { parent: '__root__', index: 2 } }],
      added: [{ id: 'new-1', type: 'heading', label: 'Quote', note: 'Two lines', parent: 'hero', index: 1 }],
      removed: [{ module: 'features', ref: 'section.features' }],
    },
    modules: [{ id: 'hero', ref: 'section.hero', note: 'Less padding', width: 'full', align: 'start' }],
    tree: [{ id: '__root__', children: [
      { id: 'header' },
      { id: 'hero', children: [{ id: 'hero-title' }, { id: 'new-1' }] },
      { id: 'footer' },
    ] }],
  };
}

test('a valid intent passes', () => {
  const result = validateIntent(validIntent(), { manifest: manifest(), sourceVersion: SOURCE, styleVersion: STYLE });
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('empty changes, stale versions, and bad pages fail', () => {
  const empty = validIntent();
  empty.changes = { moved: [], added: [], removed: [] };
  empty.modules = [];
  empty.globalNote = '';
  assert.ok(validateIntent(empty, { manifest: manifest(), sourceVersion: SOURCE, styleVersion: STYLE }).errors.some((e) => e.code === 'E_EMPTY_CHANGES'));
  assert.equal(validateIntent(validIntent(), { manifest: manifest(), sourceVersion: 'sha256:' + 'c'.repeat(64), styleVersion: STYLE }).errors[0].code, 'E_STALE_SOURCE');
  assert.equal(validateIntent(validIntent(), { manifest: { ...manifest(), page: 'about.html' }, sourceVersion: SOURCE, styleVersion: STYLE }).errors[0].code, 'E_PAGE_MISMATCH');
});

test('duplicate ids, missing modules, and non-container parents fail', () => {
  const duplicate = validIntent();
  duplicate.tree[0].children.push({ id: 'hero' });
  assert.equal(validateIntent(duplicate, { manifest: manifest(), sourceVersion: SOURCE, styleVersion: STYLE }).ok, false);

  const missing = validIntent();
  missing.tree[0].children = missing.tree[0].children.filter((node) => node.id !== 'footer');
  assert.equal(validateIntent(missing, { manifest: manifest(), sourceVersion: SOURCE, styleVersion: STYLE }).ok, false);

  const leafParent = validIntent();
  leafParent.changes.removed = [];
  leafParent.changes.added[0].parent = 'features';
  leafParent.tree = [{ id: '__root__', children: [
    { id: 'header' }, { id: 'features', children: [{ id: 'new-1' }] }, { id: 'hero' }, { id: 'footer' },
  ] }];
  assert.equal(validateIntent(leafParent, { manifest: manifest(), sourceVersion: SOURCE, styleVersion: STYLE }).ok, false);
});

test('a removed module inside a collapsed parent is rejected', () => {
  const intent = validIntent();
  intent.changes.added = [];
  intent.changes.removed = [{ module: 'hero-title' }];
  intent.tree = [{ id: '__root__', children: [
    { id: 'header' },
    { id: 'hero' },
    { id: 'features' },
    { id: 'footer' },
  ] }];
  const result = validateIntent(intent, { manifest: manifest(), sourceVersion: SOURCE, styleVersion: STYLE });
  assert.equal(result.ok, false);
});

test('shared class warnings name other pages', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wl-intent-'));
  await fs.writeFile(path.join(root, 'index.html'), '<html></html>');
  await fs.writeFile(path.join(root, 'about.html'), '<section class="hero">About</section>');
  const warnings = await collectSharedClassWarnings(root, 'index.html', manifest(), validIntent());
  assert.deepEqual(warnings.find((item) => item.class === 'hero').pages, ['about.html']);
});

test('writeIntentAtomic writes the fixed path', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wl-intent-'));
  const intent = validIntent();
  const written = await writeIntentAtomic(root, intent);
  assert.equal(written, intentPath(root));
  const parsed = JSON.parse(await fs.readFile(written, 'utf8'));
  assert.equal(parsed.kind, 'web-layout-intent');
  assert.ok(parsed.submittedAt);
});
