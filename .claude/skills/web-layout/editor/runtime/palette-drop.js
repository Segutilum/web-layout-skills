import { PALETTE, PALETTE_TYPES } from './constants.js';
import { findParent } from './model.js';

const LABELS = new Map(PALETTE.map((item) => [item.type, item.label]));
const FOLLOWING = 4;

function placeholderFor(doc, type, id) {
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

  function domModules(parentEl) {
    const out = [];
    for (const child of (parentEl && parentEl.children) || []) {
      if (!child.getAttribute || !child.getAttribute('data-web-layout-id')) continue;
      out.push(child);
    }
    return out;
  }

  function rootParent() {
    const root = (getTree() || [])[0];
    return (root && root.el && root.el.parentElement) || document.body;
  }

  // Every insertBefore reference must be a direct child of the insertion element.
  function directChild(parentEl, ref) {
    return ref && ref.parentNode === parentEl ? ref : null;
  }

  // Position the new element will occupy among its tree parent's children, which may
  // live inside non-module wrappers (fully-nested containers in particular).
  function treeIndexFor(parentId, el) {
    const parentNode = parentId === '__root__' ? null : nodeById(getTree(), parentId);
    const siblings = parentId === '__root__' ? getTree() : (parentNode ? parentNode.children : []);
    let index = 0;
    for (const sibling of siblings || []) {
      if (!sibling.el || sibling.el === el || !sibling.el.compareDocumentPosition) continue;
      if (sibling.el.compareDocumentPosition(el) & FOLLOWING) index += 1;
    }
    return index;
  }

  function insertAt(type, target) {
    if (!PALETTE_TYPES.has(type) || !target || !target.parentEl) return null;
    const id = 'new-' + (seq += 1);
    const el = placeholderFor(document, type, id);
    const ref = directChild(target.parentEl, target.refEl);
    target.parentEl.insertBefore(el, ref);
    onAdd({
      id,
      type,
      label: LABELS.get(type) + ' ' + seq,
      parent: target.parentId,
      index: treeIndexFor(target.parentId, el),
    });
    return id;
  }

  function insert(type, parentId, index) {
    if (!PALETTE_TYPES.has(type) || !parentId) return null;
    if (parentId === '__root__') {
      return insertAt(type, { parentId: '__root__', parentEl: rootParent(), refEl: null });
    }
    const parentNode = nodeById(getTree(), parentId);
    if (!parentNode || !parentNode.module.container) return null;
    return insertAt(type, { parentId, parentEl: parentNode.el, refEl: null });
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
    const target = event && event.target;
    const el = target && target.closest ? target.closest('[data-web-layout-id]') : null;
    if (!el) return { parentId: '__root__', parentEl: rootParent(), refEl: null };
    const id = el.getAttribute('data-web-layout-id');
    const node = nodeById(getTree(), id);
    if (!node) return { parentId: '__root__', parentEl: rootParent(), refEl: null };
    if (node.module && node.module.container) {
      return { parentId: id, parentEl: node.el, refEl: null };
    }
    // Leaf target: insert immediately after the leaf among its parent's DOM modules.
    // The tree parent id is kept as metadata even when a wrapper is the DOM parent.
    const parentEl = node.el.parentElement;
    if (!parentEl) return { parentId: '__root__', parentEl: rootParent(), refEl: null };
    const siblings = domModules(parentEl);
    const position = siblings.indexOf(node.el);
    const refEl = position >= 0 ? siblings[position + 1] || null : null;
    const parent = findParent(getTree(), id);
    return { parentId: parent ? parent.id : '__root__', parentEl, refEl };
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
    insertAt(type, targetFromEvent(event));
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    const target = event.target;
    const el = target && target.closest ? target.closest('[data-web-layout-id]') : null;
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
    const type = insertMode;
    insertMode = null;
    event.preventDefault();
    event.stopPropagation();
    insertAt(type, targetFromEvent(event));
  }, true);

  return { insert, remove, setInsertMode: (type) => { insertMode = type || null; } };
}
