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
