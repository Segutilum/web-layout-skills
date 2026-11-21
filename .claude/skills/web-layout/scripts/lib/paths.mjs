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
