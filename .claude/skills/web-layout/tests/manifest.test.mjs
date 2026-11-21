import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  validateManifest,
  loadManifest,
  saveManifest,
  applyEditorManifest,
  manifestPath,
} from '../scripts/lib/manifest.mjs';
import { ensureLayoutDir } from '../scripts/lib/layout-dir.mjs';

const SOURCE = 'sha256:' + 'a'.repeat(64);

function validManifest() {
  return {
    schema: 1,
    page: 'index.html',
    generatedBy: 'agent',
    sourceVersion: SOURCE,
    stylesheets: ['styles.css'],
    modules: [{
      id: 'hero',
      role: 'hero',
      label: 'Hero',
      ref: 'section.hero',
      matchIndex: 0,
      tag: 'section',
      classes: 'hero',
      text: 'Hero text',
      fingerprint: 'section|hero|Hero text',
      container: true,
      layout: 'grid-2col',
      children: [{
        id: 'hero-title',
        role: 'heading',
        label: 'Title',
        ref: 'section.hero h2',
        matchIndex: 0,
        tag: 'h2',
        classes: '',
        text: 'Hero',
        fingerprint: 'h2||Hero',
        container: false,
        layout: 'flow',
      }],
    }],
  };
}

test('a valid manifest passes', () => {
  assert.deepEqual(validateManifest(validManifest()), { ok: true, errors: [] });
});

test('invalid enums, duplicate ids, depth, and leaf children fail', () => {
  const badRole = validManifest();
  badRole.modules[0].role = 'banner';
  assert.equal(validateManifest(badRole).ok, false);

  const duplicate = validManifest();
  duplicate.modules[0].children[0].id = 'hero';
  assert.equal(validateManifest(duplicate).ok, false);

  const tooDeep = validManifest();
  tooDeep.modules[0].children[0].container = true;
  tooDeep.modules[0].children[0].layout = 'column';
  tooDeep.modules[0].children[0].children = [{
    id: 'deep-3', role: 'container', label: 'Deep 3', ref: 'div.d3', matchIndex: 0,
    tag: 'div', classes: 'd3', text: 'd3', fingerprint: 'div|d3|d3', container: true,
    layout: 'column', children: [{
      id: 'deep-4', role: 'paragraph', label: 'Deep 4', ref: 'p.d4', matchIndex: 0,
      tag: 'p', classes: 'd4', text: 'd4', fingerprint: 'p|d4|d4', container: false, layout: 'flow',
    }],
  }];
  assert.equal(validateManifest(tooDeep).ok, false);

  const leafChildren = validManifest();
  leafChildren.modules[0].children[0].children = [];
  assert.equal(validateManifest(leafChildren).ok, false);
});

test('loadManifest reports missing, invalid, stale, and ok', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wl-manifest-'));
  assert.equal((await loadManifest(root, 'index.html', SOURCE)).status, 'missing');

  await ensureLayoutDir(root);
  await fs.writeFile(manifestPath(root, 'index.html'), '{bad json');
  assert.equal((await loadManifest(root, 'index.html', SOURCE)).status, 'invalid');

  const manifest = validManifest();
  await fs.writeFile(manifestPath(root, 'index.html'), JSON.stringify(manifest));
  assert.equal((await loadManifest(root, 'index.html', SOURCE)).status, 'ok');
  assert.equal((await loadManifest(root, 'index.html', 'sha256:' + 'b'.repeat(64))).status, 'stale');
});

test('saveManifest writes atomically and preserves unknown fields', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wl-manifest-'));
  const manifest = validManifest();
  manifest.unknownTop = { keep: true };
  manifest.modules[0].unknownModule = 'keep';
  const saved = await saveManifest(root, 'index.html', manifest, { sourceVersion: SOURCE });
  assert.equal(saved.unknownTop.keep, true);
  assert.equal(saved.modules[0].unknownModule, 'keep');
  assert.equal(saved.page, 'index.html');
  assert.equal(saved.sourceVersion, SOURCE);
  const text = await fs.readFile(manifestPath(root, 'index.html'), 'utf8');
  assert.equal(JSON.parse(text).modules[0].id, 'hero');
});

test('applyEditorManifest keeps unknown fields and marks the editor', () => {
  const existing = validManifest();
  existing.unknownTop = 'keep';
  existing.modules[0].unknownModule = 'keep';
  const incoming = validManifest();
  incoming.modules[0].label = 'Renamed hero';
  const merged = applyEditorManifest(existing, incoming, { sourceVersion: SOURCE });
  assert.equal(merged.unknownTop, 'keep');
  assert.equal(merged.modules[0].unknownModule, 'keep');
  assert.equal(merged.modules[0].label, 'Renamed hero');
  assert.equal(merged.generatedBy, 'editor');
});

test('ensureLayoutDir writes the gitignore once', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wl-manifest-'));
  await ensureLayoutDir(root);
  const ignore = await fs.readFile(path.join(root, '.web-layout', '.gitignore'), 'utf8');
  assert.equal(ignore, 'server.json\nintent.json\nhistory/\n');
});
