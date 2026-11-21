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
  const walk = (node) => {
    if (!node || typeof node.id !== 'string') return;
    if (seen.has(node.id)) throw fail('E_TREE_INVALID', 'duplicate module in tree: ' + node.id);
    seen.add(node.id);
    if (node.id !== '__root__') ids.push(node.id);
    const explicit = node.children !== undefined;
    const children = explicit
      ? node.children
      : (manifestIndex.get(node.id)?.children || []).map((child) => ({ id: child.id }));
    for (const child of children) {
      if (removed.has(child.id)) {
        if (explicit) throw fail('E_TREE_INVALID', 'removed module listed in tree: ' + child.id);
        continue;
      }
      const parent = node.id;
      const isContainer = parent === '__root__'
        || manifestIndex.get(parent)?.container === true
        || CONTAINER_TYPES.has(added.get(parent)?.type);
      if (!isContainer) throw fail('E_TREE_INVALID', 'parent is not a container: ' + parent);
      walk(child);
    }
  };
  for (const rootNode of tree) walk(rootNode);
  return { ids };
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
    if (typeof item.note === 'string' && item.note.length > 4000) add('E_TREE_INVALID', 'note too long: ' + item.id);
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

  let expanded = { ids: [] };
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
    let ancestor = parentMap.get(id);
    while (removed.has(ancestor)) ancestor = parentMap.get(ancestor);
    const node = findNode(intent.tree, ancestor);
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
  if (Buffer.byteLength(JSON.stringify(intent, null, 2)) > 2 * 1024 * 1024) add('E_TOO_LARGE', 'intent exceeds 2 MiB');

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
