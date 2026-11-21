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
