import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  slugForPage,
  resolveRelativePath,
  resolveInsideRoot,
  discoverPages,
} from '../scripts/lib/paths.mjs';

async function tempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wl-paths-'));
  await fs.mkdir(path.join(root, '.hidden'));
  await fs.writeFile(path.join(root, 'index.html'), '<html></html>');
  await fs.writeFile(path.join(root, 'about.html'), '<html></html>');
  await fs.writeFile(path.join(root, '.hidden', 'secret.txt'), 'x');
  await fs.mkdir(path.join(root, 'sub'));
  await fs.writeFile(path.join(root, 'sub', 'team.html'), '<html></html>');
  return root;
}

test('slugForPage turns a path into a safe slug', () => {
  assert.equal(slugForPage('index.html'), 'index');
  assert.equal(slugForPage('about/team.html'), 'about__team');
  assert.equal(slugForPage('/a/b.htm'), 'a__b');
});

test('resolveRelativePath handles queries, schemes, and traversal', () => {
  assert.equal(resolveRelativePath('about/team.html', '../styles.css'), 'styles.css');
  assert.equal(resolveRelativePath('index.html', 'styles.css?v=1'), 'styles.css');
  assert.equal(resolveRelativePath('index.html', 'https://x/y.css'), null);
  assert.equal(resolveRelativePath('index.html', '//cdn/x.css'), null);
  assert.equal(resolveRelativePath('index.html', '#top'), null);
  assert.equal(resolveRelativePath('a/b.html', '../../secret'), 'secret');
});

test('resolveInsideRoot serves inside and rejects escapes', async () => {
  const root = await tempRoot();
  assert.ok(await resolveInsideRoot(root, '/index.html'));
  assert.equal(await resolveInsideRoot(root, '/../secret'), null);
  assert.equal(await resolveInsideRoot(root, '/%2e%2e/secret'), null);
  assert.equal(await resolveInsideRoot(root, '/%2E%2E%2Fsecret'), null);
  assert.equal(await resolveInsideRoot(root, '/.hidden/secret.txt'), null);
  assert.equal(await resolveInsideRoot(root, '/nope.html'), null);
});

test('resolveInsideRoot rejects a symlink escape', async (t) => {
  const root = await tempRoot();
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'wl-out-'));
  await fs.writeFile(path.join(outside, 'secret.txt'), 'x');
  try {
    await fs.symlink(outside, path.join(root, 'link'), 'junction');
  } catch {
    t.skip('symlinks unavailable');
    return;
  }
  assert.equal(await resolveInsideRoot(root, '/link/secret.txt'), null);
});

test('discoverPages skips hidden dirs and node_modules', async () => {
  const root = await tempRoot();
  await fs.mkdir(path.join(root, 'node_modules'));
  await fs.writeFile(path.join(root, 'node_modules', 'x.html'), '<html></html>');
  assert.deepEqual(await discoverPages(root), ['about.html', 'index.html', 'sub/team.html']);
});
