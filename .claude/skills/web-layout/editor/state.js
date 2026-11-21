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

export function validateForSubmit(state) {
  const errors = [];
  if (!state.page) errors.push('E_NO_PAGE');
  if (!state.sourceVersion || !state.styleVersion) errors.push('E_NO_VERSION');
  if (state.stale) errors.push('E_STALE');
  if ((state.unresolved || []).length) errors.push('E_UNRESOLVED');
  const changes = countChanges(state);
  if (!changes.moved && !changes.added && !changes.removed && !changes.notes && !String(state.globalNote || '').trim()) {
    errors.push('E_EMPTY_CHANGES');
  }
  return errors;
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
    tree: state.tree || state.currentTree,
    context: {
      manifestStatus: state.manifestStatus || 'ok',
      stylesheets: state.stylesheets || [],
      sharedClassWarnings: [],
    },
  };
}
