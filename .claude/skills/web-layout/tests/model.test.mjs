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
