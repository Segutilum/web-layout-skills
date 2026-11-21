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
