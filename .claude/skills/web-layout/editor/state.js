export function moduleIndex(manifest) {
  const out = new Map();
  const walk = (modules) => {
    for (const mod of modules || []) {
      out.set(mod.id, mod);
      walk(mod.children);
    }
  };
  walk(manifest && manifest.modules);
  return out;
}

export function findParent(nodes, id, parent = null) {
  for (const node of nodes || []) {
    if (node.id === id) return parent;
    const found = findParent(node.children, id, node);
    if (found !== undefined && found !== null) return found;
  }
  return null;
}

export function widthAlignEnabled(parentLayout) {
  if (parentLayout === 'row' || String(parentLayout || '').startsWith('grid')) {
    return { width: true, align: true };
  }
  if (parentLayout === 'column') return { width: false, align: true };
  return { width: false, align: false };
}

export function countChanges({ moved, added, removed, notes }) {
  return {
    moved: (moved || []).length,
    added: added ? added.size : 0,
    removed: removed ? removed.size : 0,
    notes: Object.values(notes || {}).filter((value) => String(value || '').trim()).length,
  };
}

/**
 * Number of modules with a non-default width/align hint. `auto` and `stretch`
 * are the defaults the inspector shows, so on their own they are not edits.
 * Hints for removed modules cannot reach the intent and do not count.
 */
export function countLayoutHints(state) {
  const hints = (state && state.layoutHints) || {};
  const removed = (state && state.removed) || new Set();
  let count = 0;
  for (const [id, hint] of Object.entries(hints)) {
    if (removed.has(id)) continue;
    const width = hint && hint.width;
    const align = hint && hint.align;
    if ((width && width !== 'auto') || (align && align !== 'stretch')) count += 1;
  }
  return count;
}

export function hasLayoutHints(state) {
  return countLayoutHints(state) > 0;
}

export function hasDraft(state) {
  const changes = countChanges(state);
  return changes.moved + changes.added + changes.removed + changes.notes > 0
    || hasLayoutHints(state)
    || String(state.globalNote || '').trim() !== '';
}

export function validateForSubmit(state) {
  const errors = [];
  if (!state.page) errors.push('E_NO_PAGE');
  if (!state.sourceVersion || !state.styleVersion) errors.push('E_NO_VERSION');
  if (state.stale) errors.push('E_STALE');
  if ((state.unresolved || []).length) errors.push('E_UNRESOLVED');
  const changes = countChanges(state);
  if (
    !changes.moved && !changes.added && !changes.removed && !changes.notes
    && !hasLayoutHints(state)
    && !String(state.globalNote || '').trim()
  ) {
    errors.push('E_EMPTY_CHANGES');
  }
  return errors;
}

function intentTree(nodes) {
  return (nodes || []).map((node) => ({
    id: node.id,
    ...(node.children !== undefined ? { children: intentTree(node.children) } : {}),
  }));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function promoteModule(manifest, candidate) {
  if (!candidate || !candidate.id) throw new Error('candidate id required');
  const next = clone(manifest || { modules: [] });
  const parentId = candidate.parentId || '__root__';
  const module = {
    id: candidate.id,
    role: candidate.role || 'block',
    label: String(candidate.label || candidate.id).slice(0, 40),
    ref: candidate.ref,
    matchIndex: 0,
    tag: candidate.tag || 'div',
    classes: candidate.classes || '',
    text: candidate.text || '',
    fingerprint: candidate.fingerprint || '',
    container: Boolean(candidate.container),
    layout: candidate.layout || 'flow',
    ...(candidate.container ? { children: [] } : {}),
  };
  if (parentId === '__root__') {
    next.modules.push(module);
    return next;
  }
  const walk = (modules) => {
    for (const mod of modules || []) {
      if (mod.id === parentId) {
        if (!mod.container) throw new Error('parent is not a container');
        mod.children = mod.children || [];
        mod.children.push(module);
        return true;
      }
      if (walk(mod.children)) return true;
    }
    return false;
  };
  if (!walk(next.modules)) throw new Error('parent not found: ' + parentId);
  return next;
}

export function demoteModule(manifest, id) {
  const next = clone(manifest || { modules: [] });
  const detach = (modules) => {
    for (let i = 0; i < (modules || []).length; i += 1) {
      const mod = modules[i];
      if (mod.id === id) {
        const children = mod.children || [];
        modules.splice(i, 1, ...children);
        return true;
      }
      if (detach(mod.children)) return true;
    }
    return false;
  };
  if (!detach(next.modules)) throw new Error('module not found: ' + id);
  return next;
}

export function buildIntent(state) {
  const manifest = state.manifest || state.effectiveManifest || { modules: [] };
  const index = moduleIndex(manifest);
  const notes = state.notes || {};
  const hints = state.layoutHints || {};
  const removedIds = state.removed || new Set();
  const moduleIds = new Set([...Object.keys(notes), ...Object.keys(hints)]);
  const modules = [];
  for (const id of moduleIds) {
    if (removedIds.has(id)) continue;
    const note = String(notes[id] || '').trim();
    const hint = hints[id] || {};
    if (!note && !hint.width && !hint.align) continue;
    const mod = index.get(id);
    if (!mod) continue;
    const entry = { id, ref: mod.ref };
    if (note) entry.note = note;
    if (hint.width) entry.width = hint.width;
    if (hint.align) entry.align = hint.align;
    modules.push(entry);
  }
  const added = [...(state.added || new Map()).values()]
    .filter((item) => !removedIds.has(item.id))
    .map((item) => {
      const entry = {
        id: item.id,
        type: item.type,
        label: item.label,
        note: item.note || '',
        parent: item.parent,
        index: item.index,
      };
      if (item.width) entry.width = item.width;
      if (item.align) entry.align = item.align;
      return entry;
    });
  const removed = [...removedIds]
    .filter((id) => index.has(id))
    .map((id) => ({ module: id, ref: index.get(id).ref }));
  return {
    schema: 1,
    kind: 'web-layout-intent',
    page: state.page,
    sourceVersion: state.sourceVersion,
    styleVersion: state.styleVersion,
    globalNote: state.globalNote || '',
    changes: {
      moved: (state.moved || []).filter((item) => !removedIds.has(item.module)),
      added,
      removed,
    },
    modules,
    tree: intentTree(state.tree || state.currentTree),
    context: {
      manifestStatus: state.manifestStatus || 'ok',
      stylesheets: state.stylesheets || [],
      sharedClassWarnings: [],
    },
  };
}
