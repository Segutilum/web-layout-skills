# Web Layout Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Claude Code skill that launches a local visual layout editor for static sites, captures a module tree plus per-module notes as an intent file, and lets the agent apply that intent to HTML/CSS.

**Architecture:** One zero-dependency Node process runs two loopback HTTP listeners. P1 serves the editor UI and API; P2 serves the real static site with an injected ES-module runtime. The agent pre-generates a manifest, the runtime overlays modules and posts a tree back, the editor submits an intent, and the agent applies it and regenerates the manifest.

**Tech Stack:** Node ≥ 20 built-ins (`node:http`, `node:fs`, `node:crypto`, `node:path`, `node:url`, `node:util`), browser ES modules, vanilla DOM/CSS, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-21-web-layout-skill-design.md`

## Global Constraints

- Node ≥ 20; zero third-party npm dependencies in the skill runtime and editor.
- Bind only `127.0.0.1`; P1 (editor/API) and P2 (site preview) are separate origins.
- The editor and server never write site source; they write only under `<root>/.web-layout/`.
- One page per handoff; the intent path is fixed at `.web-layout/intent.json`.
- All sidecar writes are atomic (temp file + rename): intent, manifest, `server.json`.
- Limits: HTTP body 2 MiB; static file 64 MiB; HTML injection 10 MiB; modules ≤ 300; per-module note ≤ 4000 chars; global note ≤ 8000 chars.
- The editor token lives in the URL fragment; API requests use `X-Layout-Token`; `PUT`/`POST` require an exact `Origin` match.
- `.web-layout/.gitignore` contains `server.json`, `intent.json`, `history/`.
- History filenames use `YYYYMMDDTHHmmssZ`, never colons (Windows compatibility).
- All paths and filenames must work on Windows; tests run on win32.
- Git: this workspace is **not** a git repository. Before Task 1, ask the user to authorize `git init` plus an initial commit of the spec. If not authorized, skip every commit step and report the changed file list instead. Do not commit `demo/` or `html-layout/` unless the user asks.
- Implementation clarifications relative to the spec: the server rejects a missing/invalid manifest at submit with `E_MANIFEST`; the runtime `tree` message carries `moved[]`; the runtime `ready` message carries `manifest` when it used the heuristic fallback; the editor URL includes `?page=<page>`; before submit the editor persists the effective heuristic manifest.

## Review Focus

1. Encoded traversal, symlink escape, and hidden files: `/..`, `%2e%2e`, backslashes, `.git`, `.env` must 404 and never escape the root. Pinned in Task 1 and Task 6.
2. Stale source/style versions and selector drift: submission/apply must stop with `E_STALE_*` or unresolved modules, never apply to a changed page. Pinned in Task 2, Task 4, Task 5.
3. Collapsed-tree intent semantics: omitted `children` means "unchanged"; a listed `children` is complete; a removed node must be absent; a missing node in a listed layer is an error. Pinned in Task 4.
4. Shared CSS across pages: `sharedClassWarnings` must name the other page for a shared class token. Pinned in Task 4 and Task 5.
5. Token/Origin/postMessage spoofing: API returns 403 on a missing/wrong token or origin; the editor ignores messages with the wrong source, origin, or runtime token. Pinned in Task 7, Task 8, Task 9.

## File Structure

```
.claude/skills/web-layout/
├── SKILL.md
├── scripts/
│   ├── server.mjs
│   └── lib/
│       ├── paths.mjs          page slugs, relative resolution, path safety, page discovery
│       ├── layout-dir.mjs     .web-layout dirs, .gitignore, atomic JSON writes
│       ├── version.mjs        source/style hashing
│       ├── manifest.mjs       manifest validation/load/save/editor merge
│       ├── intent.mjs         intent validation, expansion, shared-class warnings, atomic write
│       ├── workspace.mjs      per-page state assembled from the modules above
│       ├── inject.mjs         preview HTML injection
│       ├── static.mjs         static file serving, MIME, size limits
│       ├── http.mjs           JSON bodies, token/origin guards, response helpers
│       ├── config.mjs         CLI parsing, tokens, server.json lifecycle
│       ├── api.mjs            /api/* router
│       └── app.mjs            two listeners and lifecycle
├── editor/
│   ├── index.html
│   ├── editor.css
│   ├── editor.js              editor orchestration and iframe handshake
│   ├── api.js                 token-bearing fetch wrapper
│   ├── state.js               pure editor state, validation, intent builder
│   ├── inspector.js           selected-module inspector and notes
│   └── runtime/
│       ├── constants.js       palette types, container types, shared enums
│       ├── model.js           pure roles/layout/fingerprint/insertion/segmentation
│       ├── runtime.js         injected entry: boot, protocol, orchestration
│       ├── dom.js             DOM descriptor adapter and manifest matching
│       ├── overlay.js         Shadow DOM overlay
│       ├── drag.js            pointer drag, insertion line, DOM moves
│       └── palette-drop.js    HTML5 drop and placeholder modules
├── references/
│   ├── manifest-schema.md
│   ├── intent-schema.md
│   └── apply-playbook.md
└── tests/
    ├── fixtures/site/index.html
    ├── fixtures/site/about.html
    ├── fixtures/site/styles.css
    ├── paths.test.mjs
    ├── version.test.mjs
    ├── manifest.test.mjs
    ├── intent.test.mjs
    ├── workspace.test.mjs
    ├── inject.test.mjs
    ├── static.test.mjs
    ├── http.test.mjs
    ├── server.test.mjs
    ├── state.test.mjs
    ├── model.test.mjs
    ├── skill-doc.test.mjs
    └── smoke.md
```

---

### Task 1: Skill scaffold, fixture site, path safety

**Files:**
- Create: `.claude/skills/web-layout/scripts/lib/paths.mjs`
- Create: `.claude/skills/web-layout/tests/fixtures/site/index.html`
- Create: `.claude/skills/web-layout/tests/fixtures/site/about.html`
- Create: `.claude/skills/web-layout/tests/fixtures/site/styles.css`
- Create: `.claude/skills/web-layout/tests/paths.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `slugForPage(page)`, `resolveRelativePath(basePage, href)`, `resolveInsideRoot(root, urlPath)`, `discoverPages(root)`, `normalizeRel(value)`, `isHiddenSegment(segment)`.

- [ ] **Step 0: Confirm git authorization**

Ask the user whether to run `git init` (plus an initial commit of the spec) in this workspace. If they decline, keep the repo as-is and replace every later commit step with "report changed files". Do not initialize or commit without this approval.

- [ ] **Step 1: Create the fixture site**

`tests/fixtures/site/index.html`:
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Fixture home</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header class="site-header" data-module="site-header"><h1>Fixture</h1></header>
  <main>
    <section class="hero" data-module="hero">
      <h2>Hero</h2>
      <p>Hello from the fixture.</p>
    </section>
    <section class="features" data-module="features"><h2>Features</h2></section>
  </main>
  <footer class="site-footer" data-module="site-footer"><p>Footer</p></footer>
</body>
</html>
```

`tests/fixtures/site/about.html`:
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Fixture about</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header class="site-header" data-module="site-header"><h1>About</h1></header>
  <main><section class="hero" data-module="hero"><h2>About hero</h2></section></main>
</body>
</html>
```

`tests/fixtures/site/styles.css`:
```css
.hero { padding: 40px 0; }
.features { padding: 24px 0; }
.site-footer { border-top: 1px solid #ddd; }
```

- [ ] **Step 2: Write the failing path tests**

`tests/paths.test.mjs`:
```js
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test .claude/skills/web-layout/tests/paths.test.mjs`
Expected: FAIL with `Cannot find module '../scripts/lib/paths.mjs'`.

- [ ] **Step 4: Implement `paths.mjs`**

```js
import path from 'node:path';
import fs from 'node:fs/promises';

export function normalizeRel(value) {
  return String(value || '').replace(/\\/g, '/');
}

export function isHiddenSegment(segment) {
  return segment.startsWith('.');
}

export function slugForPage(page) {
  const rel = normalizeRel(page).replace(/^\/+/, '');
  return rel.replace(/\.html?$/i, '').replace(/\//g, '__');
}

export function resolveRelativePath(basePage, href) {
  if (!href) return null;
  const raw = String(href).trim();
  if (!raw || raw.startsWith('#') || raw.startsWith('//')) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
  const clean = raw.split('#')[0].split('?')[0];
  if (!clean) return null;
  const base = normalizeRel(basePage);
  const slash = base.lastIndexOf('/');
  const dir = slash >= 0 ? base.slice(0, slash + 1) : '';
  const segments = (clean.startsWith('/') ? clean : dir + clean).split('/');
  const out = [];
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (out.length) out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join('/') || null;
}

export async function resolveInsideRoot(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(urlPath || '/'));
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const rel = normalizeRel(decoded).replace(/^\/+/, '');
  const segments = rel.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '..' || isHiddenSegment(segment))) return null;
  const rootAbs = path.resolve(root);
  const abs = path.resolve(rootAbs, ...segments);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return null;
  try {
    const realRoot = await fs.realpath(rootAbs);
    const realAbs = await fs.realpath(abs);
    if (realAbs !== realRoot && !realAbs.startsWith(realRoot + path.sep)) return null;
    return realAbs;
  } catch {
    return null;
  }
}

export async function discoverPages(root) {
  const out = [];
  async function walk(dir, rel, depth) {
    if (depth > 6 || out.length >= 500) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (out.length >= 500) return;
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const childRel = rel ? rel + '/' + entry.name : entry.name;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), childRel, depth + 1);
      else if (entry.isFile() && /\.html?$/i.test(entry.name)) out.push(childRel);
    }
  }
  await walk(path.resolve(root), '', 0);
  return out;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test .claude/skills/web-layout/tests/paths.test.mjs`
Expected: PASS, 5 tests (symlink test may be SKIP on a locked-down Windows account).

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/web-layout/scripts/lib/paths.mjs .claude/skills/web-layout/tests/paths.test.mjs .claude/skills/web-layout/tests/fixtures/site
git commit -m "feat(web-layout): add path safety and page discovery"
```

---

### Task 2: Source and style version hashing

**Files:**
- Create: `.claude/skills/web-layout/scripts/lib/version.mjs`
- Create: `.claude/skills/web-layout/tests/version.test.mjs`

**Interfaces:**
- Consumes: `resolveRelativePath` from `./paths.mjs`.
- Produces: `sha256File(absPath)` → `Promise<"sha256:<hex>">`, `linkedStylesheets(html, page)` → `string[]`, `inlineStyles(html)` → `string`, `sourceVersion(root, page)` → `Promise<string>`, `styleVersion(root, page, html?)` → `Promise<string>`.

- [ ] **Step 1: Write the failing tests**

`tests/version.test.mjs`:
```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test .claude/skills/web-layout/tests/version.test.mjs`
Expected: FAIL with `Cannot find module '../scripts/lib/version.mjs'`.

- [ ] **Step 3: Implement `version.mjs`**

```js
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveRelativePath } from './paths.mjs';

function sha256Text(text) {
  return 'sha256:' + crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export async function sha256File(absPath) {
  const bytes = await fs.readFile(absPath);
  return 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex');
}

export function linkedStylesheets(html, page) {
  const out = [];
  const tags = String(html).match(/<link\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if (!/\brel\s*=\s*["']?[^"'>]*stylesheet/i.test(tag)) continue;
    const match = tag.match(/\bhref\s*=\s*["']?([^"'\s>]+)/i);
    if (!match) continue;
    const rel = resolveRelativePath(page, match[1]);
    if (rel) out.push(rel);
  }
  return [...new Set(out)];
}

export function inlineStyles(html) {
  const blocks = String(html).match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) || [];
  return blocks
    .map((block) => block.replace(/^<style\b[^>]*>/i, '').replace(/<\/style>$/i, ''))
    .join('\n');
}

export async function sourceVersion(root, page) {
  return sha256File(path.join(root, page));
}

export async function styleVersion(root, page, html) {
  const doc = html === undefined ? await fs.readFile(path.join(root, page), 'utf8') : html;
  const parts = [];
  for (const rel of linkedStylesheets(doc, page)) {
    try {
      parts.push(rel + ':' + (await sha256File(path.join(root, rel))));
    } catch {
      parts.push(rel + ':missing');
    }
  }
  const inline = inlineStyles(doc);
  if (inline.trim()) parts.push('inline:' + sha256Text(inline));
  parts.sort();
  return sha256Text(parts.join('\n'));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test .claude/skills/web-layout/tests/version.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/web-layout/scripts/lib/version.mjs .claude/skills/web-layout/tests/version.test.mjs
git commit -m "feat(web-layout): hash source and stylesheet versions"
```

---

### Task 3: Manifest validation, loading, saving, editor merge

**Files:**
- Create: `.claude/skills/web-layout/scripts/lib/layout-dir.mjs`
- Create: `.claude/skills/web-layout/scripts/lib/manifest.mjs`
- Create: `.claude/skills/web-layout/tests/manifest.test.mjs`

**Interfaces:**
- Consumes: `slugForPage` from `./paths.mjs`.
- Produces: `layoutDir(root)`, `pagesDir(root)`, `ensureLayoutDir(root)`, `writeJsonAtomic(absPath, value)`, `ROLES`, `LAYOUTS`, `flattenModules(modules)`, `validateManifest(manifest)`, `manifestPath(root, page)`, `loadManifest(root, page, liveSourceVersion)`, `saveManifest(root, page, manifest, {sourceVersion})`, `applyEditorManifest(existing, incoming, {sourceVersion})`.

- [ ] **Step 1: Write the failing tests**

`tests/manifest.test.mjs`:
```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test .claude/skills/web-layout/tests/manifest.test.mjs`
Expected: FAIL with `Cannot find module '../scripts/lib/manifest.mjs'`.

- [ ] **Step 3: Implement `layout-dir.mjs`**

```js
import path from 'node:path';
import fs from 'node:fs/promises';

export function layoutDir(root) {
  return path.join(root, '.web-layout');
}

export function pagesDir(root) {
  return path.join(layoutDir(root), 'pages');
}

export async function ensureLayoutDir(root) {
  await fs.mkdir(pagesDir(root), { recursive: true });
  const ignore = path.join(layoutDir(root), '.gitignore');
  try {
    await fs.access(ignore);
  } catch {
    await fs.writeFile(ignore, 'server.json\nintent.json\nhistory/\n');
  }
}

export async function writeJsonAtomic(absPath, value) {
  const dir = path.dirname(absPath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, '.' + path.basename(absPath) + '.' + process.pid + '.tmp');
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + '\n');
  await fs.rename(tmp, absPath);
}
```

- [ ] **Step 4: Implement `manifest.mjs`**

```js
import path from 'node:path';
import fs from 'node:fs/promises';
import { slugForPage } from './paths.mjs';
import { ensureLayoutDir, pagesDir, writeJsonAtomic } from './layout-dir.mjs';

export const ROLES = new Set([
  'header', 'nav', 'hero', 'section', 'article', 'aside', 'footer', 'form',
  'cards', 'list', 'table', 'heading', 'paragraph', 'image', 'button', 'link',
  'divider', 'container', 'block',
]);
export const LAYOUTS = new Set(['row', 'column', 'grid-2col', 'grid-3col', 'grid-4col', 'grid-auto', 'flow']);
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export function flattenModules(modules, out = new Map()) {
  for (const mod of modules || []) {
    out.set(mod.id, mod);
    if (Array.isArray(mod.children)) flattenModules(mod.children, out);
  }
  return out;
}

export function validateManifest(manifest) {
  const errors = [];
  const add = (message) => errors.push(message);
  if (!manifest || typeof manifest !== 'object') return { ok: false, errors: ['manifest must be an object'] };
  if (manifest.schema !== 1) add('schema must be 1');
  if (typeof manifest.page !== 'string' || !manifest.page) add('page must be a non-empty string');
  if (typeof manifest.sourceVersion !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(manifest.sourceVersion)) {
    add('sourceVersion must be sha256:<64 hex>');
  }
  if (manifest.stylesheets !== undefined
    && (!Array.isArray(manifest.stylesheets) || manifest.stylesheets.some((s) => typeof s !== 'string'))) {
    add('stylesheets must be a string array');
  }
  if (!Array.isArray(manifest.modules)) {
    add('modules must be an array');
    return { ok: false, errors };
  }

  const seen = new Set();
  let count = 0;
  const walk = (modules, depth) => {
    if (depth > 3) {
      add('module depth exceeds 3');
      return;
    }
    for (const mod of modules) {
      count += 1;
      if (count > 300) {
        add('module count exceeds 300');
        return;
      }
      if (!mod || typeof mod !== 'object') {
        add('module must be an object');
        continue;
      }
      if (typeof mod.id !== 'string' || !ID_RE.test(mod.id)) add('invalid module id: ' + mod.id);
      else if (seen.has(mod.id)) add('duplicate module id: ' + mod.id);
      else seen.add(mod.id);
      if (!ROLES.has(mod.role)) add('invalid role: ' + mod.id);
      if (typeof mod.label !== 'string' || mod.label.length > 40) add('label must be <= 40 chars: ' + mod.id);
      if (typeof mod.ref !== 'string' || !mod.ref) add('ref required: ' + mod.id);
      if (!Number.isInteger(mod.matchIndex) || mod.matchIndex < 0) add('matchIndex must be a non-negative integer: ' + mod.id);
      if (typeof mod.tag !== 'string' || !mod.tag) add('tag required: ' + mod.id);
      if (typeof mod.classes !== 'string') add('classes must be a string: ' + mod.id);
      if (typeof mod.text !== 'string' || mod.text.length > 80) add('text must be <= 80 chars: ' + mod.id);
      if (typeof mod.fingerprint !== 'string') add('fingerprint required: ' + mod.id);
      if (typeof mod.container !== 'boolean') add('container must be boolean: ' + mod.id);
      if (!LAYOUTS.has(mod.layout)) add('invalid layout: ' + mod.id);
      if (mod.children !== undefined) {
        if (!mod.container) add('leaf module has children: ' + mod.id);
        else if (!Array.isArray(mod.children)) add('children must be an array: ' + mod.id);
        else walk(mod.children, depth + 1);
      }
    }
  };
  walk(manifest.modules, 1);
  return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
}

export function manifestPath(root, page) {
  return path.join(pagesDir(root), slugForPage(page) + '.json');
}

export async function loadManifest(root, page, liveSourceVersion) {
  const file = manifestPath(root, page);
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch {
    return { status: 'missing', manifest: null, errors: [] };
  }
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (error) {
    return { status: 'invalid', manifest: null, errors: ['invalid JSON: ' + error.message] };
  }
  const result = validateManifest(manifest);
  if (!result.ok) return { status: 'invalid', manifest: null, errors: result.errors };
  if (manifest.page !== page) return { status: 'invalid', manifest: null, errors: ['page mismatch'] };
  if (liveSourceVersion && manifest.sourceVersion !== liveSourceVersion) {
    return { status: 'stale', manifest, errors: ['sourceVersion mismatch'] };
  }
  return { status: 'ok', manifest, errors: [] };
}

export async function saveManifest(root, page, manifest, { sourceVersion }) {
  await ensureLayoutDir(root);
  const next = {
    ...manifest,
    schema: 1,
    page,
    sourceVersion,
    generatedAt: new Date().toISOString(),
  };
  const result = validateManifest(next);
  if (!result.ok) {
    throw Object.assign(new Error(result.errors.join('; ')), {
      code: 'E_MANIFEST_INVALID',
      errors: result.errors,
    });
  }
  await writeJsonAtomic(manifestPath(root, page), next);
  return next;
}

export function applyEditorManifest(existing, incoming, { sourceVersion }) {
  const byId = flattenModules(existing?.modules);
  const mergeModule = (mod) => {
    const old = byId.get(mod.id) || {};
    const merged = { ...old, ...mod };
    delete merged.children;
    if (Array.isArray(mod.children)) merged.children = mod.children.map(mergeModule);
    return merged;
  };
  return {
    ...(existing && typeof existing === 'object' ? existing : {}),
    ...incoming,
    schema: 1,
    page: incoming.page,
    sourceVersion,
    generatedBy: incoming.generatedBy === 'editor-heuristic' ? 'editor-heuristic' : 'editor',
    modules: (incoming.modules || []).map(mergeModule),
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test .claude/skills/web-layout/tests/manifest.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/web-layout/scripts/lib/layout-dir.mjs .claude/skills/web-layout/scripts/lib/manifest.mjs .claude/skills/web-layout/tests/manifest.test.mjs
git commit -m "feat(web-layout): validate and persist module manifests"
```

---

### Task 4: Intent validation, tree expansion, shared-class warnings

**Files:**
- Create: `.claude/skills/web-layout/editor/runtime/constants.js`
- Create: `.claude/skills/web-layout/scripts/lib/intent.mjs`
- Create: `.claude/skills/web-layout/tests/intent.test.mjs`

**Interfaces:**
- Consumes: `flattenModules` from `./manifest.mjs`, `discoverPages` from `./paths.mjs`, `ensureLayoutDir`/`writeJsonAtomic`/`layoutDir` from `./layout-dir.mjs`, palette constants from `../../editor/runtime/constants.js`.
- Produces: `PALETTE`, `PALETTE_TYPES`, `CONTAINER_TYPES`, `intentPath(root)`, `validateIntent(intent, {manifest, sourceVersion, styleVersion})`, `collectSharedClassWarnings(root, page, manifest, intent)`, `writeIntentAtomic(root, intent)`.

- [ ] **Step 1: Create shared palette constants**

`editor/runtime/constants.js`:
```js
export const PALETTE = [
  { type: 'heading', label: '标题', container: false },
  { type: 'paragraph', label: '段落', container: false },
  { type: 'buttons', label: '按钮组', container: false },
  { type: 'image', label: '图片', container: false },
  { type: 'cards', label: '卡片组', container: false },
  { type: 'columns-2', label: '两栏', container: true },
  { type: 'columns-3', label: '三栏', container: true },
  { type: 'divider', label: '分隔线', container: false },
  { type: 'section', label: '区块', container: true },
];

export const PALETTE_TYPES = new Set(PALETTE.map((item) => item.type));
export const CONTAINER_TYPES = new Set(PALETTE.filter((item) => item.container).map((item) => item.type));
```

- [ ] **Step 2: Write the failing tests**

`tests/intent.test.mjs`:
```js
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test .claude/skills/web-layout/tests/intent.test.mjs`
Expected: FAIL with `Cannot find module '../scripts/lib/intent.mjs'`.

- [ ] **Step 4: Implement `intent.mjs`**

```js
import path from 'node:path';
import fs from 'node:fs/promises';
import { discoverPages } from './paths.mjs';
import { ensureLayoutDir, writeJsonAtomic, layoutDir } from './layout-dir.mjs';
import { flattenModules } from './manifest.mjs';
import { CONTAINER_TYPES, PALETTE_TYPES } from '../../editor/runtime/constants.js';

const WIDTHS = new Set(['auto', 'full', 'half', 'third', 'two-thirds']);
const ALIGNS = new Set(['start', 'center', 'end', 'stretch']);
const fail = (code, message) => ({ code, message });

export function intentPath(root) {
  return path.join(layoutDir(root), 'intent.json');
}

function buildParentMap(modules, map = new Map(), parent = '__root__') {
  for (const mod of modules || []) {
    map.set(mod.id, parent);
    if (Array.isArray(mod.children)) buildParentMap(mod.children, map, mod.id);
  }
  return map;
}

function findNode(nodes, id) {
  for (const node of nodes || []) {
    if (node.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return null;
}

function expandTree(tree, manifestIndex, added, removed) {
  const seen = new Set();
  const ids = [];
  const explicit = new Set(['__root__']);
  const walk = (node) => {
    if (!node || typeof node.id !== 'string') return;
    if (seen.has(node.id)) throw fail('E_TREE_INVALID', 'duplicate module in tree: ' + node.id);
    seen.add(node.id);
    ids.push(node.id);
    if (node.children !== undefined) explicit.add(node.id);
    const children = node.children !== undefined
      ? node.children
      : (manifestIndex.get(node.id)?.children || []).map((child) => ({ id: child.id }));
    for (const child of children) {
      if (removed.has(child.id)) continue;
      const parent = node.id;
      const isContainer = parent === '__root__'
        || manifestIndex.get(parent)?.container === true
        || CONTAINER_TYPES.has(added.get(parent)?.type);
      if (!isContainer) throw fail('E_TREE_INVALID', 'parent is not a container: ' + parent);
      walk(child);
    }
  };
  for (const rootNode of tree) walk(rootNode);
  return { ids, explicit };
}

export function validateIntent(intent, { manifest, sourceVersion, styleVersion }) {
  const errors = [];
  const add = (code, message) => errors.push(fail(code, message));
  if (!intent || typeof intent !== 'object') return { ok: false, errors: [fail('E_TREE_INVALID', 'intent must be an object')] };
  if (intent.schema !== 1) add('E_TREE_INVALID', 'schema must be 1');
  if (intent.kind !== 'web-layout-intent') add('E_TREE_INVALID', 'kind mismatch');
  if (intent.page !== manifest?.page) add('E_PAGE_MISMATCH', 'page mismatch');
  if (intent.sourceVersion !== sourceVersion) add('E_STALE_SOURCE', 'sourceVersion mismatch');
  if (intent.styleVersion !== styleVersion) add('E_STALE_STYLE', 'styleVersion mismatch');

  const changes = intent.changes || {};
  const addedArr = Array.isArray(changes.added) ? changes.added : [];
  const removedArr = Array.isArray(changes.removed) ? changes.removed : [];
  const movedArr = Array.isArray(changes.moved) ? changes.moved : [];
  const manifestIndex = flattenModules(manifest?.modules);
  const parentMap = buildParentMap(manifest?.modules);
  const added = new Map();
  for (const item of addedArr) {
    if (!item || typeof item.id !== 'string') {
      add('E_TREE_INVALID', 'added id missing');
      continue;
    }
    if (!PALETTE_TYPES.has(item.type)) add('E_TREE_INVALID', 'unknown added type: ' + item.type);
    if (manifestIndex.has(item.id)) add('E_TREE_INVALID', 'added id collides with manifest: ' + item.id);
    if (added.has(item.id)) add('E_TREE_INVALID', 'duplicate added id: ' + item.id);
    added.set(item.id, item);
  }
  const removed = new Set();
  for (const item of removedArr) {
    if (!item || !manifestIndex.has(item.module)) {
      add('E_TREE_INVALID', 'removed module not found: ' + (item && item.module));
      continue;
    }
    removed.add(item.module);
  }
  for (const item of movedArr) {
    if (!item || !manifestIndex.has(item.module)) add('E_TREE_INVALID', 'moved module not found: ' + (item && item.module));
  }
  if (!Array.isArray(intent.tree) || intent.tree.length !== 1 || intent.tree[0]?.id !== '__root__') {
    add('E_TREE_INVALID', 'tree must contain exactly one __root__');
  }

  let expanded = { ids: [], explicit: new Set() };
  try {
    expanded = expandTree(intent.tree || [], manifestIndex, added, removed);
  } catch (error) {
    if (error && error.code) errors.push(error);
    else add('E_TREE_INVALID', String(error && error.message ? error.message : error));
  }

  const expected = new Set([...manifestIndex.keys()].filter((id) => !removed.has(id)));
  for (const id of added.keys()) expected.add(id);
  const actual = new Set(expanded.ids);
  for (const id of expected) if (!actual.has(id)) add('E_TREE_INVALID', 'module missing from tree: ' + id);
  for (const id of actual) if (!expected.has(id)) add('E_TREE_INVALID', 'unexpected module in tree: ' + id);

  for (const id of removed) {
    const parent = parentMap.get(id);
    const node = findNode(intent.tree, parent);
    if (!node || node.children === undefined) add('E_TREE_INVALID', 'ancestor must be expanded for removed module: ' + id);
  }
  for (const item of movedArr) {
    const targetParent = item && item.to && item.to.parent;
    const node = findNode(intent.tree, targetParent);
    if (!node || node.children === undefined) add('E_TREE_INVALID', 'target parent must be expanded for moved module: ' + (item && item.module));
  }

  const empty = movedArr.length === 0
    && addedArr.length === 0
    && removedArr.length === 0
    && (intent.modules || []).length === 0
    && !String(intent.globalNote || '').trim();
  if (empty) add('E_EMPTY_CHANGES', 'no changes or notes');

  for (const mod of intent.modules || []) {
    if (!manifestIndex.has(mod.id)) add('E_TREE_INVALID', 'note module not found: ' + mod.id);
    if (typeof mod.note === 'string' && mod.note.length > 4000) add('E_TREE_INVALID', 'note too long: ' + mod.id);
    if (mod.width !== undefined && !WIDTHS.has(mod.width)) add('E_TREE_INVALID', 'invalid width: ' + mod.id);
    if (mod.align !== undefined && !ALIGNS.has(mod.align)) add('E_TREE_INVALID', 'invalid align: ' + mod.id);
  }
  if (typeof intent.globalNote === 'string' && intent.globalNote.length > 8000) add('E_TREE_INVALID', 'globalNote too long');
  if (JSON.stringify(intent).length > 2 * 1024 * 1024) add('E_TOO_LARGE', 'intent exceeds 2 MiB');

  return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
}

export async function collectSharedClassWarnings(root, page, manifest, intent) {
  const index = flattenModules(manifest?.modules);
  const changed = new Set([
    ...(intent.changes?.moved || []).map((item) => item.module),
    ...(intent.changes?.removed || []).map((item) => item.module),
    ...(intent.changes?.added || []).map((item) => item.parent),
    ...(intent.modules || []).map((item) => item.id),
  ]);
  const classes = new Set();
  for (const id of changed) {
    const mod = index.get(id);
    if (!mod?.classes) continue;
    for (const token of mod.classes.split(/\s+/)) if (token) classes.add(token);
  }
  const pages = await discoverPages(root);
  const out = [];
  for (const token of classes) {
    const hits = [];
    for (const other of pages) {
      if (other === page) continue;
      const html = await fs.readFile(path.join(root, other), 'utf8');
      const re = /class\s*=\s*["']([^"']*)["']/gi;
      let match;
      while ((match = re.exec(html))) {
        if (match[1].split(/\s+/).includes(token)) {
          hits.push(other);
          break;
        }
      }
    }
    if (hits.length) out.push({ class: token, pages: hits });
  }
  return out.slice(0, 50);
}

export async function writeIntentAtomic(root, intent) {
  await ensureLayoutDir(root);
  const next = { ...intent, submittedAt: intent.submittedAt || new Date().toISOString() };
  await writeJsonAtomic(intentPath(root), next);
  return intentPath(root);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test .claude/skills/web-layout/tests/intent.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/web-layout/editor/runtime/constants.js .claude/skills/web-layout/scripts/lib/intent.mjs .claude/skills/web-layout/tests/intent.test.mjs
git commit -m "feat(web-layout): validate layout intents and warn on shared classes"
```

---

### Task 5: Workspace service

**Files:**
- Create: `.claude/skills/web-layout/scripts/lib/workspace.mjs`
- Create: `.claude/skills/web-layout/tests/workspace.test.mjs`

**Interfaces:**
- Consumes: `discoverPages`, `resolveInsideRoot` from `./paths.mjs`; `sourceVersion`, `styleVersion`, `linkedStylesheets` from `./version.mjs`; `loadManifest`, `saveManifest`, `applyEditorManifest` from `./manifest.mjs`; `validateIntent`, `writeIntentAtomic`, `collectSharedClassWarnings` from `./intent.mjs`.
- Produces: `createWorkspace({root})` returning `{ root, pages(), state(page), version(page), manifest(page), saveEditorManifest(page, incoming), submitIntent(intent) }`.

- [ ] **Step 1: Write the failing tests**

`tests/workspace.test.mjs`:
```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test .claude/skills/web-layout/tests/workspace.test.mjs`
Expected: FAIL with `Cannot find module '../scripts/lib/workspace.mjs'`.

- [ ] **Step 3: Implement `workspace.mjs`**

```js
import fs from 'node:fs/promises';
import path from 'node:path';
import { discoverPages, resolveInsideRoot } from './paths.mjs';
import { sourceVersion, styleVersion, linkedStylesheets } from './version.mjs';
import { loadManifest, saveManifest, applyEditorManifest } from './manifest.mjs';
import { validateIntent, writeIntentAtomic, collectSharedClassWarnings } from './intent.mjs';

export function createWorkspace({ root }) {
  const absolute = path.resolve(root);

  async function pageAbs(page) {
    const abs = await resolveInsideRoot(absolute, '/' + String(page || '').replace(/^\/+/, ''));
    if (!abs || !/\.html?$/i.test(abs)) {
      throw Object.assign(new Error('page not found: ' + page), { code: 'E_PAGE_NOT_FOUND' });
    }
    return abs;
  }

  async function state(page) {
    const abs = await pageAbs(page);
    const html = await fs.readFile(abs, 'utf8');
    const src = await sourceVersion(absolute, page);
    const styles = linkedStylesheets(html, page);
    const style = await styleVersion(absolute, page, html);
    const loaded = await loadManifest(absolute, page, src);
    return {
      pages: await discoverPages(absolute),
      page,
      sourceVersion: src,
      styleVersion: style,
      stylesheets: styles,
      manifestStatus: loaded.status,
      manifest: loaded.manifest,
      errors: loaded.errors,
    };
  }

  async function version(page) {
    const abs = await pageAbs(page);
    const html = await fs.readFile(abs, 'utf8');
    return {
      sourceVersion: await sourceVersion(absolute, page),
      styleVersion: await styleVersion(absolute, page, html),
    };
  }

  async function manifest(page) {
    await pageAbs(page);
    const src = await sourceVersion(absolute, page);
    return loadManifest(absolute, page, src);
  }

  async function saveEditorManifest(page, incoming) {
    await pageAbs(page);
    const src = await sourceVersion(absolute, page);
    const loaded = await loadManifest(absolute, page, src);
    if (loaded.status === 'stale') {
      throw Object.assign(new Error('manifest is stale'), { code: 'E_STALE_SOURCE' });
    }
    const merged = applyEditorManifest(loaded.manifest, { ...incoming, page }, { sourceVersion: src });
    return saveManifest(absolute, page, merged, { sourceVersion: src });
  }

  async function submitIntent(intent) {
    const page = intent && intent.page;
    if (!page) throw Object.assign(new Error('page required'), { code: 'E_PAGE_MISMATCH' });
    const current = await state(page);
    if (!current.manifest) {
      throw Object.assign(new Error('manifest missing or invalid'), { code: 'E_MANIFEST' });
    }
    if (current.manifestStatus === 'stale') {
      throw Object.assign(new Error('manifest is stale'), { code: 'E_STALE_SOURCE' });
    }
    const result = validateIntent(intent, {
      manifest: current.manifest,
      sourceVersion: current.sourceVersion,
      styleVersion: current.styleVersion,
    });
    if (!result.ok) {
      throw Object.assign(new Error(result.errors.map((item) => item.message).join('; ')), {
        code: result.errors[0].code,
        errors: result.errors,
      });
    }
    const warnings = await collectSharedClassWarnings(absolute, page, current.manifest, intent);
    const next = {
      ...intent,
      submittedAt: intent.submittedAt || new Date().toISOString(),
      context: {
        ...(intent.context || {}),
        manifestStatus: current.manifest.generatedBy === 'editor-heuristic'
          ? 'heuristic'
          : current.manifestStatus,
        stylesheets: current.stylesheets,
        sharedClassWarnings: warnings,
      },
    };
    await writeIntentAtomic(absolute, next);
    return { path: '.web-layout/intent.json', warnings, intent: next };
  }

  return { root: absolute, pages: () => discoverPages(absolute), state, version, manifest, saveEditorManifest, submitIntent };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test .claude/skills/web-layout/tests/workspace.test.mjs`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/web-layout/scripts/lib/workspace.mjs .claude/skills/web-layout/tests/workspace.test.mjs
git commit -m "feat(web-layout): assemble per-page workspace state"
```

---

### Task 6: Preview HTML injection and static file serving

**Files:**
- Create: `.claude/skills/web-layout/scripts/lib/inject.mjs`
- Create: `.claude/skills/web-layout/scripts/lib/static.mjs`
- Create: `.claude/skills/web-layout/tests/inject.test.mjs`
- Create: `.claude/skills/web-layout/tests/static.test.mjs`

**Interfaces:**
- Consumes: `resolveInsideRoot` from `./paths.mjs`.
- Produces: `stripMeta(html, httpEquiv)`, `buildBootstrap({editorOrigin, runtimeToken})`, `injectPreviewHtml(html, {editorOrigin, runtimeToken})`, `mimeOf(filePath)`, `serveStaticFile(req, res, {root, urlPath, editorOrigin, runtimeToken, runtimeDir})`.

- [ ] **Step 1: Write the failing injection tests**

`tests/inject.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { injectPreviewHtml } from '../scripts/lib/inject.mjs';

const OPTS = { editorOrigin: 'http://127.0.0.1:5000', runtimeToken: 'abc123' };

test('injects bootstrap first in head and runtime before body close', () => {
  const html = '<!doctype html><html><head><title>x</title></head><body><p>Hi</p></body></html>';
  const out = injectPreviewHtml(html, OPTS);
  assert.ok(out.indexOf('window.__WEB_LAYOUT__') < out.indexOf('<title>x</title>'));
  assert.ok(out.indexOf('/__layout/runtime.js') > out.indexOf('<p>Hi</p>'));
  assert.ok(out.indexOf('/__layout/runtime.js') < out.indexOf('</body>'));
  assert.equal(out.match(/\/__layout\/runtime\.js/g).length, 1);
});

test('removes CSP and refresh meta tags', () => {
  const html = [
    '<!doctype html><html><head>',
    '<meta content="default-src \'none\'" http-equiv="Content-Security-Policy">',
    '<meta http-equiv="refresh" content="0;url=/x">',
    '</head><body></body></html>',
  ].join('');
  const out = injectPreviewHtml(html, OPTS);
  assert.equal(/content-security-policy/i.test(out), false);
  assert.equal(/http-equiv="refresh"/i.test(out), false);
});

test('works without head or body tags', () => {
  const out = injectPreviewHtml('<p>bare</p>', OPTS);
  assert.ok(out.startsWith('<script>window.__WEB_LAYOUT__'));
  assert.ok(out.endsWith('<script type="module" src="/__layout/runtime.js"></script>'));
});

test('does not inject the runtime twice', () => {
  const html = '<html><head></head><body><script type="module" src="/__layout/runtime.js"></script></body></html>';
  const out = injectPreviewHtml(html, OPTS);
  assert.equal(out.match(/\/__layout\/runtime\.js/g).length, 1);
});
```

- [ ] **Step 2: Run the injection tests to verify they fail**

Run: `node --test .claude/skills/web-layout/tests/inject.test.mjs`
Expected: FAIL with `Cannot find module '../scripts/lib/inject.mjs'`.

- [ ] **Step 3: Implement `inject.mjs`**

```js
export function stripMeta(html, httpEquiv) {
  const re = new RegExp(
    `<meta\\b[^>]*http-equiv\\s*=\\s*["']?${httpEquiv}["']?[^>]*>`,
    'gi',
  );
  return String(html).replace(re, '');
}

export function buildBootstrap({ editorOrigin, runtimeToken }) {
  const config = JSON.stringify({ editorOrigin, runtimeToken });
  return '<script>window.__WEB_LAYOUT__=' + config + ';'
    + '(function(){try{Object.defineProperty(ServiceWorkerContainer.prototype,"register",'
    + '{value:function(){return Promise.reject(new Error("web-layout preview disables service workers"));}})}'
    + 'catch(e){}})();</script>';
}

export function injectPreviewHtml(html, { editorOrigin, runtimeToken }) {
  let out = stripMeta(html, 'content-security-policy');
  out = stripMeta(out, 'refresh');
  const bootstrap = buildBootstrap({ editorOrigin, runtimeToken });
  const head = /<head\b[^>]*>/i.exec(out);
  if (head) {
    out = out.slice(0, head.index + head[0].length) + bootstrap + out.slice(head.index + head[0].length);
  } else {
    out = bootstrap + out;
  }
  const runtime = '<script type="module" src="/__layout/runtime.js"></script>';
  if (out.includes('/__layout/runtime.js')) return out;
  if (/<\/body>/i.test(out)) out = out.replace(/<\/body>/i, runtime + '</body>');
  else out += runtime;
  return out;
}
```

- [ ] **Step 4: Run the injection tests to verify they pass**

Run: `node --test .claude/skills/web-layout/tests/inject.test.mjs`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing static tests**

`tests/static.test.mjs`:
```js
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
```

- [ ] **Step 6: Run the static tests to verify they fail**

Run: `node --test .claude/skills/web-layout/tests/static.test.mjs`
Expected: FAIL with `Cannot find module '../scripts/lib/static.mjs'`.

- [ ] **Step 7: Implement `static.mjs`**

```js
import path from 'node:path';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolveInsideRoot } from './paths.mjs';
import { injectPreviewHtml } from './inject.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

const MAX_FILE = 64 * 1024 * 1024;
const MAX_HTML = 10 * 1024 * 1024;

export function mimeOf(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function frameAncestors(editorOrigin) {
  return 'frame-ancestors ' + editorOrigin;
}

function setHeaders(res, editorOrigin, type) {
  res.setHeader('Content-Type', type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', frameAncestors(editorOrigin));
}

function notFound(res) {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('Not found');
}

export async function serveStaticFile(req, res, { root, urlPath, editorOrigin, runtimeToken, runtimeDir }) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.end('Method not allowed');
    return;
  }
  const pathname = String(urlPath || '/');
  if (pathname.startsWith('/__layout/')) {
    const rel = pathname.slice('/__layout/'.length);
    if (rel.includes('..') || rel.includes('\\') || rel.startsWith('.')) return notFound(res);
    const abs = path.resolve(runtimeDir, rel);
    if (!abs.startsWith(path.resolve(runtimeDir) + path.sep)) return notFound(res);
    let stat;
    try { stat = await fs.stat(abs); } catch { return notFound(res); }
    if (!stat.isFile() || stat.size > MAX_FILE) return notFound(res);
    setHeaders(res, editorOrigin, mimeOf(abs));
    if (req.method === 'HEAD') return res.end();
    createReadStream(abs).pipe(res);
    return;
  }

  const abs = await resolveInsideRoot(root, pathname);
  if (!abs) return notFound(res);
  let stat;
  try { stat = await fs.stat(abs); } catch { return notFound(res); }
  if (!stat.isFile()) return notFound(res);
  if (stat.size > MAX_FILE) {
    res.statusCode = 413;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('File too large');
    return;
  }

  const type = mimeOf(abs);
  if (type.startsWith('text/html')) {
    if (stat.size > MAX_HTML) {
      res.statusCode = 413;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('HTML too large for preview');
      return;
    }
    const html = await fs.readFile(abs, 'utf8');
    const injected = injectPreviewHtml(html, { editorOrigin, runtimeToken });
    setHeaders(res, editorOrigin, type);
    res.setHeader('Content-Length', Buffer.byteLength(injected));
    if (req.method === 'HEAD') return res.end();
    res.end(injected);
    return;
  }

  setHeaders(res, editorOrigin, type);
  res.setHeader('Content-Length', stat.size);
  if (req.method === 'HEAD') return res.end();
  createReadStream(abs).pipe(res);
}
```

- [ ] **Step 8: Run the static tests to verify they pass**

Run: `node --test .claude/skills/web-layout/tests/static.test.mjs`
Expected: PASS, 4 tests.

- [ ] **Step 9: Commit**

```bash
git add .claude/skills/web-layout/scripts/lib/inject.mjs .claude/skills/web-layout/scripts/lib/static.mjs .claude/skills/web-layout/tests/inject.test.mjs .claude/skills/web-layout/tests/static.test.mjs
git commit -m "feat(web-layout): inject runtime and serve the preview site safely"
```

---

### Task 7: HTTP helpers, CLI config, API router

**Files:**
- Create: `.claude/skills/web-layout/scripts/lib/http.mjs`
- Create: `.claude/skills/web-layout/scripts/lib/config.mjs`
- Create: `.claude/skills/web-layout/scripts/lib/api.mjs`
- Create: `.claude/skills/web-layout/tests/http.test.mjs`

**Interfaces:**
- Consumes: `layoutDir` from `./layout-dir.mjs`.
- Produces: `sendJson(res, status, body)`, `readJsonBody(req, limit)`, `tokenFrom(req)`, `originOk(req, origin)`, `checkToken(req, token)`; `parseArgs(argv)`, `createConfig(parsed)`, `readServerJson(root)`, `writeServerJson(root, data)`, `clearServerJson(root)`, `pidAlive(pid)`; `createApiHandler({workspace, config, getEditorOrigin, getPreviewOrigin, shutdown})`.

- [ ] **Step 1: Write the failing HTTP/config tests**

`tests/http.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readJsonBody, tokenFrom, originOk, checkToken } from '../scripts/lib/http.mjs';
import { parseArgs, createConfig, pidAlive } from '../scripts/lib/config.mjs';

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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test .claude/skills/web-layout/tests/http.test.mjs`
Expected: FAIL with `Cannot find module '../scripts/lib/http.mjs'`.

- [ ] **Step 3: Implement `http.mjs`**

```js
export function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', Buffer.byteLength(text));
  res.end(text);
}

export function tokenFrom(req) {
  return String(req.headers['x-layout-token'] || '');
}

export function checkToken(req, token) {
  return tokenFrom(req) === token;
}

export function originOk(req, origin) {
  return req.headers.origin === origin;
}

export function readJsonBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let settled = false;
    const chunks = [];
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settled = true;
        reject(Object.assign(new Error('body too large'), { code: 'E_TOO_LARGE' }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(Object.assign(new Error('invalid JSON'), { code: 'E_INVALID_JSON' }));
      }
    });
    req.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}
```

- [ ] **Step 4: Implement `config.mjs`**

```js
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { parseArgs as nodeParseArgs } from 'node:util';
import { layoutDir, ensureLayoutDir } from './layout-dir.mjs';

function usage(message) {
  return Object.assign(new Error(message), { code: 'E_USAGE' });
}

export function parseArgs(argv) {
  const { values } = nodeParseArgs({
    args: argv,
    options: {
      root: { type: 'string' },
      page: { type: 'string' },
      'editor-port': { type: 'string' },
      'preview-port': { type: 'string' },
      'idle-minutes': { type: 'string' },
      open: { type: 'boolean' },
      stop: { type: 'boolean' },
    },
    strict: true,
  });
  if (!values.root) throw usage('--root is required');
  const parsePort = (value, name) => {
    if (value === undefined) return 0;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 65535) throw usage(name + ' must be a port');
    return n;
  };
  const idle = values['idle-minutes'] === undefined ? 60 : Number(values['idle-minutes']);
  if (!Number.isFinite(idle) || idle < 0) throw usage('--idle-minutes must be >= 0');
  return {
    root: path.resolve(values.root),
    page: values.page || '',
    editorPort: parsePort(values['editor-port'], '--editor-port'),
    previewPort: parsePort(values['preview-port'], '--preview-port'),
    idleMinutes: idle,
    open: values.open === true,
    stop: values.stop === true,
  };
}

export function createConfig(parsed) {
  return {
    ...parsed,
    editorToken: crypto.randomBytes(32).toString('hex'),
    runtimeToken: crypto.randomBytes(32).toString('hex'),
    idleMs: parsed.idleMinutes * 60 * 1000,
    serverJsonPath: path.join(layoutDir(parsed.root), 'server.json'),
  };
}

export async function readServerJson(root) {
  try {
    return JSON.parse(await fs.readFile(path.join(layoutDir(root), 'server.json'), 'utf8'));
  } catch {
    return null;
  }
}

export async function writeServerJson(root, data) {
  await ensureLayoutDir(root);
  const file = path.join(layoutDir(root), 'server.json');
  const tmp = file + '.' + process.pid + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n');
  await fs.rename(tmp, file);
}

export async function clearServerJson(root) {
  await fs.rm(path.join(layoutDir(root), 'server.json'), { force: true });
}

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}
```

- [ ] **Step 5: Implement `api.mjs`**

```js
import { sendJson, readJsonBody, checkToken, originOk } from './http.mjs';

function statusFor(code) {
  if (code === 'E_PAGE_NOT_FOUND') return 404;
  if (code === 'E_FORBIDDEN') return 403;
  if (code === 'E_TOO_LARGE') return 413;
  if (code === 'E_INTERNAL') return 500;
  return 400;
}

export function createApiHandler({ workspace, config, getEditorOrigin, getPreviewOrigin, shutdown }) {
  return async function handle(req, res, url) {
    if (!url.pathname.startsWith('/api/')) return false;
    if (!checkToken(req, config.editorToken)) {
      sendJson(res, 403, { ok: false, error: { code: 'E_FORBIDDEN', message: 'invalid token' } });
      return true;
    }
    if ((req.method === 'PUT' || req.method === 'POST') && !originOk(req, getEditorOrigin())) {
      sendJson(res, 403, { ok: false, error: { code: 'E_FORBIDDEN', message: 'invalid origin' } });
      return true;
    }
    try {
      if (req.method === 'GET' && url.pathname === '/api/pages') {
        sendJson(res, 200, { ok: true, value: { pages: await workspace.pages() } });
        return true;
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const page = url.searchParams.get('page') || '';
        const state = await workspace.state(page);
        sendJson(res, 200, {
          ok: true,
          value: {
            ...state,
            editorOrigin: getEditorOrigin(),
            previewOrigin: getPreviewOrigin(),
            runtimeToken: config.runtimeToken,
          },
        });
        return true;
      }
      if (req.method === 'GET' && url.pathname === '/api/version') {
        const page = url.searchParams.get('page') || '';
        sendJson(res, 200, { ok: true, value: await workspace.version(page) });
        return true;
      }
      if (req.method === 'GET' && url.pathname === '/api/manifest') {
        const page = url.searchParams.get('page') || '';
        sendJson(res, 200, { ok: true, value: await workspace.manifest(page) });
        return true;
      }
      if (req.method === 'PUT' && url.pathname === '/api/manifest') {
        const page = url.searchParams.get('page') || '';
        const body = await readJsonBody(req);
        const saved = await workspace.saveEditorManifest(page, body.manifest || body);
        sendJson(res, 200, { ok: true, value: saved });
        return true;
      }
      if (req.method === 'POST' && url.pathname === '/api/intent') {
        const body = await readJsonBody(req);
        const result = await workspace.submitIntent(body.intent || body);
        sendJson(res, 200, { ok: true, value: { path: result.path, warnings: result.warnings } });
        return true;
      }
      if (req.method === 'POST' && url.pathname === '/api/shutdown') {
        sendJson(res, 200, { ok: true, value: { ok: true } });
        setTimeout(() => shutdown(), 20);
        return true;
      }
      sendJson(res, 404, { ok: false, error: { code: 'E_NOT_FOUND', message: 'unknown route' } });
      return true;
    } catch (error) {
      const code = error && error.code ? error.code : 'E_INTERNAL';
      sendJson(res, statusFor(code), {
        ok: false,
        error: { code, message: error && error.message ? error.message : String(error) },
      });
      return true;
    }
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test .claude/skills/web-layout/tests/http.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/web-layout/scripts/lib/http.mjs .claude/skills/web-layout/scripts/lib/config.mjs .claude/skills/web-layout/scripts/lib/api.mjs .claude/skills/web-layout/tests/http.test.mjs
git commit -m "feat(web-layout): add API guards, config parsing, and route handlers"
```

---

### Task 8: Two-listener app, CLI, integration tests

**Files:**
- Modify: `.claude/skills/web-layout/scripts/lib/static.mjs` (add `serveEditorFile`)
- Create: `.claude/skills/web-layout/scripts/lib/app.mjs`
- Create: `.claude/skills/web-layout/scripts/server.mjs`
- Create: `.claude/skills/web-layout/tests/server.test.mjs`

**Interfaces:**
- Consumes: `createConfig` from `./config.mjs`; `createWorkspace` from `./workspace.mjs`; `createApiHandler` from `./api.mjs`; `serveStaticFile` from `./static.mjs`; `resolveInsideRoot` from `./paths.mjs`.
- Produces: `createApp({root, page, editorPort, previewPort, idleMinutes, onClose})` → `{config, editorUrl, previewUrl, editorOrigin, previewOrigin, close, shutdown}`; `serveEditorFile(req, res, {root, urlPath})`; CLI `scripts/server.mjs`.

- [ ] **Step 1: Write the failing integration test**

`tests/server.test.mjs`:
```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test .claude/skills/web-layout/tests/server.test.mjs`
Expected: FAIL with `Cannot find module '../scripts/lib/app.mjs'`.

- [ ] **Step 3: Add `serveEditorFile` to `static.mjs`**

Append this export:
```js
export async function serveEditorFile(req, res, { root, urlPath }) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.end('Method not allowed');
    return;
  }
  const abs = await resolveInsideRoot(root, urlPath === '/' ? '/index.html' : urlPath);
  if (!abs) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }
  let stat;
  try { stat = await fs.stat(abs); } catch { res.statusCode = 404; res.end('Not found'); return; }
  if (!stat.isFile()) { res.statusCode = 404; res.end('Not found'); return; }
  res.setHeader('Content-Type', mimeOf(abs));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
  res.setHeader('Content-Length', stat.size);
  if (req.method === 'HEAD') return res.end();
  createReadStream(abs).pipe(res);
}
```

- [ ] **Step 4: Implement `app.mjs`**

```js
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConfig } from './config.mjs';
import { createWorkspace } from './workspace.mjs';
import { createApiHandler } from './api.mjs';
import { serveStaticFile, serveEditorFile } from './static.mjs';

const editorDir = fileURLToPath(new URL('../../editor/', import.meta.url));
const runtimeDir = path.join(editorDir, 'runtime');

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

export async function createApp({ root, page = '', editorPort = 0, previewPort = 0, idleMinutes = 60, onClose }) {
  const config = createConfig({ root, page, editorPort, previewPort, idleMinutes });
  const workspace = createWorkspace({ root: config.root });
  let editorOrigin = '';
  let previewOrigin = '';
  let lastActivity = Date.now();
  let closed = false;
  let timer = null;
  const servers = [];

  const close = async () => {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(() => resolve()))));
    if (typeof onClose === 'function') await onClose();
  };
  const shutdown = () => { close().catch(() => {}); };

  const handler = createApiHandler({
    workspace,
    config,
    getEditorOrigin: () => editorOrigin,
    getPreviewOrigin: () => previewOrigin,
    shutdown,
  });

  const editorServer = http.createServer(async (req, res) => {
    lastActivity = Date.now();
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname.startsWith('/api/')) {
        await handler(req, res, url);
        return;
      }
      await serveEditorFile(req, res, { root: editorDir, urlPath: url.pathname });
    } catch {
      res.statusCode = 500;
      res.end('Internal error');
    }
  });

  const previewServer = http.createServer(async (req, res) => {
    lastActivity = Date.now();
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      await serveStaticFile(req, res, {
        root: config.root,
        urlPath: url.pathname,
        editorOrigin,
        runtimeToken: config.runtimeToken,
        runtimeDir,
      });
    } catch {
      res.statusCode = 500;
      res.end('Internal error');
    }
  });

  servers.push(editorServer, previewServer);
  const p1 = await listen(editorServer, config.editorPort);
  const p2 = await listen(previewServer, config.previewPort);
  editorOrigin = 'http://127.0.0.1:' + p1;
  previewOrigin = 'http://127.0.0.1:' + p2;
  const encodedPage = String(page || '').split('/').map(encodeURIComponent).join('/');
  const editorUrl = editorOrigin + '/?page=' + encodeURIComponent(encodedPage) + '#token=' + config.editorToken;
  const previewUrl = previewOrigin + (encodedPage ? '/' + encodedPage : '/');

  if (idleMinutes > 0) {
    timer = setInterval(() => {
      if (Date.now() - lastActivity > idleMinutes * 60000) shutdown();
    }, 30000);
    if (typeof timer.unref === 'function') timer.unref();
  }

  return {
    config,
    editorUrl,
    previewUrl,
    editorOrigin,
    previewOrigin,
    close,
    shutdown,
  };
}
```

- [ ] **Step 5: Implement `server.mjs`**

```js
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
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
```

- [ ] **Step 6: Run the integration test**

Run: `node --test .claude/skills/web-layout/tests/server.test.mjs`
Expected: PASS, 1 test. If it hangs, check that `app.close()` runs in `finally` and that the shutdown callback fires.

- [ ] **Step 7: Run all tests so far**

Run: `node --test .claude/skills/web-layout/tests/*.test.mjs`
Expected: PASS for Tasks 1-8. Tasks 9+ tests do not exist yet.

- [ ] **Step 8: Commit**

```bash
git add .claude/skills/web-layout/scripts/lib/static.mjs .claude/skills/web-layout/scripts/lib/app.mjs .claude/skills/web-layout/scripts/server.mjs .claude/skills/web-layout/tests/server.test.mjs
git commit -m "feat(web-layout): run editor and preview on two loopback listeners"
```

---

### Task 9: Editor shell, API client, pure editor state, iframe handshake

**Files:**
- Create: `.claude/skills/web-layout/editor/index.html`
- Create: `.claude/skills/web-layout/editor/editor.css`
- Create: `.claude/skills/web-layout/editor/api.js`
- Create: `.claude/skills/web-layout/editor/state.js`
- Create: `.claude/skills/web-layout/editor/editor.js`
- Create: `.claude/skills/web-layout/tests/state.test.mjs`

**Interfaces:**
- Consumes: `PALETTE` from `./runtime/constants.js`; API `GET /api/state`, `GET /api/pages`, `GET /api/version`, `PUT /api/manifest`, `POST /api/intent`.
- Produces: `api(path, {method, body})`, `widthAlignEnabled(parentLayout)`, `countChanges(state)`, `validateForSubmit(state)`, `buildIntent(state)`, `moduleIndex(manifest)`, `findParent(tree, id)`.

- [ ] **Step 1: Write the failing state tests**

`tests/state.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  widthAlignEnabled,
  countChanges,
  validateForSubmit,
  buildIntent,
  moduleIndex,
  findParent,
} from '../editor/state.js';

const manifest = {
  schema: 1,
  page: 'index.html',
  modules: [
    { id: 'header', role: 'header', label: 'Header', ref: 'header', classes: 'site-header', container: false, layout: 'flow' },
    { id: 'hero', role: 'hero', label: 'Hero', ref: 'section.hero', classes: 'hero', container: true, layout: 'column', children: [
      { id: 'hero-title', role: 'heading', label: 'Title', ref: 'section.hero h2', classes: '', container: false, layout: 'flow' },
    ] },
    { id: 'footer', role: 'footer', label: 'Footer', ref: 'footer', classes: 'site-footer', container: false, layout: 'flow' },
  ],
};

const tree = [{ id: '__root__', children: [{ id: 'header' }, { id: 'hero', children: [{ id: 'hero-title' }, { id: 'new-1' }] }, { id: 'footer' }] }];

test('widthAlignEnabled follows the parent layout', () => {
  assert.deepEqual(widthAlignEnabled('row'), { width: true, align: true });
  assert.deepEqual(widthAlignEnabled('grid-2col'), { width: true, align: true });
  assert.deepEqual(widthAlignEnabled('column'), { width: false, align: true });
  assert.deepEqual(widthAlignEnabled('flow'), { width: false, align: false });
});

test('countChanges counts moves, adds, removes, and notes', () => {
  assert.deepEqual(countChanges({
    moved: [{ module: 'hero' }],
    added: new Map([['new-1', { id: 'new-1' }]]),
    removed: new Set(['footer']),
    notes: { hero: 'x' },
  }), { moved: 1, added: 1, removed: 1, notes: 1 });
});

test('buildIntent produces the intent contract', () => {
  const intent = buildIntent({
    page: 'index.html',
    sourceVersion: 'sha256:' + 'a'.repeat(64),
    styleVersion: 'sha256:' + 'b'.repeat(64),
    manifestStatus: 'ok',
    stylesheets: ['styles.css'],
    manifest,
    tree,
    moved: [{ module: 'hero', from: { parent: '__root__', index: 1 }, to: { parent: '__root__', index: 2 } }],
    added: new Map([['new-1', { id: 'new-1', type: 'heading', label: 'Quote', note: 'Two lines', parent: 'hero', index: 1 }]]),
    removed: new Set(['footer']),
    notes: { hero: 'Less padding' },
    layoutHints: { hero: { width: 'full', align: 'start' } },
    globalNote: 'Tighter',
  });
  assert.equal(intent.kind, 'web-layout-intent');
  assert.equal(intent.changes.moved.length, 1);
  assert.equal(intent.changes.added[0].type, 'heading');
  assert.deepEqual(intent.changes.removed[0], { module: 'footer', ref: 'footer' });
  assert.deepEqual(intent.modules.find((m) => m.id === 'hero'), {
    id: 'hero', ref: 'section.hero', note: 'Less padding', width: 'full', align: 'start',
  });
  assert.deepEqual(intent.tree, tree);
  assert.deepEqual(intent.context.stylesheets, ['styles.css']);
  assert.equal(intent.globalNote, 'Tighter');
});

test('validateForSubmit rejects empty, stale, unresolved, and missing-page states', () => {
  const base = {
    page: 'index.html',
    sourceVersion: 'sha256:' + 'a'.repeat(64),
    styleVersion: 'sha256:' + 'b'.repeat(64),
    stale: false,
    unresolved: [],
    tree,
    moved: [],
    added: new Map(),
    removed: new Set(),
    notes: {},
    globalNote: '',
  };
  assert.deepEqual(validateForSubmit(base), ['E_EMPTY_CHANGES']);
  assert.deepEqual(validateForSubmit({ ...base, globalNote: 'x' }), []);
  assert.deepEqual(validateForSubmit({ ...base, stale: true, globalNote: 'x' }), ['E_STALE']);
  assert.deepEqual(validateForSubmit({ ...base, unresolved: [{ id: 'x' }], globalNote: 'x' }), ['E_UNRESOLVED']);
  assert.deepEqual(validateForSubmit({ ...base, page: '', globalNote: 'x' }), ['E_NO_PAGE']);
});

test('moduleIndex and findParent walk the manifest and tree', () => {
  const index = moduleIndex(manifest);
  assert.equal(index.get('hero-title').ref, 'section.hero h2');
  assert.equal(findParent(tree, 'hero-title').id, 'hero');
  assert.equal(findParent(tree, '__root__'), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test .claude/skills/web-layout/tests/state.test.mjs`
Expected: FAIL with `Cannot find module '../editor/state.js'`.

- [ ] **Step 3: Implement `state.js`**

```js
export function moduleIndex(manifest) {
  const out = new Map();
  const walk = (modules) => {
    for (const mod of modules || []) {
      out.set(mod.id, mod);
      walk(mod.children);
    }
  };
  walk(manifest && manifest.modules);
  return out;
}

export function findParent(nodes, id, parent = null) {
  for (const node of nodes || []) {
    if (node.id === id) return parent;
    const found = findParent(node.children, id, node);
    if (found !== undefined && found !== null) return found;
  }
  return null;
}

export function widthAlignEnabled(parentLayout) {
  if (parentLayout === 'row' || String(parentLayout || '').startsWith('grid')) {
    return { width: true, align: true };
  }
  if (parentLayout === 'column') return { width: false, align: true };
  return { width: false, align: false };
}

export function countChanges({ moved, added, removed, notes }) {
  return {
    moved: (moved || []).length,
    added: added ? added.size : 0,
    removed: removed ? removed.size : 0,
    notes: Object.values(notes || {}).filter((value) => String(value || '').trim()).length,
  };
}

export function validateForSubmit(state) {
  const errors = [];
  if (!state.page) errors.push('E_NO_PAGE');
  if (!state.sourceVersion || !state.styleVersion) errors.push('E_NO_VERSION');
  if (state.stale) errors.push('E_STALE');
  if ((state.unresolved || []).length) errors.push('E_UNRESOLVED');
  const changes = countChanges(state);
  if (!changes.moved && !changes.added && !changes.removed && !changes.notes && !String(state.globalNote || '').trim()) {
    errors.push('E_EMPTY_CHANGES');
  }
  return errors;
}

export function buildIntent(state) {
  const manifest = state.manifest || state.effectiveManifest || { modules: [] };
  const index = moduleIndex(manifest);
  const notes = state.notes || {};
  const hints = state.layoutHints || {};
  const removedIds = state.removed || new Set();
  const moduleIds = new Set([...Object.keys(notes), ...Object.keys(hints)]);
  const modules = [];
  for (const id of moduleIds) {
    if (removedIds.has(id)) continue;
    const note = String(notes[id] || '').trim();
    const hint = hints[id] || {};
    if (!note && !hint.width && !hint.align) continue;
    const mod = index.get(id);
    if (!mod) continue;
    const entry = { id, ref: mod.ref };
    if (note) entry.note = note;
    if (hint.width) entry.width = hint.width;
    if (hint.align) entry.align = hint.align;
    modules.push(entry);
  }
  const added = [...(state.added || new Map()).values()].map((item) => {
    const entry = {
      id: item.id,
      type: item.type,
      label: item.label,
      note: item.note || '',
      parent: item.parent,
      index: item.index,
    };
    if (item.width) entry.width = item.width;
    if (item.align) entry.align = item.align;
    return entry;
  });
  const removed = [...removedIds]
    .filter((id) => index.has(id))
    .map((id) => ({ module: id, ref: index.get(id).ref }));
  return {
    schema: 1,
    kind: 'web-layout-intent',
    page: state.page,
    sourceVersion: state.sourceVersion,
    styleVersion: state.styleVersion,
    globalNote: state.globalNote || '',
    changes: {
      moved: (state.moved || []).filter((item) => !removedIds.has(item.module)),
      added,
      removed,
    },
    modules,
    tree: state.tree || state.currentTree,
    context: {
      manifestStatus: state.manifestStatus || 'ok',
      stylesheets: state.stylesheets || [],
      sharedClassWarnings: [],
    },
  };
}
```

- [ ] **Step 4: Run the state tests**

Run: `node --test .claude/skills/web-layout/tests/state.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 5: Implement `api.js`**

```js
const params = new URLSearchParams(location.hash.replace(/^#/, ''));
export const token = params.get('token') || '';

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'X-Layout-Token': token };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  let data;
  try {
    data = await res.json();
  } catch {
    data = { ok: false, error: { code: 'E_BAD_RESPONSE', message: 'invalid JSON from server' } };
  }
  if (!res.ok || data.ok === false) {
    const error = new Error(data.error && data.error.message ? data.error.message : 'HTTP ' + res.status);
    error.code = data.error && data.error.code ? data.error.code : 'E_HTTP';
    throw error;
  }
  return data.value;
}
```

- [ ] **Step 6: Create the editor shell**

`editor/index.html`:
```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Web Layout</title>
  <link rel="stylesheet" href="/editor.css" />
</head>
<body>
  <div id="app">
    <header class="bar">
      <label class="page-picker">页面 <select id="page-select"></select></label>
      <div class="viewports" role="group" aria-label="视口">
        <button type="button" data-width="1280" class="active">桌面</button>
        <button type="button" data-width="834">平板</button>
        <button type="button" data-width="390">手机</button>
      </div>
      <div id="banners" class="banners"></div>
    </header>
    <main class="workspace">
      <aside id="palette" class="palette"></aside>
      <section class="canvas">
        <div id="frame-wrap" class="frame-wrap">
          <iframe id="preview" sandbox="allow-scripts allow-same-origin allow-forms allow-modals" referrerpolicy="no-referrer" title="preview"></iframe>
        </div>
      </section>
      <aside id="inspector" class="inspector"></aside>
    </main>
    <footer class="bar footer">
      <span id="summary" class="summary"></span>
      <button id="reset" type="button">重置</button>
      <button id="submit" type="button" class="primary">完成</button>
    </footer>
  </div>
  <script type="module" src="/editor.js"></script>
</body>
</html>
```

`editor/editor.css`:
```css
:root { color-scheme: light; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; background: #f7f8fa; color: #172033; }
#app { display: flex; flex-direction: column; height: 100vh; }
.bar { display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: #fff; border-bottom: 1px solid #e2e6ee; }
.footer { border-top: 1px solid #e2e6ee; border-bottom: 0; justify-content: flex-end; }
.workspace { flex: 1; min-height: 0; display: grid; grid-template-columns: 180px minmax(0, 1fr) 260px; }
.palette, .inspector { background: #fff; overflow: auto; padding: 10px; }
.palette { border-right: 1px solid #e2e6ee; }
.inspector { border-left: 1px solid #e2e6ee; }
.canvas { min-width: 0; min-height: 0; padding: 12px; display: flex; justify-content: center; overflow: auto; background: #eef1f6; }
.frame-wrap { width: 1280px; max-width: 100%; height: 100%; background: #fff; box-shadow: 0 2px 16px rgba(20,30,50,.08); }
#preview { width: 100%; height: 100%; border: 0; display: block; background: #fff; }
.bar button { height: 28px; padding: 0 10px; border: 1px solid #d5dbe6; border-radius: 7px; background: #fff; cursor: pointer; }
.bar button.active { border-color: #2f6fed; color: #2f6fed; }
.bar button.primary { background: #2f6fed; border-color: #2f6fed; color: #fff; }
.bar button:disabled { opacity: .45; cursor: default; }
.banners { display: flex; gap: 8px; flex-wrap: wrap; font-size: 12px; }
.banner { padding: 4px 8px; border-radius: 6px; background: #fff4e5; color: #8a4b00; }
.banner.error { background: #fdecec; color: #a11; }
.summary { margin-right: auto; font-size: 12px; color: #5a6475; }
.palette-item { padding: 7px 9px; margin-bottom: 6px; border: 1px solid #d5dbe6; border-radius: 7px; background: #fff; cursor: grab; font-size: 13px; }
.palette-item:active { cursor: grabbing; }
.inspector h3 { margin: 0 0 8px; font-size: 13px; }
.inspector label { display: block; margin: 8px 0 4px; font-size: 12px; color: #5a6475; }
.inspector textarea, .inspector select { width: 100%; font: inherit; font-size: 12px; border: 1px solid #d5dbe6; border-radius: 6px; padding: 6px; }
.inspector textarea { min-height: 90px; resize: vertical; }
.muted { color: #7a8494; font-size: 12px; }
```

- [ ] **Step 7: Implement the shell orchestration in `editor.js`**

Start with this complete skeleton; later tasks add palette/inspector/drag wiring in the marked sections.

```js
import { api } from './api.js';
import { buildIntent, countChanges, validateForSubmit, moduleIndex } from './state.js';
import { PALETTE } from './runtime/constants.js';

const ui = {
  pageSelect: document.getElementById('page-select'),
  palette: document.getElementById('palette'),
  inspector: document.getElementById('inspector'),
  banners: document.getElementById('banners'),
  summary: document.getElementById('summary'),
  frame: document.getElementById('preview'),
  frameWrap: document.getElementById('frame-wrap'),
  reset: document.getElementById('reset'),
  submit: document.getElementById('submit'),
};

const app = {
  token: new URLSearchParams(location.hash.replace(/^#/, '')).get('token') || '',
  state: null,
  effectiveManifest: null,
  baselineTree: null,
  currentTree: null,
  added: new Map(),
  removed: new Set(),
  moved: [],
  notes: {},
  layoutHints: {},
  globalNote: '',
  selectedId: '',
  unresolved: [],
  stale: false,
  submitted: false,
  pollTimer: null,
};

function setBanners(items) {
  ui.banners.innerHTML = '';
  for (const item of items) {
    const el = document.createElement('span');
    el.className = 'banner' + (item.error ? ' error' : '');
    el.textContent = item.text;
    ui.banners.appendChild(el);
  }
}

function renderPageSelect(pages, current) {
  ui.pageSelect.innerHTML = '';
  for (const page of pages) {
    const option = document.createElement('option');
    option.value = page;
    option.textContent = page;
    option.selected = page === current;
    ui.pageSelect.appendChild(option);
  }
}

function renderPalette() {
  ui.palette.innerHTML = '';
  for (const item of PALETTE) {
    const el = document.createElement('div');
    el.className = 'palette-item';
    el.textContent = item.label;
    el.draggable = true;
    el.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('application/x-web-layout-module', item.type);
      event.dataTransfer.effectAllowed = 'copy';
    });
    ui.palette.appendChild(el);
  }
}

function renderInspector() {
  ui.inspector.innerHTML = '';
  const title = document.createElement('h3');
  title.textContent = '检查器';
  ui.inspector.appendChild(title);
  if (!app.selectedId) {
    const muted = document.createElement('div');
    muted.className = 'muted';
    muted.textContent = '在预览里点击一个模块。';
    ui.inspector.appendChild(muted);
  } else {
    const muted = document.createElement('div');
    muted.className = 'muted';
    muted.textContent = app.selectedId;
    ui.inspector.appendChild(muted);
  }
  const label = document.createElement('label');
  label.textContent = '整体要求';
  const global = document.createElement('textarea');
  global.value = app.globalNote;
  global.placeholder = '例如：整体更紧凑，首屏标题更突出';
  global.addEventListener('input', () => { app.globalNote = global.value; renderSummary(); });
  ui.inspector.appendChild(label);
  ui.inspector.appendChild(global);
}

function renderSummary() {
  const counts = countChanges(app);
  ui.summary.textContent = '移动 ' + counts.moved + ' · 新增 ' + counts.added + ' · 删除 ' + counts.removed + ' · ' + counts.notes + ' 条备注';
  const errors = validateForSubmit(app);
  ui.submit.disabled = app.submitted || errors.length > 0;
  if (errors.length && !app.submitted) {
    ui.summary.textContent += ' · ' + errors.join(', ');
  }
}

function postToFrame(message) {
  const frame = ui.frame;
  if (!frame || !frame.contentWindow || !app.state) return;
  frame.contentWindow.postMessage(message, app.state.previewOrigin);
}

async function loadPage(page) {
  stopPolling();
  setBanners([]);
  const state = await api('/api/state?page=' + encodeURIComponent(page));
  app.state = state;
  app.page = state.page;
  app.sourceVersion = state.sourceVersion;
  app.styleVersion = state.styleVersion;
  app.manifestStatus = state.manifestStatus;
  app.stylesheets = state.stylesheets;
  app.effectiveManifest = state.manifest;
  app.baselineTree = null;
  app.currentTree = null;
  app.added = new Map();
  app.removed = new Set();
  app.moved = [];
  app.notes = {};
  app.layoutHints = {};
  app.globalNote = '';
  app.selectedId = '';
  app.unresolved = [];
  app.stale = state.manifestStatus === 'stale';
  app.submitted = false;
  if (app.stale) setBanners([{ text: '清单已过期，请让 agent 重新生成。', error: true }]);
  else if (state.manifestStatus !== 'ok') setBanners([{ text: '清单缺失或无效，正在使用启发式模块。' }]);
  renderPageSelect(state.pages, page);
  const src = state.previewOrigin + '/' + page.split('/').map(encodeURIComponent).join('/');
  ui.frame.src = src;
  renderInspector();
  renderSummary();
  startPolling();
}

function startPolling() {
  stopPolling();
  app.pollTimer = setInterval(async () => {
    if (!app.state || document.visibilityState === 'hidden') return;
    try {
      const version = await api('/api/version?page=' + encodeURIComponent(app.state.page));
      app.stale = version.sourceVersion !== app.state.sourceVersion || version.styleVersion !== app.state.styleVersion;
      if (app.stale) setBanners([{ text: '文件已在磁盘上改变，请重新打开或刷新。', error: true }]);
      renderSummary();
    } catch {
      /* a failed poll is not fatal */
    }
  }, 4000);
}

function stopPolling() {
  if (app.pollTimer) clearInterval(app.pollTimer);
  app.pollTimer = null;
}

window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || !app.state) return;
  if (event.source !== ui.frame.contentWindow) return;
  if (event.origin !== app.state.previewOrigin) return;
  if (data.runtimeToken !== app.state.runtimeToken) return;
  if (data.type === 'boot') {
    const bootPage = decodeURIComponent(data.page || '');
    if (bootPage && bootPage !== app.state.page) {
      const changes = countChanges(app);
      const dirty = changes.moved + changes.added + changes.removed + changes.notes > 0;
      if (dirty && !window.confirm('预览跳转到了 ' + bootPage + '，放弃当前未提交改动？')) {
        loadPage(app.state.page);
        return;
      }
      loadPage(bootPage);
      return;
    }
    postToFrame({
      type: 'manifest',
      runtimeToken: app.state.runtimeToken,
      manifest: app.effectiveManifest,
      sourceVersion: app.state.sourceVersion,
      styleVersion: app.state.styleVersion,
    });
  }
  if (data.type === 'ready') {
    app.baselineTree = data.tree;
    app.currentTree = data.tree;
    app.unresolved = data.unresolved || [];
    if (data.manifest) app.effectiveManifest = data.manifest;
    renderInspector();
    renderSummary();
  }
  if (data.type === 'tree') {
    app.currentTree = data.tree;
    const previous = app.added;
    app.added = new Map((data.added || []).map((item) => [
      item.id,
      { ...item, note: previous.get(item.id)?.note || item.note || '' },
    ]));
    app.removed = new Set(data.removed || []);
    app.moved = data.moved || [];
    renderSummary();
  }
  if (data.type === 'select') {
    app.selectedId = data.id || '';
    renderInspector();
  }
  if (data.type === 'error') {
    setBanners([{ text: data.message || '预览错误', error: true }]);
  }
});

ui.pageSelect.addEventListener('change', async () => {
  if (app.currentTree && countChanges(app).moved + countChanges(app).added + countChanges(app).removed + countChanges(app).notes > 0) {
    if (!window.confirm('放弃当前未提交的改动并切换页面？')) {
      renderPageSelect(app.state.pages, app.state.page);
      return;
    }
  }
  await loadPage(ui.pageSelect.value);
});

for (const button of document.querySelectorAll('.viewports button')) {
  button.addEventListener('click', () => {
    for (const other of document.querySelectorAll('.viewports button')) other.classList.remove('active');
    button.classList.add('active');
    ui.frameWrap.style.width = button.dataset.width + 'px';
  });
}

ui.reset.addEventListener('click', () => {
  if (!window.confirm('重置所有拖拽和备注？')) return;
  app.notes = {};
  app.layoutHints = {};
  app.globalNote = '';
  app.added = new Map();
  app.removed = new Set();
  app.moved = [];
  app.selectedId = '';
  postToFrame({ type: 'reset', runtimeToken: app.state.runtimeToken });
  renderInspector();
  renderSummary();
});

ui.submit.addEventListener('click', async () => {
  const errors = validateForSubmit(app);
  if (errors.length) return;
  ui.submit.disabled = true;
  try {
    const manifest = app.effectiveManifest || app.state.manifest;
    if (manifest) {
      await api('/api/manifest?page=' + encodeURIComponent(app.state.page), {
        method: 'PUT',
        body: { manifest },
      });
    }
    const intent = buildIntent(app);
    const result = await api('/api/intent', { method: 'POST', body: { intent } });
    app.submitted = true;
    setBanners([{ text: '意图已保存到 ' + result.path + '，请回到 Claude Code。' }]);
  } catch (error) {
    setBanners([{ text: '提交失败：' + error.message, error: true }]);
  } finally {
    renderSummary();
  }
});

async function boot() {
  renderPalette();
  renderInspector();
  const page = new URLSearchParams(location.search).get('page') || '';
  try {
    const pages = (await api('/api/pages')).pages;
    const target = page || pages[0] || '';
    if (!target) {
      setBanners([{ text: '工作区里没有 HTML 页面。', error: true }]);
      return;
    }
    await loadPage(target);
  } catch (error) {
    setBanners([{ text: '加载失败：' + error.message, error: true }]);
  }
}

boot();
```

- [ ] **Step 8: Run the state tests and the server tests**

Run: `node --test .claude/skills/web-layout/tests/state.test.mjs .claude/skills/web-layout/tests/server.test.mjs`
Expected: PASS.

- [ ] **Step 9: Manual shell check**

Run:
```bash
node .claude/skills/web-layout/scripts/server.mjs --root .claude/skills/web-layout/tests/fixtures/site --page index.html --open
```
Expected: the editor opens; page select shows `about.html` and `index.html`; the iframe shows the fixture page; the palette lists the nine module types. The overlay is absent until Task 11. Stop with `node .claude/skills/web-layout/scripts/server.mjs --root .claude/skills/web-layout/tests/fixtures/site --stop`.

- [ ] **Step 10: Commit**

```bash
git add .claude/skills/web-layout/editor/index.html .claude/skills/web-layout/editor/editor.css .claude/skills/web-layout/editor/api.js .claude/skills/web-layout/editor/state.js .claude/skills/web-layout/editor/editor.js .claude/skills/web-layout/tests/state.test.mjs
git commit -m "feat(web-layout): add editor shell, API client, and intent builder"
```

---

### Task 10: Pure runtime model (roles, layout, segmentation, insertion math)

**Files:**
- Create: `.claude/skills/web-layout/editor/runtime/model.js`
- Create: `.claude/skills/web-layout/tests/model.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `textPreview(text, max?)`, `fingerprintOf({tag, className, text})`, `roleOf({tag, className})`, `layoutOf({display, flexDirection, gridTemplateColumns})`, `computeInsertionIndex(rects, pointer, layout)`, `findParent(nodes, id)`, `isDescendant(nodes, ancestorId, id)`, `segment(rootDescriptor, {maxDepth})`.

- [ ] **Step 1: Write the failing tests**

`tests/model.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  roleOf,
  layoutOf,
  fingerprintOf,
  computeInsertionIndex,
  findParent,
  isDescendant,
  segment,
} from '../editor/runtime/model.js';

test('roleOf maps tags and classes to semantic roles', () => {
  assert.equal(roleOf({ tag: 'header', className: '' }), 'header');
  assert.equal(roleOf({ tag: 'nav', className: '' }), 'nav');
  assert.equal(roleOf({ tag: 'section', className: '' }), 'section');
  assert.equal(roleOf({ tag: 'h2', className: '' }), 'heading');
  assert.equal(roleOf({ tag: 'p', className: '' }), 'paragraph');
  assert.equal(roleOf({ tag: 'img', className: '' }), 'image');
  assert.equal(roleOf({ tag: 'ul', className: '' }), 'list');
  assert.equal(roleOf({ tag: 'hr', className: '' }), 'divider');
  assert.equal(roleOf({ tag: 'button', className: '' }), 'button');
  assert.equal(roleOf({ tag: 'div', className: 'cards' }), 'cards');
  assert.equal(roleOf({ tag: 'div', className: 'plain' }), 'container');
});

test('layoutOf maps flex and grid', () => {
  assert.equal(layoutOf({ display: 'flex', flexDirection: 'row', gridTemplateColumns: 'none' }), 'row');
  assert.equal(layoutOf({ display: 'flex', flexDirection: 'column', gridTemplateColumns: 'none' }), 'column');
  assert.equal(layoutOf({ display: 'grid', flexDirection: 'row', gridTemplateColumns: 'repeat(2, 1fr)' }), 'grid-2col');
  assert.equal(layoutOf({ display: 'grid', flexDirection: 'row', gridTemplateColumns: '1fr 1fr 1fr' }), 'grid-3col');
  assert.equal(layoutOf({ display: 'grid', flexDirection: 'row', gridTemplateColumns: 'repeat(6, 1fr)' }), 'grid-auto');
  assert.equal(layoutOf({ display: 'block', flexDirection: 'row', gridTemplateColumns: 'none' }), 'flow');
});

test('fingerprintOf and textPreview normalize text', () => {
  assert.equal(fingerprintOf({ tag: 'h2', className: 'title big', text: '  Hello\n world  ' }), 'h2|title|Hello world');
  assert.equal(fingerprintOf({ tag: 'p', className: '', text: '' }), 'p||');
});

function rects() {
  return [
    { left: 0, top: 0, width: 100, height: 50 },
    { left: 0, top: 60, width: 100, height: 50 },
    { left: 0, top: 120, width: 100, height: 50 },
  ];
}

test('computeInsertionIndex for column layout', () => {
  assert.equal(computeInsertionIndex(rects(), { x: 10, y: 10 }, 'column'), 0);
  assert.equal(computeInsertionIndex(rects(), { x: 10, y: 70 }, 'column'), 1);
  assert.equal(computeInsertionIndex(rects(), { x: 10, y: 200 }, 'column'), 3);
});

test('computeInsertionIndex for row and grid layouts', () => {
  const row = [
    { left: 0, top: 0, width: 100, height: 50 },
    { left: 110, top: 0, width: 100, height: 50 },
  ];
  assert.equal(computeInsertionIndex(row, { x: 10, y: 10 }, 'row'), 0);
  assert.equal(computeInsertionIndex(row, { x: 160, y: 10 }, 'row'), 1);
  assert.equal(computeInsertionIndex(row, { x: 300, y: 10 }, 'row'), 2);

  const grid = [
    { left: 0, top: 0, width: 100, height: 50 },
    { left: 110, top: 0, width: 100, height: 50 },
    { left: 0, top: 60, width: 100, height: 50 },
    { left: 110, top: 60, width: 100, height: 50 },
  ];
  assert.equal(computeInsertionIndex(grid, { x: 140, y: 80 }, 'grid-2col'), 3);
  assert.equal(computeInsertionIndex(grid, { x: 140, y: 10 }, 'grid-2col'), 1);
});

test('findParent and isDescendant walk a tree', () => {
  const tree = [{ id: 'a', children: [{ id: 'b', children: [{ id: 'c' }] }] }];
  assert.equal(findParent(tree, 'c').id, 'b');
  assert.equal(findParent(tree, 'a'), null);
  assert.equal(isDescendant(tree, 'a', 'c'), true);
  assert.equal(isDescendant(tree, 'c', 'a'), false);
});

test('segment builds top-level modules and containers', () => {
  const root = {
    tag: 'body', id: '', dataModule: '', className: '', text: 'Page', display: 'block', flexDirection: 'row', gridTemplateColumns: 'none', visible: true,
    children: [
      { tag: 'header', id: '', dataModule: 'site-header', className: 'site-header', text: 'Header', display: 'block', flexDirection: 'row', gridTemplateColumns: 'none', visible: true, children: [] },
      { tag: 'section', id: '', dataModule: 'hero', className: 'hero', text: 'Hero', display: 'grid', flexDirection: 'row', gridTemplateColumns: 'repeat(2, 1fr)', visible: true, children: [
        { tag: 'div', id: '', dataModule: '', className: 'hero-copy', text: 'Copy', display: 'block', flexDirection: 'row', gridTemplateColumns: 'none', visible: true, children: [
          { tag: 'h2', id: '', dataModule: '', className: '', text: 'Title', display: 'block', flexDirection: 'row', gridTemplateColumns: 'none', visible: true, children: [] },
          { tag: 'p', id: '', dataModule: '', className: '', text: 'Body', display: 'block', flexDirection: 'row', gridTemplateColumns: 'none', visible: true, children: [] },
        ] },
        { tag: 'div', id: '', dataModule: '', className: 'hero-art', text: 'Art', display: 'block', flexDirection: 'row', gridTemplateColumns: 'none', visible: true, children: [] },
      ] },
      { tag: 'footer', id: '', dataModule: 'site-footer', className: 'site-footer', text: 'Footer', display: 'block', flexDirection: 'row', gridTemplateColumns: 'none', visible: true, children: [] },
    ],
  };
  const modules = segment(root);
  assert.deepEqual(modules.map((m) => m.id), ['site-header', 'hero', 'site-footer']);
  assert.equal(modules[1].container, true);
  assert.equal(modules[1].layout, 'grid-2col');
  assert.equal(modules[1].children.length, 2);
  assert.equal(modules[1].children[0].children.length, 2);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test .claude/skills/web-layout/tests/model.test.mjs`
Expected: FAIL with `Cannot find module '../editor/runtime/model.js'`.

- [ ] **Step 3: Implement `model.js`**

```js
const SKIP = new Set(['script', 'style', 'link', 'meta', 'template', 'noscript', 'br']);
const SEMANTIC_CONTAINERS = new Set(['header', 'nav', 'footer', 'section', 'article', 'aside', 'main', 'form', 'container']);

export function textPreview(text, max = 80) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function firstClass(className) {
  const parts = String(className || '').split(/\s+/).filter(Boolean);
  return parts[0] || '';
}

export function fingerprintOf({ tag, className, text }) {
  return String(tag || '').toLowerCase() + '|' + firstClass(className) + '|' + textPreview(text, 40);
}

export function roleOf({ tag, className }) {
  const name = String(tag || '').toLowerCase();
  const cls = String(className || '').toLowerCase();
  if (name === 'header') return 'header';
  if (name === 'nav') return 'nav';
  if (name === 'footer') return 'footer';
  if (name === 'section') return 'section';
  if (name === 'article') return 'article';
  if (name === 'aside') return 'aside';
  if (name === 'form') return 'form';
  if (/^h[1-6]$/.test(name)) return 'heading';
  if (name === 'p') return 'paragraph';
  if (name === 'img' || name === 'picture' || name === 'figure') return 'image';
  if (name === 'ul' || name === 'ol') return 'list';
  if (name === 'table') return 'table';
  if (name === 'hr') return 'divider';
  if (name === 'button' || name === 'a') return name === 'a' ? 'link' : 'button';
  if (/\bcard(s)?\b|card-grid/.test(cls)) return 'cards';
  if (name === 'div' || name === 'main') return 'container';
  return 'block';
}

export function layoutOf({ display, flexDirection, gridTemplateColumns }) {
  if (display === 'flex') return flexDirection === 'column' ? 'column' : 'row';
  if (display === 'grid') {
    const value = String(gridTemplateColumns || 'none');
    const repeat = /repeat\((\d+)/.exec(value);
    let count = 0;
    if (repeat) count = Number(repeat[1]);
    else count = value.split(/\s+/).filter((part) => part && part !== 'none').length;
    if (!count || count === 1 || count > 4) return 'grid-auto';
    return 'grid-' + count + 'col';
  }
  return 'flow';
}

export function computeInsertionIndex(rects, pointer, layout) {
  if (!rects.length) return 0;
  if (layout === 'row') {
    for (let i = 0; i < rects.length; i += 1) {
      if (pointer.x < rects[i].left + rects[i].width / 2) return i;
    }
    return rects.length;
  }
  if (String(layout || '').startsWith('grid')) {
    const rows = [];
    for (let i = 0; i < rects.length; i += 1) {
      const rect = rects[i];
      let row = rows.find((candidate) => Math.abs(candidate.top - rect.top) < 12);
      if (!row) {
        row = { top: rect.top, items: [] };
        rows.push(row);
      }
      row.items.push({ rect, index: i });
    }
    rows.sort((a, b) => a.top - b.top);
    for (const row of rows) row.items.sort((a, b) => a.rect.left - b.rect.left);
    for (const row of rows) {
      const top = row.items[0].rect.top;
      const bottom = Math.max(...row.items.map((item) => item.rect.top + item.rect.height));
      if (pointer.y < top + (bottom - top) / 2) {
        for (const item of row.items) {
          if (pointer.x < item.rect.left + item.rect.width / 2) return item.index;
        }
        return row.items[row.items.length - 1].index + 1;
      }
    }
    return rects.length;
  }
  for (let i = 0; i < rects.length; i += 1) {
    if (pointer.y < rects[i].top + rects[i].height / 2) return i;
  }
  return rects.length;
}

export function findParent(nodes, id, parent = null) {
  for (const node of nodes || []) {
    if (node.id === id) return parent;
    const found = findParent(node.children, id, node);
    if (found !== null && found !== undefined) return found;
  }
  return null;
}

export function isDescendant(nodes, ancestorId, id) {
  const ancestor = (function find(list) {
    for (const node of list || []) {
      if (node.id === ancestorId) return node;
      const found = find(node.children);
      if (found) return found;
    }
    return null;
  })(nodes);
  if (!ancestor) return false;
  const walk = (list) => (list || []).some((node) => node.id === id || walk(node.children));
  return walk(ancestor.children);
}

function pickRoot(descriptor) {
  let root = descriptor;
  for (let i = 0; i < 2; i += 1) {
    const children = (root.children || []).filter((child) => child.visible !== false);
    if (children.length === 1 && (children[0].children || []).length >= 2) root = children[0];
    else break;
  }
  return root;
}

export function segment(rootDescriptor, { maxDepth = 3 } = {}) {
  const root = pickRoot(rootDescriptor);
  let seq = 0;
  const walk = (descriptor, depth) => {
    const role = roleOf(descriptor);
    const layout = layoutOf(descriptor);
    const children = (descriptor.children || [])
      .filter((child) => child.visible !== false && !SKIP.has(String(child.tag || '').toLowerCase()));
    const container = depth < maxDepth
      && children.length >= 2
      && (SEMANTIC_CONTAINERS.has(role) || layout !== 'flow');
    seq += 1;
    const base = descriptor.dataModule || descriptor.id || (role + '-' + seq);
    const id = String(base).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || ('block-' + seq);
    return {
      id,
      role,
      label: descriptor.dataModule || descriptor.id || role,
      ref: descriptor.ref || '',
      matchIndex: 0,
      tag: descriptor.tag,
      classes: descriptor.className || '',
      text: textPreview(descriptor.text),
      fingerprint: fingerprintOf(descriptor),
      container,
      layout,
      children: container ? children.map((child) => walk(child, depth + 1)) : [],
    };
  };
  return (root.children || [])
    .filter((child) => child.visible !== false && !SKIP.has(String(child.tag || '').toLowerCase()))
    .map((child) => walk(child, 1));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test .claude/skills/web-layout/tests/model.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/web-layout/editor/runtime/model.js .claude/skills/web-layout/tests/model.test.mjs
git commit -m "feat(web-layout): add pure runtime model and segmentation"
```

---

### Task 11: DOM adapter, overlay, runtime boot protocol

**Files:**
- Create: `.claude/skills/web-layout/editor/runtime/dom.js`
- Create: `.claude/skills/web-layout/editor/runtime/overlay.js`
- Create: `.claude/skills/web-layout/editor/runtime/runtime.js`
- Modify: `.claude/skills/web-layout/editor/editor.js` (selection rendering)

**Interfaces:**
- Consumes: `textPreview`, `fingerprintOf`, `segment` from `./model.js`; `CONTAINER_TYPES` from `./constants.js`.
- Produces: `toDescriptor(el, win)`, `descriptorRoot(doc, win)`, `heuristicManifest(doc, win, {page, sourceVersion})`, `buildTree(doc, manifest, added)`, `serializeTree(nodes)`, `serializeRoot(nodes)`, `createOverlay(doc, win, {onSelect, onHandleDown})`.

- [ ] **Step 1: Implement `dom.js`**

```js
import { textPreview, fingerprintOf, segment } from './model.js';
import { CONTAINER_TYPES } from './constants.js';

const SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT', 'BR']);
const FOLLOWING = 4;
const PRECEDING = 2;

export function buildRef(el) {
  const dataModule = el.getAttribute && el.getAttribute('data-module');
  if (dataModule) return '[data-module="' + dataModule.replace(/"/g, '\\"') + '"]';
  if (el.id) return '#' + el.id;
  const doc = el.ownerDocument || document;
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1 && node !== doc.body && node !== doc.documentElement) {
    const tag = node.tagName.toLowerCase();
    const parent = node.parentElement;
    const siblings = parent ? Array.from(parent.children).filter((item) => item.tagName === node.tagName) : [node];
    parts.unshift(tag + ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')');
    node = parent;
  }
  return parts.join(' > ');
}

export function toDescriptor(el, win) {
  const style = win.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const children = [];
  for (const child of el.children) {
    if (SKIP.has(child.tagName)) continue;
    const childRect = child.getBoundingClientRect();
    if (childRect.width <= 0 && childRect.height <= 0) continue;
    children.push(toDescriptor(child, win));
  }
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || '',
    dataModule: el.getAttribute('data-module') || '',
    ref: buildRef(el),
    matchIndex: 0,
    className: typeof el.className === 'string' ? el.className : '',
    text: textPreview(el.textContent || ''),
    display: style.display,
    flexDirection: style.flexDirection,
    gridTemplateColumns: style.gridTemplateColumns,
    visible: rect.width > 0 && rect.height > 0,
    children,
  };
}

export function descriptorRoot(doc, win) {
  const main = doc.querySelector('main');
  const base = main || doc.body || doc.documentElement;
  return toDescriptor(base, win);
}

export function heuristicManifest(doc, win, { page, sourceVersion }) {
  return {
    schema: 1,
    page,
    generatedBy: 'editor-heuristic',
    sourceVersion: sourceVersion || '',
    stylesheets: [],
    modules: segment(descriptorRoot(doc, win)),
  };
}

function flatten(modules, out = []) {
  for (const mod of modules || []) {
    out.push(mod);
    flatten(mod.children, out);
  }
  return out;
}

/**
 * Build the module tree from DOM positions, not from the manifest's array order.
 * This is what makes drags, cross-container moves, removals, and palette additions
 * visible to the editor and to the intent tree.
 */
export function buildTree(doc, manifest, added = new Map()) {
  const unresolved = [];
  const byEl = new Map();
  const byId = new Map();

  function register(el, module) {
    if (!el || el.closest('[data-web-layout-removed]')) return;
    el.setAttribute('data-web-layout-id', module.id);
    const node = { id: module.id, module, el, children: [] };
    byEl.set(el, node);
    byId.set(module.id, node);
  }

  for (const mod of flatten(manifest.modules)) {
    let el = null;
    try {
      const matches = doc.querySelectorAll(mod.ref);
      el = matches[mod.matchIndex || 0] || null;
    } catch {
      el = null;
    }
    if (!el) {
      unresolved.push({ id: mod.id, reason: 'not found' });
      continue;
    }
    const fingerprint = fingerprintOf({
      tag: el.tagName.toLowerCase(),
      className: typeof el.className === 'string' ? el.className : '',
      text: textPreview(el.textContent || ''),
    });
    if (mod.fingerprint && fingerprint !== mod.fingerprint) {
      unresolved.push({ id: mod.id, reason: 'fingerprint mismatch' });
      continue;
    }
    register(el, mod);
  }

  for (const el of doc.querySelectorAll('[data-web-layout-added]')) {
    const id = el.getAttribute('data-web-layout-id');
    if (!id || byId.has(id)) continue;
    const type = el.getAttribute('data-web-layout-added');
    const info = added instanceof Map ? added.get(id) : null;
    register(el, {
      id,
      role: 'block',
      label: info && info.label ? info.label : type,
      ref: '',
      matchIndex: 0,
      tag: el.tagName.toLowerCase(),
      classes: typeof el.className === 'string' ? el.className : '',
      text: textPreview(el.textContent || ''),
      fingerprint: '',
      container: CONTAINER_TYPES.has(type),
      layout: type === 'columns-2' ? 'grid-2col' : type === 'columns-3' ? 'grid-3col' : 'flow',
    });
  }

  const roots = [];
  for (const [el, node] of byEl) {
    let parentEl = el.parentElement;
    let parentNode = null;
    while (parentEl) {
      if (byEl.has(parentEl)) {
        parentNode = byEl.get(parentEl);
        break;
      }
      parentEl = parentEl.parentElement;
    }
    if (parentNode) parentNode.children.push(node);
    else roots.push(node);
  }

  const sortByDom = (nodes) => {
    nodes.sort((a, b) => {
      const position = a.el.compareDocumentPosition(b.el);
      if (position & FOLLOWING) return -1;
      if (position & PRECEDING) return 1;
      return 0;
    });
    for (const node of nodes) sortByDom(node.children);
  };
  sortByDom(roots);
  return { nodes: roots, unresolved, byId };
}

export function serializeTree(nodes) {
  return (nodes || []).map((node) => ({
    id: node.id,
    ...(node.children && node.children.length ? { children: serializeTree(node.children) } : {}),
  }));
}

export function serializeRoot(nodes) {
  return [{ id: '__root__', children: serializeTree(nodes) }];
}
```

- [ ] **Step 2: Implement `overlay.js`**

```js
export function createOverlay(doc, win, { onSelect, onHandleDown }) {
  const host = doc.createElement('div');
  host.setAttribute('data-web-layout-overlay', '');
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = doc.createElement('style');
  style.textContent = [
    '.box{position:fixed;pointer-events:none;border:2px dashed rgba(47,111,237,.55);border-radius:8px;box-sizing:border-box;display:none}',
    '.box.selected{border-style:solid;border-color:#2f6fed;background:rgba(47,111,237,.04)}',
    '.box.drop{border-style:solid;border-color:#16a34a;background:rgba(22,163,74,.06)}',
    '.handle{position:fixed;pointer-events:auto;cursor:grab;height:22px;display:none;align-items:center;padding:0 8px;border-radius:11px;background:#2f6fed;color:#fff;font:600 11px/1 system-ui,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.25);user-select:none;white-space:nowrap;max-width:70%;overflow:hidden;text-overflow:ellipsis;touch-action:none}',
    '.line{position:fixed;height:3px;border-radius:2px;background:#2f6fed;box-shadow:0 0 0 2px rgba(47,111,237,.2);display:none;pointer-events:none}',
  ].join('');
  const line = doc.createElement('div');
  line.className = 'line';
  shadow.append(style, line);
  doc.documentElement.appendChild(host);

  const entries = new Map();
  let selectedId = '';
  let dropId = '';

  function flatten(nodes, out = []) {
    for (const node of nodes || []) {
      out.push(node);
      flatten(node.children, out);
    }
    return out;
  }

  function updateClasses() {
    for (const [id, entry] of entries) {
      entry.box.classList.toggle('selected', id === selectedId);
      entry.box.classList.toggle('drop', id === dropId);
    }
  }

  function ensure(node) {
    if (entries.has(node.id)) return entries.get(node.id);
    const box = doc.createElement('div');
    box.className = 'box';
    const handle = doc.createElement('div');
    handle.className = 'handle';
    handle.setAttribute('role', 'button');
    handle.addEventListener('pointerdown', (event) => onHandleDown(node.id, event));
    shadow.append(box, handle);
    const entry = { node, box, handle };
    entries.set(node.id, entry);
    return entry;
  }

  function layout(nodes) {
    const live = new Set(flatten(nodes).map((node) => node.id));
    for (const [id, entry] of entries) {
      if (!live.has(id)) {
        entry.box.remove();
        entry.handle.remove();
        entries.delete(id);
      }
    }
    const walk = (list) => {
      for (const node of list || []) {
        const entry = ensure(node);
        entry.node = node;
        const rect = node.el.getBoundingClientRect();
        const visible = rect.bottom > 2 && rect.top < win.innerHeight - 2 && rect.width > 4 && rect.height > 2;
        entry.box.style.display = visible ? 'block' : 'none';
        entry.handle.style.display = visible ? 'flex' : 'none';
        if (visible) {
          entry.box.style.left = rect.left + 'px';
          entry.box.style.top = rect.top + 'px';
          entry.box.style.width = rect.width + 'px';
          entry.box.style.height = rect.height + 'px';
          entry.handle.style.left = rect.left + 6 + 'px';
          entry.handle.style.top = rect.top + 6 + 'px';
          const flat = flatten(nodes);
          const index = flat.findIndex((item) => item.id === node.id);
          entry.handle.textContent = (index + 1) + ' · ' + (node.module?.label || node.id);
        }
        walk(node.children);
      }
    };
    walk(nodes);
    updateClasses();
  }

  function showLine(rect) {
    line.style.display = 'block';
    line.style.left = rect.left + 'px';
    line.style.top = rect.top + 'px';
    line.style.width = Math.max(20, rect.width) + 'px';
  }

  function hideLine() {
    line.style.display = 'none';
  }

  return {
    layout,
    render: layout,
    showLine,
    hideLine,
    setSelected(id) { selectedId = id || ''; updateClasses(); },
    setDropTarget(id) { dropId = id || ''; updateClasses(); },
    destroy() { host.remove(); entries.clear(); },
  };
}
```

- [ ] **Step 3: Add the no-drag runtime behavior**

Handles select modules in this task. Task 12 creates `drag.js` and replaces the handle callback with `drag.begin(...)`. Do not create `drag.js` yet.

- [ ] **Step 4: Implement `runtime.js`**

```js
import { buildTree, heuristicManifest, serializeRoot } from './dom.js';
import { createOverlay } from './overlay.js';

const config = window.__WEB_LAYOUT__;
if (config) boot(config);

function boot(config) {
  const editorOrigin = config.editorOrigin;
  const runtimeToken = config.runtimeToken;
  let manifest = null;
  let tree = [];
  let unresolved = [];
  let added = new Map();
  let removed = new Set();
  let moved = [];
  let selected = '';
  let overlay = null;

  const post = (message) => {
    try {
      window.parent.postMessage({ ...message, runtimeToken }, editorOrigin);
    } catch {
      /* the editor may have gone away */
    }
  };

  function currentPage() {
    return location.pathname.replace(/^\/+/, '') || 'index.html';
  }

  function build() {
    if (!manifest) {
      manifest = heuristicManifest(document, window, { page: currentPage(), sourceVersion: '' });
    }
    const built = buildTree(document, manifest, added);
    tree = built.nodes;
    unresolved = built.unresolved;
    overlay.layout(tree);
  }

  function sendTree() {
    post({
      type: 'tree',
      page: currentPage(),
      tree: serializeRoot(tree),
      added: [...added.values()].filter((item) => !removed.has(item.id)),
      removed: [...removed],
      moved,
    });
  }

  overlay = createOverlay(document, window, {
    onSelect: (id) => {
      selected = id;
      overlay.setSelected(id);
      post({ type: 'select', id });
    },
    onHandleDown: (id) => {
      selected = id;
      overlay.setSelected(id);
      post({ type: 'select', id });
    },
  });

  window.addEventListener('message', (event) => {
    if (event.origin !== editorOrigin) return;
    const data = event.data;
    if (!data || data.runtimeToken !== runtimeToken) return;
    if (data.type === 'manifest') {
      manifest = data.manifest || null;
      if (!manifest) {
        manifest = heuristicManifest(document, window, {
          page: currentPage(),
          sourceVersion: data.sourceVersion || '',
        });
      }
      build();
      post({
        type: 'ready',
        page: currentPage(),
        tree: serializeRoot(tree),
        unresolved,
        manifest,
      });
    }
    if (data.type === 'reset') location.reload();
  });

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!target || !target.closest) return;
    const el = target.closest('[data-web-layout-id]');
    if (!el) return;
    event.preventDefault();
    event.stopPropagation();
    selected = el.getAttribute('data-web-layout-id');
    overlay.setSelected(selected);
    post({ type: 'select', id: selected });
  }, true);

  const relayout = () => overlay.layout(tree);
  window.addEventListener('scroll', relayout, true);
  window.addEventListener('resize', relayout);
  if (typeof window.ResizeObserver === 'function') {
    new window.ResizeObserver(relayout).observe(document.body);
  }
  if (typeof window.MutationObserver === 'function') {
    new window.MutationObserver(relayout).observe(document.body, { childList: true, subtree: false });
  }

  post({ type: 'boot', page: currentPage() });
}
```

- [ ] **Step 5: Wire selection in `editor.js`**

In the `window.addEventListener('message', ...)` handler, the shell already handles `select`. Replace `renderInspector()`'s selected block with a name lookup:

```js
function selectedLabel(id) {
  const index = moduleIndex(app.effectiveManifest || { modules: [] });
  const mod = index.get(id);
  return mod ? (mod.label || mod.id) : id;
}
```

Use `selectedLabel(app.selectedId)` in the inspector text.

- [ ] **Step 6: Manual overlay check**

Run the server on the fixture site, open the editor, and confirm:

1. With an agent-written manifest, numbered blue handles appear on `site-header`, `hero`, `features`, and `site-footer`.
2. Without a manifest, the heuristic tree appears (typically the children of `main`) and the editor shows the heuristic banner.
3. Clicking a module outlines it and the inspector shows its id/label.
4. Scrolling the preview keeps boxes aligned.
5. The editor shows no unresolved banner when the manifest selectors resolve.

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/web-layout/editor/runtime/dom.js .claude/skills/web-layout/editor/runtime/overlay.js .claude/skills/web-layout/editor/runtime/runtime.js .claude/skills/web-layout/editor/editor.js
git commit -m "feat(web-layout): overlay modules and boot the injected runtime"
```

---

### Task 12: Same-container drag and reorder

**Files:**
- Create: `.claude/skills/web-layout/editor/runtime/drag.js`
- Modify: `.claude/skills/web-layout/editor/runtime/runtime.js` (wire the controller)

**Interfaces:**
- Consumes: `computeInsertionIndex`, `findParent` from `./model.js`.
- Produces: `createDragController({document, window, overlay, getTree, getManifest, onChange, onMoved})` → `{begin(id, event)}`.

- [ ] **Step 1: Create the same-container controller**

```js
import { computeInsertionIndex, findParent } from './model.js';

export function createDragController({ document, window, overlay, getTree, onChange, onMoved }) {
  let drag = null;

  function nodeById(nodes, id) {
    for (const node of nodes || []) {
      if (node.id === id) return node;
      const found = nodeById(node.children, id);
      if (found) return found;
    }
    return null;
  }

  function siblingsOf(id) {
    const parent = findParent(getTree(), id);
    return parent ? parent.children : getTree();
  }

  function parentIdOf(id) {
    const parent = findParent(getTree(), id);
    return parent ? parent.id : '__root__';
  }

  function lineRect(others, index, parentNode) {
    if (others[index]) {
      const rect = others[index].el.getBoundingClientRect();
      return { left: rect.left, top: rect.top - 2, width: rect.width };
    }
    if (others.length) {
      const rect = others[others.length - 1].el.getBoundingClientRect();
      return { left: rect.left, top: rect.bottom - 1, width: rect.width };
    }
    const rect = (parentNode ? parentNode.el : document.body).getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width };
  }

  function begin(id, event) {
    if (drag) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const node = nodeById(getTree(), id);
    if (!node) return;
    event.preventDefault();
    event.stopPropagation();
    drag = {
      id,
      node,
      pointerId: event.pointerId,
      origin: { x: event.clientX, y: event.clientY },
      targetIndex: -1,
    };
    try { event.target.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    window.addEventListener('keydown', onKey, true);
  }

  function onMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const parent = findParent(getTree(), drag.id);
    const parentNode = parent || null;
    const others = (parentNode ? parentNode.children : getTree()).filter((node) => node.id !== drag.id);
    const rects = others.map((node) => node.el.getBoundingClientRect());
    const index = computeInsertionIndex(rects, { x: event.clientX, y: event.clientY }, parentNode?.module?.layout || 'flow');
    drag.targetIndex = index;
    overlay.showLine(lineRect(others, index, parentNode));
  }

  function onUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const current = drag;
    finish();
    const parent = findParent(getTree(), current.id);
    const parentNode = parent || null;
    const parentEl = parentNode ? parentNode.el : (current.node.el.parentNode || document.body);
    const others = (parentNode ? parentNode.children : getTree()).filter((node) => node.id !== current.id);
    const index = Math.max(0, Math.min(current.targetIndex, others.length));
    const oldIndex = (parentNode ? parentNode.children : getTree()).findIndex((node) => node.id === current.id);
    if (oldIndex === index) return;
    parentEl.insertBefore(current.node.el, others[index] ? others[index].el : null);
    onMoved({
      module: current.id,
      from: { parent: parentNode ? parentNode.id : '__root__', index: oldIndex },
      to: { parent: parentNode ? parentNode.id : '__root__', index },
    });
    onChange();
  }

  function onCancel() {
    finish();
  }

  function onKey(event) {
    if (event.key === 'Escape' && drag) {
      event.preventDefault();
      finish();
    }
  }

  function finish() {
    drag = null;
    overlay.hideLine();
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
    window.removeEventListener('keydown', onKey, true);
  }

  return { begin };
}
```

- [ ] **Step 2: Wire the controller into `runtime.js`**

Add the import and replace the handle callback:

```js
import { createDragController } from './drag.js';
```

```js
  let drag = null;
```

```js
  overlay = createOverlay(document, window, {
    onSelect: (id) => {
      selected = id;
      overlay.setSelected(id);
      post({ type: 'select', id });
    },
    onHandleDown: (id, event) => drag.begin(id, event),
  });

  drag = createDragController({
    document,
    window,
    overlay,
    getTree: () => tree,
    getManifest: () => manifest,
    onChange: () => { build(); sendTree(); },
    onMoved: (item) => {
      moved = moved.filter((existing) => existing.module !== item.module);
      moved.push(item);
    },
  });
```

- [ ] **Step 3: Manual same-container check**

Run the server on the fixture site. In the editor:

1. Drag `hero` below `features`. A blue insertion line appears between features and the footer.
2. Drop. The preview reorders; the summary shows `移动 1`.
3. Drag `hero` back above `features`. The summary counts the explicit moves; the final `tree` is authoritative.
4. Press `Escape` mid-drag; no DOM change.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/web-layout/editor/runtime/drag.js .claude/skills/web-layout/editor/runtime/runtime.js
git commit -m "feat(web-layout): reorder modules inside a container"
```

---

### Task 13: Cross-container drag and invalid drops

**Files:**
- Modify: `.claude/skills/web-layout/editor/runtime/drag.js`
- Modify: `.claude/skills/web-layout/editor/runtime/overlay.js` (drop highlight already present)

**Interfaces:**
- Consumes: `computeInsertionIndex`, `findParent`, `isDescendant` from `./model.js`.
- Produces: same `createDragController`; cross-container targets now resolve to `{parentId, index, parentNode}`.

- [ ] **Step 1: Add target resolution to `drag.js`**

Add these functions inside `createDragController` and replace the target computation in `onMove`/`onUp`:

```js
  function childRects(node) {
    return (node.children || []).filter((child) => child.id !== drag.id).map((child) => child.el.getBoundingClientRect());
  }

  function resolveTarget(x, y) {
    const hits = document.elementsFromPoint(x, y);
    const el = hits.find((item) => !item.closest('[data-web-layout-overlay]'));
    if (!el || !el.closest) return null;
    const moduleEl = el.closest('[data-web-layout-id]');
    if (!moduleEl) return null;
    const id = moduleEl.getAttribute('data-web-layout-id');
    const node = nodeById(getTree(), id);
    if (!node) return null;
    if (node.module && node.module.container) {
      const rect = node.el.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        const others = (node.children || []).filter((child) => child.id !== drag.id);
        return {
          parentId: node.id,
          parentNode: node,
          index: computeInsertionIndex(others.map((child) => child.el.getBoundingClientRect()), { x, y }, node.module.layout),
        };
      }
    }
    const parent = findParent(getTree(), id);
    if (!parent) return null;
    const others = (parent.children || []).filter((child) => child.id !== drag.id);
    return {
      parentId: parent.id,
      parentNode: parent,
      index: computeInsertionIndex(others.map((child) => child.el.getBoundingClientRect()), { x, y }, parent.module?.layout || 'flow'),
    };
  }

  function validTarget(target) {
    if (!target) return false;
    if (target.parentId === drag.id) return false;
    return !isDescendant(getTree(), drag.id, target.parentId);
  }

  function rootElement() {
    const roots = getTree();
    if (roots.length && roots[0].el.parentElement) return roots[0].el.parentElement;
    return document.body;
  }
```

In `onMove`, replace the parent-only computation with:

```js
    const target = resolveTarget(event.clientX, event.clientY);
    const valid = validTarget(target);
    drag.target = valid ? target : null;
    if (!valid) {
      overlay.hideLine();
      overlay.setDropTarget('');
      return;
    }
    overlay.setDropTarget(target.parentNode && target.parentNode.id !== drag.id ? target.parentNode.id : '');
    const others = (target.parentNode ? target.parentNode.children : getTree()).filter((node) => node.id !== drag.id);
    overlay.showLine(lineRect(others, target.index, target.parentNode));
```

In `onUp`, replace the parent/index computation with:

```js
    const target = current.target;
    if (!target || !validTargetFor(current, target)) return;
    const parentEl = target.parentNode ? target.parentNode.el : rootElement();
    const fromParent = findParent(getTree(), current.id);
    const fromIndex = (fromParent ? fromParent.children : getTree()).findIndex((node) => node.id === current.id);
    const others = (target.parentNode ? target.parentNode.children : getTree()).filter((node) => node.id !== current.id);
    const index = Math.max(0, Math.min(target.index, others.length));
    parentEl.insertBefore(current.node.el, others[index] ? others[index].el : null);
    onMoved({
      module: current.id,
      from: { parent: fromParent ? fromParent.id : '__root__', index: fromIndex },
      to: { parent: target.parentId, index },
    });
    onChange();
```

Add a small helper because `validTarget` closes over the live `drag`:

```js
  function validTargetFor(current, target) {
    if (!target) return false;
    if (target.parentId === current.id) return false;
    return !isDescendant(getTree(), current.id, target.parentId);
  }
```

- [ ] **Step 2: Manual cross-container check**

1. Drag `hero-title` (inside `hero`) into the `features` section. The features box highlights green; the insertion line appears inside it.
2. Drop. The title moves into the features container; the preview shows it there.
3. Drag `hero` into its own child area. No green highlight and no insertion line; dropping does nothing.
4. Drag a leaf onto a leaf. The target resolves to the leaf's parent; the insertion line appears before/after the leaf.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/web-layout/editor/runtime/drag.js
git commit -m "feat(web-layout): support cross-container moves with cycle guards"
```

---

### Task 14: Palette additions, deletion, reset

**Files:**
- Create: `.claude/skills/web-layout/editor/runtime/palette-drop.js`
- Modify: `.claude/skills/web-layout/editor/runtime/runtime.js`
- Modify: `.claude/skills/web-layout/editor/editor.js` (palette click and insert mode)

**Interfaces:**
- Consumes: `PALETTE`, `PALETTE_TYPES`, `CONTAINER_TYPES` from `./constants.js`; `findParent` from `./model.js`.
- Produces: `attachPaletteDrop({document, window, getTree, getManifest, onAdd, onRemove})` → `{insert(type, parentId, index), remove(id), setInsertMode(type)}`.

- [ ] **Step 1: Implement `palette-drop.js`**

```js
import { PALETTE, PALETTE_TYPES } from './constants.js';
import { findParent } from './model.js';

const LABELS = new Map(PALETTE.map((item) => [item.type, item.label]));

function placeholderFor(type, id) {
  const doc = document;
  const mark = (el) => {
    el.setAttribute('data-web-layout-id', id);
    el.setAttribute('data-web-layout-added', type);
    el.style.cssText += ';outline:2px dashed #16a34a;outline-offset:2px;min-height:40px;';
    return el;
  };
  if (type === 'heading') { const el = doc.createElement('h2'); el.textContent = LABELS.get(type); return mark(el); }
  if (type === 'paragraph') { const el = doc.createElement('p'); el.textContent = '正文段落'; return mark(el); }
  if (type === 'buttons') { const el = doc.createElement('div'); el.textContent = '按钮组'; return mark(el); }
  if (type === 'image') { const el = doc.createElement('figure'); el.textContent = '图片'; return mark(el); }
  if (type === 'cards') { const el = doc.createElement('section'); el.textContent = '卡片组'; return mark(el); }
  if (type === 'columns-2' || type === 'columns-3') {
    const el = doc.createElement('div');
    el.style.display = 'grid';
    el.style.gridTemplateColumns = 'repeat(' + (type === 'columns-2' ? 2 : 3) + ', minmax(0, 1fr))';
    el.style.gap = '12px';
    for (let i = 0; i < (type === 'columns-2' ? 2 : 3); i += 1) {
      const cell = doc.createElement('div');
      cell.textContent = '栏 ' + (i + 1);
      cell.style.minHeight = '40px';
      el.appendChild(cell);
    }
    return mark(el);
  }
  if (type === 'divider') { return mark(doc.createElement('hr')); }
  const el = doc.createElement('section');
  el.textContent = '新区块';
  return mark(el);
}

export function attachPaletteDrop({ document, window, getTree, onAdd, onRemove, editorOrigin, runtimeToken }) {
  let seq = 0;
  let insertMode = null;

  function nodeById(nodes, id) {
    for (const node of nodes || []) {
      if (node.id === id) return node;
      const found = nodeById(node.children, id);
      if (found) return found;
    }
    return null;
  }

  function insert(type, parentId, index) {
    if (!PALETTE_TYPES.has(type) || !parentId) return null;
    const parentNode = parentId === '__root__' ? null : nodeById(getTree(), parentId);
    if (parentId !== '__root__' && (!parentNode || !parentNode.module.container)) return null;
    const parentEl = parentNode ? parentNode.el : document.body;
    const id = 'new-' + (seq += 1);
    const el = placeholderFor(type, id);
    const children = parentNode ? parentNode.children : getTree();
    const next = (children || [])[index];
    parentEl.insertBefore(el, next ? next.el : null);
    onAdd({
      id,
      type,
      label: LABELS.get(type) + ' ' + seq,
      parent: parentId,
      index,
    });
    return id;
  }

  function remove(id) {
    const node = nodeById(getTree(), id);
    if (!node) return false;
    const mark = (item) => {
      item.el.setAttribute('data-web-layout-removed', '');
      item.el.style.display = 'none';
      onRemove(item.id);
      for (const child of item.children || []) mark(child);
    };
    mark(node);
    return true;
  }

  function targetFromEvent(event) {
    const el = event.target && event.target.closest ? event.target.closest('[data-web-layout-id]') : null;
    if (!el) return { parentId: '__root__', index: getTree().length };
    const id = el.getAttribute('data-web-layout-id');
    const node = nodeById(getTree(), id);
    if (!node) return { parentId: '__root__', index: getTree().length };
    if (node.module && node.module.container) {
      return { parentId: id, index: node.children.length };
    }
    const parent = findParent(getTree(), id);
    const siblings = parent ? parent.children : getTree();
    const index = siblings.findIndex((item) => item.id === id) + 1;
    return { parentId: parent ? parent.id : '__root__', index };
  }

  document.addEventListener('dragover', (event) => {
    if (!event.dataTransfer) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, true);

  document.addEventListener('drop', (event) => {
    const type = event.dataTransfer && event.dataTransfer.getData('application/x-web-layout-module');
    if (!type) return;
    event.preventDefault();
    event.stopPropagation();
    const target = targetFromEvent(event);
    insert(type, target.parentId, target.index);
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    const el = event.target && event.target.closest ? event.target.closest('[data-web-layout-id]') : null;
    if (!el) return;
    event.preventDefault();
    remove(el.getAttribute('data-web-layout-id'));
  }, true);

  window.addEventListener('message', (event) => {
    if (event.origin !== editorOrigin) return;
    const data = event.data;
    if (!data || data.runtimeToken !== runtimeToken) return;
    if (data.type === 'insertMode') insertMode = data.value || null;
    if (data.type === 'remove') remove(data.id);
  });

  document.addEventListener('click', (event) => {
    if (!insertMode) return;
    event.preventDefault();
    event.stopPropagation();
    const target = targetFromEvent(event);
    insert(insertMode, target.parentId, target.index);
    insertMode = null;
  }, true);

  return { insert, remove, setInsertMode: (type) => { insertMode = type || null; } };
}
```

- [ ] **Step 2: Wire palette drops into `runtime.js`**

Add the import and call after `drag` is created:

```js
import { attachPaletteDrop } from './palette-drop.js';
```

```js
  const paletteDrop = attachPaletteDrop({
    document,
    window,
    getTree: () => tree,
    editorOrigin,
    runtimeToken,
    onAdd: (item) => {
      added.set(item.id, item);
      build();
      sendTree();
    },
    onRemove: (id) => {
      removed.add(id);
      build();
      sendTree();
    },
  });
```

- [ ] **Step 3: Wire palette insert mode in `editor.js`**

In `renderPalette`, add a click handler that posts insert mode:

```js
    el.addEventListener('click', () => {
      postToFrame({ type: 'insertMode', value: item.type, runtimeToken: app.state.runtimeToken });
      setBanners([{ text: '点击预览里的位置来插入「' + item.label + '」' }]);
    });
```

- [ ] **Step 4: Manual palette/delete check**

1. Drag `标题` from the palette into the `features` section. A dashed green placeholder appears; the summary shows `新增 1`.
2. Click `两栏`, then click inside `features`. A two-column placeholder appears.
3. Select a placeholder and press Delete. It disappears; the summary shows `删除 1`.
4. Click 重置. The iframe reloads and placeholders disappear.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/web-layout/editor/runtime/palette-drop.js .claude/skills/web-layout/editor/runtime/runtime.js .claude/skills/web-layout/editor/editor.js
git commit -m "feat(web-layout): add palette modules, deletion, and reset"
```

---

### Task 15: Inspector notes, width/align hints, submit flow

**Files:**
- Create: `.claude/skills/web-layout/editor/inspector.js`
- Modify: `.claude/skills/web-layout/editor/editor.js`
- Modify: `.claude/skills/web-layout/editor/editor.css` (inspector controls)

**Interfaces:**
- Consumes: `moduleIndex`, `findParent`, `widthAlignEnabled` from `./state.js`.
- Produces: `renderInspector({container, app, onChange})`, `parentLayoutOf(tree, manifest, id)`.

- [ ] **Step 1: Implement `inspector.js`**

```js
import { moduleIndex, findParent, widthAlignEnabled } from './state.js';

const WIDTHS = [
  ['auto', '自动'],
  ['full', '整行'],
  ['half', '半行'],
  ['third', '三分之一'],
  ['two-thirds', '三分之二'],
];
const ALIGNS = [
  ['start', '左'],
  ['center', '中'],
  ['end', '右'],
  ['stretch', '拉伸'],
];

export function parentLayoutOf(tree, manifest, id) {
  const parent = findParent(tree, id);
  if (!parent || parent.id === '__root__') return 'flow';
  const mod = moduleIndex(manifest).get(parent.id);
  if (mod) return mod.layout;
  const added = (manifest && manifest.modules || []).find((item) => item.id === parent.id);
  if (added) return added.layout;
  return 'flow';
}

function field(labelText, control) {
  const wrapper = document.createElement('div');
  const label = document.createElement('label');
  label.textContent = labelText;
  wrapper.append(label, control);
  return wrapper;
}

export function renderInspector({ container, app, onChange }) {
  container.innerHTML = '';
  const title = document.createElement('h3');
  title.textContent = '检查器';
  container.appendChild(title);

  const index = moduleIndex(app.effectiveManifest || { modules: [] });
  const selected = index.get(app.selectedId);
  const added = app.added.get(app.selectedId);

  if (!app.selectedId) {
    const muted = document.createElement('div');
    muted.className = 'muted';
    muted.textContent = '在预览里点击一个模块。Alt+点击可以选一个子元素。';
    container.appendChild(muted);
  } else {
    const info = document.createElement('div');
    info.className = 'muted';
    info.textContent = (selected || added || { label: app.selectedId }).label + ' · ' + app.selectedId;
    container.appendChild(info);

    const note = document.createElement('textarea');
    note.placeholder = '这个模块要怎么改？';
    note.value = (added ? added.note : app.notes[app.selectedId]) || '';
    note.addEventListener('input', () => {
      if (added) added.note = note.value;
      app.notes[app.selectedId] = note.value;
      onChange();
    });
    container.appendChild(field('模块备注', note));

    if (selected) {
      const layout = parentLayoutOf(app.currentTree || [], app.effectiveManifest, app.selectedId);
      const enabled = widthAlignEnabled(layout);
      if (enabled.width) {
        const select = document.createElement('select');
        select.innerHTML = WIDTHS.map(([value, text]) => '<option value="' + value + '">' + text + '</option>').join('');
        select.value = (app.layoutHints[app.selectedId] && app.layoutHints[app.selectedId].width) || 'auto';
        select.disabled = Boolean(app.submitted);
        select.addEventListener('change', () => {
          app.layoutHints[app.selectedId] = { ...(app.layoutHints[app.selectedId] || {}), width: select.value };
          onChange();
        });
        container.appendChild(field('宽度', select));
      }
      if (enabled.align) {
        const select = document.createElement('select');
        select.innerHTML = ALIGNS.map(([value, text]) => '<option value="' + value + '">' + text + '</option>').join('');
        select.value = (app.layoutHints[app.selectedId] && app.layoutHints[app.selectedId].align) || 'stretch';
        select.disabled = Boolean(app.submitted);
        select.addEventListener('change', () => {
          app.layoutHints[app.selectedId] = { ...(app.layoutHints[app.selectedId] || {}), align: select.value };
          onChange();
        });
        container.appendChild(field('对齐', select));
      }
      if (!enabled.width && !enabled.align) {
        const muted = document.createElement('div');
        muted.className = 'muted';
        muted.textContent = '这个模块的父容器是普通文档流，宽度/对齐不可调。';
        container.appendChild(muted);
      }
    }
  }

  const global = document.createElement('textarea');
  global.placeholder = '例如：整体更紧凑，首屏标题更突出';
  global.value = app.globalNote;
  global.addEventListener('input', () => { app.globalNote = global.value; onChange(); });
  container.appendChild(field('整体要求', global));

  if (!app.submitted && app.candidate && typeof app.onPromote === 'function') {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '提升为模块';
    button.addEventListener('click', () => app.onPromote(app.candidate));
    container.appendChild(button);
  }
  if (!app.submitted && selected && typeof app.onDemote === 'function') {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '降级为子元素';
    button.addEventListener('click', () => app.onDemote(selected.id));
    container.appendChild(button);
  }
}
```

- [ ] **Step 2: Wire the inspector into `editor.js`**

Replace the local `renderInspector` function with:

```js
import { renderInspector as renderInspectorView } from './inspector.js';

function renderInspector() {
  renderInspectorView({
    container: ui.inspector,
    app,
    onChange: renderSummary,
  });
}
```

Set `app.onPromote` and `app.onDemote` in Task 16. Until then, the candidate panel stays hidden and the demote button is harmless; Task 16 implements the handlers.

Add the CSS controls:
```css
.inspector button { margin-top: 8px; width: 100%; height: 28px; border: 1px solid #d5dbe6; border-radius: 7px; background: #fff; cursor: pointer; }
```

- [ ] **Step 3: Manual note/width/submit check**

1. Select `hero`; type “留白收紧”; the summary shows 1 note.
2. Select `hero` again; the width/align selectors are enabled because the root layout is `flow`? In the fixture, top-level parents are `__root__` → `flow`, so width/align are disabled. Select `hero-title`: its parent is `hero` with `layout: 'column'`, so only align is enabled. This verifies the matrix.
3. Type a global requirement.
4. Click 完成. The browser console shows no errors; the server writes `.web-layout/intent.json`; the banner says the intent was saved.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/web-layout/editor/inspector.js .claude/skills/web-layout/editor/editor.js .claude/skills/web-layout/editor/editor.css
git commit -m "feat(web-layout): add module notes, layout hints, and submit"
```

---

### Task 16: Manifest promotion, demotion, and editor write-back

**Files:**
- Modify: `.claude/skills/web-layout/editor/runtime/dom.js` (candidate builder)
- Modify: `.claude/skills/web-layout/editor/runtime/runtime.js` (Alt+click candidate)
- Modify: `.claude/skills/web-layout/editor/state.js` (pure promote/demote)
- Modify: `.claude/skills/web-layout/editor/editor.js` (promote/demote handlers)
- Modify: `.claude/skills/web-layout/tests/state.test.mjs`

**Interfaces:**
- Consumes: `fingerprintOf`, `roleOf`, `layoutOf`, `textPreview` from `./runtime/model.js`.
- Produces: `buildRef(el)`, `candidateForElement(el, tree)`, `promoteModule(manifest, candidate)`, `demoteModule(manifest, id)`.

- [ ] **Step 1: Write the failing promote/demote tests**

Append to `tests/state.test.mjs`:

```js
import { promoteModule, demoteModule } from '../editor/state.js';

test('promoteModule inserts a candidate under its parent', () => {
  const base = {
    schema: 1, page: 'index.html', modules: [
      { id: 'hero', role: 'hero', label: 'Hero', ref: 'section.hero', classes: 'hero', container: true, layout: 'column', children: [] },
    ],
  };
  const candidate = {
    id: 'hero-kicker', role: 'paragraph', label: 'Kicker', ref: 'section.hero .kicker',
    tag: 'p', classes: 'kicker', text: 'New', fingerprint: 'p|kicker|New',
    container: false, layout: 'flow', parentId: 'hero',
  };
  const next = promoteModule(base, candidate);
  assert.equal(next.modules[0].children.length, 1);
  assert.equal(next.modules[0].children[0].id, 'hero-kicker');
});

test('demoteModule moves children up and removes the wrapper', () => {
  const base = {
    schema: 1, page: 'index.html', modules: [
      { id: 'hero', role: 'hero', label: 'Hero', ref: 'section.hero', classes: 'hero', container: true, layout: 'column', children: [
        { id: 'hero-title', role: 'heading', label: 'Title', ref: 'section.hero h2', classes: '', container: false, layout: 'flow' },
      ] },
    ],
  };
  const next = demoteModule(base, 'hero');
  assert.deepEqual(next.modules.map((m) => m.id), ['hero-title']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test .claude/skills/web-layout/tests/state.test.mjs`
Expected: FAIL with `promoteModule is not a function`.

- [ ] **Step 3: Implement `promoteModule` and `demoteModule` in `state.js`**

```js
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function promoteModule(manifest, candidate) {
  if (!candidate || !candidate.id) throw new Error('candidate id required');
  const next = clone(manifest || { modules: [] });
  const parentId = candidate.parentId || '__root__';
  const module = {
    id: candidate.id,
    role: candidate.role || 'block',
    label: candidate.label || candidate.id,
    ref: candidate.ref,
    matchIndex: 0,
    tag: candidate.tag || 'div',
    classes: candidate.classes || '',
    text: candidate.text || '',
    fingerprint: candidate.fingerprint || '',
    container: Boolean(candidate.container),
    layout: candidate.layout || 'flow',
    ...(candidate.container ? { children: [] } : {}),
  };
  if (parentId === '__root__') {
    next.modules.push(module);
    return next;
  }
  const walk = (modules) => {
    for (const mod of modules || []) {
      if (mod.id === parentId) {
        if (!mod.container) throw new Error('parent is not a container');
        mod.children = mod.children || [];
        mod.children.push(module);
        return true;
      }
      if (walk(mod.children)) return true;
    }
    return false;
  };
  if (!walk(next.modules)) throw new Error('parent not found: ' + parentId);
  return next;
}

export function demoteModule(manifest, id) {
  const next = clone(manifest || { modules: [] });
  const detach = (modules, parent) => {
    for (let i = 0; i < (modules || []).length; i += 1) {
      const mod = modules[i];
      if (mod.id === id) {
        const children = mod.children || [];
        modules.splice(i, 1, ...children);
        return true;
      }
      if (detach(mod.children, mod)) return true;
    }
    return false;
  };
  if (!detach(next.modules, null)) throw new Error('module not found: ' + id);
  return next;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test .claude/skills/web-layout/tests/state.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Add the DOM candidate builder**

Append to `runtime/dom.js`:

```js
import { roleOf, layoutOf } from './model.js';

function classFirst(className) {
  return String(className || '').split(/\s+/).filter(Boolean)[0] || '';
}

// buildRef is defined in Task 11's dom.js; reuse it.

export function candidateForElement(el, tree) {
  if (!el || !el.closest) return null;
  const containing = el.closest('[data-web-layout-id]');
  const parentId = containing ? containing.getAttribute('data-web-layout-id') : '__root__';
  const tag = el.tagName.toLowerCase();
  const classes = typeof el.className === 'string' ? el.className : '';
  const text = textPreview(el.textContent || '');
  const role = roleOf({ tag, className: classes });
  const layout = layoutOf({
    display: getComputedStyle(el).display,
    flexDirection: getComputedStyle(el).flexDirection,
    gridTemplateColumns: getComputedStyle(el).gridTemplateColumns,
  });
  const base = el.getAttribute('data-module') || el.id || classFirst(classes) || (role + '-' + tag);
  const id = String(base).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || ('promoted-' + Date.now());
  return {
    id,
    role,
    label: text || id,
    ref: buildRef(el),
    tag,
    classes,
    text,
    fingerprint: fingerprintOf({ tag, className: classes, text }),
    container: layout !== 'flow' || el.children.length >= 2,
    layout,
    parentId,
  };
}
```

- [ ] **Step 6: Alt+click candidate in `runtime.js`**

Add to the existing click handler, before the normal selection:

```js
  document.addEventListener('click', (event) => {
    if (!event.altKey) return;
    const target = event.target;
    if (!target || !target.closest) return;
    const containing = target.closest('[data-web-layout-id]');
    if (!containing) return;
    if (target === containing) return;
    event.preventDefault();
    event.stopPropagation();
    post({ type: 'candidate', candidate: candidateForElement(target, tree) });
  }, true);
```

Import `candidateForElement` from `./dom.js`.

- [ ] **Step 7: Handle the candidate and write the manifest in `editor.js`**

In the message handler:

```js
  if (data.type === 'candidate' && data.candidate) {
    app.candidate = data.candidate;
    renderInspector();
  }
```

Set the handlers:

```js
app.onPromote = async (candidate) => {
  try {
    const next = promoteModule(app.effectiveManifest, candidate);
    const saved = await api('/api/manifest?page=' + encodeURIComponent(app.state.page), { method: 'PUT', body: { manifest: next } });
    app.effectiveManifest = saved;
    app.candidate = null;
    postToFrame({ type: 'manifest', manifest: saved, runtimeToken: app.state.runtimeToken, sourceVersion: app.state.sourceVersion, styleVersion: app.state.styleVersion });
    renderInspector();
  } catch (error) {
    setBanners([{ text: '提升失败：' + error.message, error: true }]);
  }
};

app.onDemote = async (id) => {
  try {
    const next = demoteModule(app.effectiveManifest, id);
    const saved = await api('/api/manifest?page=' + encodeURIComponent(app.state.page), { method: 'PUT', body: { manifest: next } });
    app.effectiveManifest = saved;
    postToFrame({ type: 'manifest', manifest: saved, runtimeToken: app.state.runtimeToken, sourceVersion: app.state.sourceVersion, styleVersion: app.state.styleVersion });
    renderInspector();
  } catch (error) {
    setBanners([{ text: '降级失败：' + error.message, error: true }]);
  }
};
```

Import `promoteModule, demoteModule` from `./state.js`.

- [ ] **Step 8: Manual promotion/demotion check**

1. Select `hero`, hold Alt, and click the `h2` inside it. The inspector shows a “提升为模块” button.
2. Click it. The h2 gets its own numbered handle; `.web-layout/pages/index.json` gains a `hero-title` module.
3. Select the promoted module and click “降级为子元素”. It disappears from the manifest; the overlay returns to the previous module boundaries.
4. Reload the editor; the persisted manifest still reflects the promotion/demotion.

- [ ] **Step 9: Commit**

```bash
git add .claude/skills/web-layout/editor/runtime/dom.js .claude/skills/web-layout/editor/runtime/runtime.js .claude/skills/web-layout/editor/state.js .claude/skills/web-layout/editor/editor.js .claude/skills/web-layout/tests/state.test.mjs
git commit -m "feat(web-layout): promote and demote modules with manifest write-back"
```

---

### Task 17: `SKILL.md`, schema references, and apply playbook

**Files:**
- Create: `.claude/skills/web-layout/SKILL.md`
- Create: `.claude/skills/web-layout/references/manifest-schema.md`
- Create: `.claude/skills/web-layout/references/intent-schema.md`
- Create: `.claude/skills/web-layout/references/apply-playbook.md`
- Create: `.claude/skills/web-layout/tests/skill-doc.test.mjs`

- [ ] **Step 1: Write the failing doc test**

`tests/skill-doc.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('SKILL.md has frontmatter, triggers, and the workflow contract', async () => {
  const text = await fs.readFile('.claude/skills/web-layout/SKILL.md', 'utf8');
  assert.match(text, /^---\nname: web-layout\n/m);
  assert.match(text, /description: Use when/);
  assert.match(text, /拖拽布局/);
  assert.match(text, /server\.mjs/);
  assert.match(text, /\.web-layout\/intent\.json/);
  assert.match(text, /结束本轮/);
  assert.match(text, /sourceVersion/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test .claude/skills/web-layout/tests/skill-doc.test.mjs`
Expected: FAIL with `ENOENT` for `SKILL.md`.

- [ ] **Step 3: Write `SKILL.md`**

```markdown
---
name: web-layout
description: Use when the user wants to visually adjust the layout of a static HTML page or site by dragging modules, reordering or moving page blocks, adding or removing layout modules from a palette, or annotating per-module layout requirements. Triggers include 拖拽布局、模块化页面、调整模块顺序、visual layout editor.
---

# Web Layout

Launch a local visual editor for a static site, capture the user's module arrangement and notes as an intent file, then apply that intent to the real HTML/CSS.

## When to use

- The user wants to drag, reorder, move, add, or remove page modules visually.
- The user wants to annotate per-module layout requirements.
- The user says 拖拽布局、模块化页面、调整模块顺序, or asks for a visual layout editor.

Do **not** use this skill for a text-described CSS tweak (for example “make the title 40px”). Edit the code directly in that case.

## Workflow

1. Confirm the site root and target page. If the user did not name a page, list the HTML files and ask.
2. Read the target HTML and its linked/inline CSS.
3. Write or update `.web-layout/pages/<slug>.json` with the module tree. Use semantic roles, stable selectors, containers, and layout hints. Keep at most 3 levels and 300 modules.
4. Start the server in the background:
   `node .claude/skills/web-layout/scripts/server.mjs --root <root> --page <page> --open`
   Read the JSON line it prints and give the user the `editorUrl`.
5. Tell the user: drag modules, add notes, click 完成, then return here and say it is done. **结束本轮**; do not edit source while the editor is open.
6. When the user returns, read `.web-layout/intent.json`. Verify `sourceVersion` and `styleVersion` against the current files.
7. Apply the intent to HTML/CSS using the rules in `references/apply-playbook.md`.
8. Re-generate the page manifest, move the intent to `.web-layout/history/YYYYMMDDTHHmmssZ-<slug>.json`, and summarize the changed files and assumptions.
9. Keep the server for visual confirmation, or stop it with `--stop` after the user confirms.

## Commands

```bash
node .claude/skills/web-layout/scripts/server.mjs --root <root> --page <page> --open
node .claude/skills/web-layout/scripts/server.mjs --root <root> --stop
```

## Rules

- The editor never writes source; it writes only under `.web-layout/`.
- Never apply an intent whose versions do not match the files on disk.
- Treat `tree` as the final structure and `changes` as the explanation of what moved.
- Preserve content, links, images, and interactions unless a note explicitly asks for a change.
- Use flex/grid and existing classes; no absolute positioning for structure, no temporary inline styles.
- Check `context.sharedClassWarnings` before changing a shared stylesheet.
- If a change is impossible or would break another page, stop and explain; do not silently approximate.

## References

- `references/manifest-schema.md`
- `references/intent-schema.md`
- `references/apply-playbook.md`
```

- [ ] **Step 4: Write the reference files**

`references/manifest-schema.md`:
- Location, slug rule, required fields, role/layout enums, depth/count limits, version semantics, editor merge rules.
- Copy the exact field list from the spec section 7.

`references/intent-schema.md`:
- Fixed path, atomic write, schema example, change arrays, tree expansion rules, validation error codes, version checks, shared warnings.

`references/apply-playbook.md`:
- The 12-step apply flow from the spec section 10.2, the red lines, content rules for added modules, CSS mapping rules, and the failure protocol.

Use the spec as the source; do not invent new fields.

- [ ] **Step 5: Run the doc test**

Run: `node --test .claude/skills/web-layout/tests/skill-doc.test.mjs`
Expected: PASS, 1 test.

- [ ] **Step 6: Manual trigger check**

Ask: “帮我把首页模块化拖一下”. Expected: the skill is selected and follows the workflow. Ask: “把标题字号改成 40px”. Expected: the skill is not selected; the agent edits CSS directly.

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/web-layout/SKILL.md .claude/skills/web-layout/references .claude/skills/web-layout/tests/skill-doc.test.mjs
git commit -m "docs(web-layout): add skill workflow and schema references"
```

---

### Task 18: End-to-end acceptance and polish

**Files:**
- Create: `.claude/skills/web-layout/tests/smoke.md`
- Modify: `.claude/skills/web-layout/editor/index.html` (continue button)
- Modify: `.claude/skills/web-layout/editor/editor.js` (banners, read-only state)
- Modify: `.claude/skills/web-layout/editor/inspector.js` (disable inputs when submitted)
- Modify: `.claude/skills/web-layout/editor/runtime/runtime.js` (lock/unlock)
- Modify: `.claude/skills/web-layout/editor/runtime/drag.js` (respect lock)
- Modify: `.claude/skills/web-layout/editor/runtime/palette-drop.js` (respect lock)
- Modify: `.claude/skills/web-layout/scripts/lib/app.mjs` (close errors on listen)

- [ ] **Step 1: Run the full test suite**

Run: `node --test .claude/skills/web-layout/tests/*.test.mjs`
Expected: PASS for all tests (paths, version, manifest, intent, workspace, inject, static, http, server, state, model, skill-doc).

- [ ] **Step 2: Write the manual smoke checklist**

`tests/smoke.md`:
```markdown
# Web Layout Smoke Test

Use a copy of `demo/`; do not modify the original.

1. Start: `node .claude/skills/web-layout/scripts/server.mjs --root <copy> --page index.html --open`
2. Editor opens; six top-level modules appear: header, hero, features, pricing, faq, footer.
3. Drag hero below features; the preview reorders; summary shows a move.
4. Drag hero back; order returns; summary still reports the explicit moves.
5. Select hero; add note “留白收紧”; select hero-title; set align.
6. Add a heading module “客户证言” under hero; add a note.
7. Type global note “整体更紧凑”.
8. Click 完成; banner names `.web-layout/intent.json`.
9. In Claude Code, apply the intent on the copy; verify the HTML/CSS and preview.
10. Reload the editor; the manifest is fresh and modules still resolve.
11. Confirm the page picker lists every HTML file in the copy (the shared-style warning itself is covered by `tests/intent.test.mjs` and `tests/workspace.test.mjs`).
12. Stop: `node .claude/skills/web-layout/scripts/server.mjs --root <copy> --stop`
```

- [ ] **Step 3: Polish error banners and the submitted state**

In `editor.js`, ensure:
- API failures show a red banner with the error message.
- In `startPolling`'s catch, replace the silent catch with a red `无法连接本地服务，可能已退出。` banner.
- `ready` with `unresolved.length > 0` shows: `清单未匹配：<ids>；请让 agent 重新生成清单。` and disables submit.
- Stale polling shows the stale banner and disables submit.
- A failed manifest write prevents the intent submission and shows the error.
- In the submit success branch, surface shared-style warnings:
  ```js
  const warningText = (result.warnings || [])
    .map((item) => item.class + ' → ' + item.pages.join(', '))
    .join('；');
  setBanners([{ text: '意图已保存到 ' + result.path + (warningText ? '；共享样式：' + warningText : '') + '，请回到 Claude Code。' }]);
  ```

Add the read-only submitted state. In `index.html`, next to the submit button:

```html
<button id="continue" type="button" hidden>继续编辑</button>
```

In `editor.js`:

```js
const continueButton = document.getElementById('continue');

// after a successful submit:
app.submitted = true;
continueButton.hidden = false;
postToFrame({ type: 'lock', runtimeToken: app.state.runtimeToken });
renderPalette();
renderInspector();
renderSummary();

continueButton.addEventListener('click', () => {
  if (!window.confirm('继续编辑会允许新的提交，可能覆盖尚未应用的意图。继续？')) return;
  app.submitted = false;
  continueButton.hidden = true;
  postToFrame({ type: 'unlock', runtimeToken: app.state.runtimeToken });
  renderPalette();
  renderInspector();
  renderSummary();
});
```

In `renderPalette`, reflect the lock:

```js
el.draggable = !app.submitted;
el.classList.toggle('disabled', app.submitted);
```

In `inspector.js`, disable the note and global textareas when `app.submitted`:

```js
note.disabled = Boolean(app.submitted);
global.disabled = Boolean(app.submitted);
```

In `runtime.js`:

```js
let locked = false;
// in the message handler:
if (data.type === 'lock') locked = true;
if (data.type === 'unlock') locked = false;
```

Pass `isLocked: () => locked` into both `createDragController` and `attachPaletteDrop`.

In `drag.js`:

```js
export function createDragController({ document, window, overlay, getTree, onChange, onMoved, isLocked = () => false }) {
  // at the top of begin():
  if (isLocked()) return;
```

In `palette-drop.js`:

```js
export function attachPaletteDrop({ document, window, getTree, onAdd, onRemove, editorOrigin, runtimeToken, isLocked = () => false }) {
  // at the top of drop, keydown, and click handlers:
  if (isLocked()) return;
```

Add `.palette-item.disabled { opacity: .45; cursor: default; }` to `editor.css`.

- [ ] **Step 4: Harden `app.mjs` startup**

If the second listener fails, close the first and remove `server.json`. Wrap the two `listen` calls:

```js
  let p1;
  let p2;
  try {
    p1 = await listen(editorServer, config.editorPort);
    p2 = await listen(previewServer, config.previewPort);
  } catch (error) {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(() => resolve()))));
    throw error;
  }
```

- [ ] **Step 5: Run the smoke test**

Follow `tests/smoke.md` on a temp copy. Record any failure in the task notes and fix it before committing.

- [ ] **Step 6: Final verification**

Run:
```bash
node --test .claude/skills/web-layout/tests/*.test.mjs
node .claude/skills/web-layout/scripts/server.mjs --root <copy> --page index.html
```
Expected: all tests pass; the server prints a JSON line with `editorUrl`, `previewUrl`, and `pid`; `--stop` exits cleanly and removes `.web-layout/server.json`.

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/web-layout/tests/smoke.md .claude/skills/web-layout/editor/index.html .claude/skills/web-layout/editor/editor.js .claude/skills/web-layout/editor/editor.css .claude/skills/web-layout/editor/inspector.js .claude/skills/web-layout/editor/runtime/runtime.js .claude/skills/web-layout/editor/runtime/drag.js .claude/skills/web-layout/editor/runtime/palette-drop.js .claude/skills/web-layout/scripts/lib/app.mjs
git commit -m "test(web-layout): complete acceptance checks and error polish"
```

---

## Plan Self-Review

### Spec coverage

| Spec section | Tasks |
|---|---|
| 5 architecture / two listeners | Task 8 |
| 6.1 CLI / server.json / idle | Task 8 |
| 6.2 origins / tokens | Task 7, Task 8 |
| 6.3 path safety / MIME / limits | Task 1, Task 6 |
| 6.4 HTML injection / CSP / SW | Task 6 |
| 6.5 API routes | Task 7, Task 8 |
| 6.6 versions | Task 2, Task 5 |
| 7 manifest model / schema / heuristics | Task 3, Task 10, Task 16 |
| 8.1–8.3 overlay / selection / drag | Task 11, Task 12, Task 13 |
| 8.4 width/align | Task 15 |
| 8.5 notes | Task 15 |
| 8.6 multi-page / viewport | Task 9, Task 15 |
| 8.7 stale / unresolved | Task 9, Task 18 |
| 8.8 submit | Task 15 |
| 8.9 runtime protocol | Task 11 |
| 9 intent schema / tree rules / warnings | Task 4, Task 5 |
| 10 agent playbook | Task 17 |
| 11 skill package | Task 17 |
| 12 error handling | Task 6, Task 7, Task 18 |
| 13 tests / acceptance | Tasks 1–18, `smoke.md` |
| 14 limits | Global Constraints, Task 18 |

### Placeholder scan

No `TBD`, `TODO`, “implement later”, or “similar to Task N”. Every code step shows the code to write. Task 11 intentionally ships selection-only behavior; Task 12 adds the drag controller as its own deliverable.

### Type consistency

- `buildTree(doc, manifest, added)` returns `{nodes, unresolved, byId}`; `runtime.js` uses `nodes`/`unresolved`, and the DOM ordering is authoritative for moves and additions.
- `serializeRoot(nodes)` returns `[{id:'__root__', children}]`; `buildIntent` and the editor use that shape.
- `createDragController` takes `{document, window, overlay, getTree, getManifest, onChange, onMoved}` in Task 12/13; `runtime.js` passes that exact object in Task 11.
- `promoteModule`/`demoteModule` operate on `manifest.modules`; `saveEditorManifest` accepts the merged manifest.
- `renderInspector({container, app, onChange})` matches the call in `editor.js`.
- Error codes `E_EMPTY_CHANGES`, `E_STALE_SOURCE`, `E_STALE_STYLE`, `E_TREE_INVALID`, `E_PAGE_MISMATCH`, `E_TOO_LARGE`, `E_MANIFEST`, `E_PAGE_NOT_FOUND`, `E_FORBIDDEN` are produced by the tasks that consume them.

### Review Focus coverage

1. Traversal/symlink/hidden — Task 1 test and Task 6 test.
2. Stale versions/selector drift — Task 2, Task 4, Task 5, Task 9, Task 18.
3. Collapsed-tree semantics — Task 4 test `a removed module inside a collapsed parent is rejected` plus validation tests.
4. Shared CSS — Task 4 and Task 5 tests against `about.html`.
5. Token/Origin/postMessage — Task 7 HTTP guards, Task 8 integration test, Task 9 message checks.



