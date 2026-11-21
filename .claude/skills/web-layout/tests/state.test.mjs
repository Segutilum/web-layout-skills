import test from 'node:test';
import assert from 'node:assert/strict';
import {
  widthAlignEnabled,
  countChanges,
  countLayoutHints,
  hasLayoutHints,
  hasDraft,
  validateForSubmit,
  buildIntent,
  moduleIndex,
  findParent,
  promoteModule,
  demoteModule,
} from '../editor/state.js';
import { validateManifest } from '../scripts/lib/manifest.mjs';
import { serializeRoot } from '../editor/runtime/dom.js';
import { validateIntent } from '../scripts/lib/intent.mjs';

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

test('hasDraft detects the global note, module notes, and structural changes', () => {
  const empty = { moved: [], added: new Map(), removed: new Set(), notes: {}, globalNote: '' };
  assert.equal(hasDraft(empty), false);
  assert.equal(hasDraft({ ...empty, globalNote: '   ' }), false);
  assert.equal(hasDraft({ ...empty, globalNote: 'Tighter' }), true);
  assert.equal(hasDraft({ ...empty, notes: { hero: 'Less padding' } }), true);
  assert.equal(hasDraft({ ...empty, moved: [{ module: 'hero' }] }), true);
  assert.equal(hasDraft({ ...empty, added: new Map([['new-1', { id: 'new-1' }]]) }), true);
  assert.equal(hasDraft({ ...empty, removed: new Set(['footer']) }), true);
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

test('hint-only drafts are submit-ready', () => {
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
    layoutHints: {},
    globalNote: '',
  };
  const widthHint = { ...base, layoutHints: { hero: { width: 'full' } } };
  const alignHint = { ...base, layoutHints: { hero: { align: 'start' } } };
  const bothHints = { ...base, layoutHints: { hero: { width: 'half', align: 'center' }, header: { align: 'end' } } };
  assert.equal(countLayoutHints(widthHint), 1);
  assert.equal(hasLayoutHints(widthHint), true);
  assert.equal(countLayoutHints(bothHints), 2);
  assert.equal(hasDraft(widthHint), true);
  assert.deepEqual(validateForSubmit(widthHint), []);
  assert.equal(hasDraft(alignHint), true);
  assert.deepEqual(validateForSubmit(alignHint), []);
});

test('default or removed layout hints do not count as changes', () => {
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
    layoutHints: {},
    globalNote: '',
  };
  const defaults = { width: 'auto', align: 'stretch' };
  const defaultState = { ...base, layoutHints: { hero: defaults } };
  assert.equal(countLayoutHints(defaultState), 0);
  assert.equal(hasLayoutHints(defaultState), false);
  assert.equal(hasDraft(defaultState), false);
  assert.deepEqual(validateForSubmit(defaultState), ['E_EMPTY_CHANGES']);
  assert.deepEqual(validateForSubmit({ ...base, layoutHints: { hero: { width: 'auto' } } }), ['E_EMPTY_CHANGES']);
  assert.deepEqual(validateForSubmit({ ...base, layoutHints: { hero: { align: 'stretch' } } }), ['E_EMPTY_CHANGES']);

  const removedHint = { ...base, removed: new Set(['hero']), layoutHints: { hero: { width: 'full' } } };
  assert.equal(countLayoutHints(removedHint), 0);
  assert.equal(hasLayoutHints(removedHint), false);
  // The removal itself is a structural change; the stale hint must not add to it.
  assert.equal(hasDraft(removedHint), true);
  assert.deepEqual(validateForSubmit(removedHint), []);
});

test('moduleIndex and findParent walk the manifest and tree', () => {
  const index = moduleIndex(manifest);
  assert.equal(index.get('hero-title').ref, 'section.hero h2');
  assert.equal(findParent(tree, 'hero-title').id, 'hero');
  assert.equal(findParent(tree, '__root__'), null);
});

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

test('promoteModule caps the manifest label so the result validates', () => {
  const base = {
    schema: 1, page: 'index.html', sourceVersion: 'sha256:' + 'a'.repeat(64), stylesheets: [],
    modules: [
      { id: 'hero', role: 'hero', label: 'Hero', ref: 'section.hero', matchIndex: 0, tag: 'section', classes: 'hero', text: '', fingerprint: '', container: true, layout: 'column', children: [] },
    ],
  };
  const candidate = {
    id: 'hero-kicker', role: 'paragraph', label: 'L'.repeat(80), ref: 'section.hero p',
    tag: 'p', classes: 'kicker', text: 'L'.repeat(80), fingerprint: 'p|kicker|' + 'L'.repeat(32),
    container: false, layout: 'flow', parentId: 'hero',
  };
  const next = promoteModule(base, candidate);
  const result = validateManifest(next);
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.ok(next.modules[0].children[0].label.length <= 40);
  assert.equal(candidate.label.length, 80);
});

const SOURCE_VERSION = 'sha256:' + 'a'.repeat(64);
const STYLE_VERSION = 'sha256:' + 'b'.repeat(64);

const containerManifest = {
  schema: 1,
  page: 'index.html',
  sourceVersion: SOURCE_VERSION,
  stylesheets: ['styles.css'],
  modules: [
    { id: 'header', role: 'header', label: 'Header', ref: 'header', matchIndex: 0, tag: 'header', classes: 'site-header', text: 'H', fingerprint: '', container: false, layout: 'flow' },
    { id: 'features', role: 'section', label: 'Features', ref: 'section.features', matchIndex: 0, tag: 'section', classes: 'features', text: 'F', fingerprint: '', container: true, layout: 'row', children: [
      { id: 'a', role: 'paragraph', label: 'A', ref: 'section.features p.a', matchIndex: 0, tag: 'p', classes: 'a', text: 'A', fingerprint: '', container: false, layout: 'flow' },
      { id: 'b', role: 'paragraph', label: 'B', ref: 'section.features p.b', matchIndex: 0, tag: 'p', classes: 'b', text: 'B', fingerprint: '', container: false, layout: 'flow' },
    ] },
    { id: 'footer', role: 'footer', label: 'Footer', ref: 'footer', matchIndex: 0, tag: 'footer', classes: 'site-footer', text: 'F', fingerprint: '', container: false, layout: 'flow' },
  ],
};

function moduleById(id) {
  const walk = (modules) => {
    for (const mod of modules || []) {
      if (mod.id === id) return mod;
      const found = walk(mod.children);
      if (found) return found;
    }
    return null;
  };
  return walk(containerManifest.modules);
}

function treeNode(id, children = []) {
  return { id, module: moduleById(id), children };
}

function intentState(tree, changes) {
  return {
    page: 'index.html',
    sourceVersion: SOURCE_VERSION,
    styleVersion: STYLE_VERSION,
    manifestStatus: 'ok',
    stylesheets: ['styles.css'],
    manifest: containerManifest,
    tree,
    moved: changes.moved || [],
    added: new Map(),
    removed: changes.removed || new Set(),
    notes: {},
    layoutHints: {},
    globalNote: '',
  };
}

function collectTreeIds(nodes, out = []) {
  for (const node of nodes || []) {
    out.push(node.id);
    collectTreeIds(node.children, out);
  }
  return out;
}

test('a container emptied by removal serializes as an expanded tree node', () => {
  const tree = serializeRoot([
    treeNode('header'),
    treeNode('features'),
    treeNode('footer'),
  ]);
  const intent = buildIntent(intentState(tree, { removed: new Set(['a', 'b']) }));
  const result = validateIntent(intent, {
    manifest: containerManifest,
    sourceVersion: SOURCE_VERSION,
    styleVersion: STYLE_VERSION,
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const features = intent.tree[0].children.find((node) => node.id === 'features');
  assert.deepEqual(features.children, []);
});

test('a container emptied by moves does not re-expand its former children', () => {
  const tree = serializeRoot([
    treeNode('header'),
    treeNode('features'),
    treeNode('a'),
    treeNode('b'),
    treeNode('footer'),
  ]);
  const intent = buildIntent(intentState(tree, {
    moved: [
      { module: 'a', from: { parent: 'features', index: 0 }, to: { parent: '__root__', index: 2 } },
      { module: 'b', from: { parent: 'features', index: 1 }, to: { parent: '__root__', index: 3 } },
    ],
  }));
  const result = validateIntent(intent, {
    manifest: containerManifest,
    sourceVersion: SOURCE_VERSION,
    styleVersion: STYLE_VERSION,
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const features = intent.tree[0].children.find((node) => node.id === 'features');
  assert.deepEqual(features.children, []);
  const ids = collectTreeIds(intent.tree);
  assert.equal(ids.filter((id) => id === 'a').length, 1);
  assert.equal(ids.filter((id) => id === 'b').length, 1);
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
