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
