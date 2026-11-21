import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  linkedStylesheets,
  sourceVersion,
  styleVersion,
} from '../scripts/lib/version.mjs';

async function tempSite() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wl-version-'));
  await fs.writeFile(path.join(root, 'index.html'), [
    '<!doctype html><html><head>',
    '<link rel="stylesheet" href="styles.css" />',
    '<style>.x { color: red; }</style>',
    '</head><body></body></html>',
  ].join(''));
  await fs.writeFile(path.join(root, 'styles.css'), '.hero { color: blue; }');
  return root;
}

test('linkedStylesheets resolves local links and ignores remote ones', () => {
  const html = [
    '<link rel="stylesheet" href="styles.css">',
    '<link rel="preload stylesheet" href="/shared/base.css?v=2">',
    '<link rel="stylesheet" href="https://cdn.example/x.css">',
    '<link rel="icon" href="favicon.ico">',
  ].join('');
  assert.deepEqual(linkedStylesheets(html, 'about/team.html'), ['about/styles.css', 'shared/base.css']);
});

test('sourceVersion changes when HTML changes', async () => {
  const root = await tempSite();
  const before = await sourceVersion(root, 'index.html');
  await fs.appendFile(path.join(root, 'index.html'), '<!-- change -->');
  const after = await sourceVersion(root, 'index.html');
  assert.match(before, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(before, after);
});

test('styleVersion changes when a linked CSS file changes', async () => {
  const root = await tempSite();
  const before = await styleVersion(root, 'index.html');
  await fs.writeFile(path.join(root, 'styles.css'), '.hero { color: green; }');
  const after = await styleVersion(root, 'index.html');
  assert.notEqual(before, after);
});

test('styleVersion changes when inline CSS changes', async () => {
  const root = await tempSite();
  const before = await styleVersion(root, 'index.html');
  const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
  await fs.writeFile(path.join(root, 'index.html'), html.replace('red', 'purple'));
  const after = await styleVersion(root, 'index.html');
  assert.notEqual(before, after);
});

test('a missing stylesheet is stable and non-fatal', async () => {
  const root = await tempSite();
  const html = '<link rel="stylesheet" href="missing.css">';
  const first = await styleVersion(root, 'index.html', html);
  const second = await styleVersion(root, 'index.html', html);
  assert.equal(first, second);
  assert.match(first, /^sha256:[0-9a-f]{64}$/);
});
