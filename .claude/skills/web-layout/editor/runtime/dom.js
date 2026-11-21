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
    // The editor needs the parent module's layout to decide width/align
    // enablement, including for palette-added containers. buildIntent strips
    // this editor-only metadata before emitting the intent tree.
    ...(node.module ? { module: node.module } : {}),
    ...(node.children && node.children.length ? { children: serializeTree(node.children) } : {}),
  }));
}

export function serializeRoot(nodes) {
  return [{ id: '__root__', children: serializeTree(nodes) }];
}
