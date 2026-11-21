import { buildTree, candidateForElement, heuristicManifest, serializeRoot } from './dom.js';
import { createDragController } from './drag.js';
import { createOverlay } from './overlay.js';
import { attachPaletteDrop } from './palette-drop.js';

const config = window.__WEB_LAYOUT__;
if (config) boot(config);

function boot(config) {
  const editorOrigin = config.editorOrigin;
  const runtimeToken = config.runtimeToken;
  let manifest = null;
  let tree = [];
  let unresolved = [];
  let added = new Map();
  let removed = new Set();
  let moved = [];
  let selected = '';
  let locked = false;
  let overlay = null;
  let drag = null;

  const post = (message) => {
    try {
      window.parent.postMessage({ ...message, runtimeToken }, editorOrigin);
    } catch {
      /* the editor may have gone away */
    }
  };

  function currentPage() {
    return location.pathname.replace(/^\/+/, '') || 'index.html';
  }

  function build() {
    if (!manifest) {
      manifest = heuristicManifest(document, window, { page: currentPage(), sourceVersion: '' });
    }
    const built = buildTree(document, manifest, added);
    tree = built.nodes;
    unresolved = built.unresolved;
    overlay.layout(tree);
  }

  function sendTree() {
    post({
      type: 'tree',
      page: currentPage(),
      tree: serializeRoot(tree),
      added: [...added.values()].filter((item) => !removed.has(item.id)),
      removed: [...removed],
      moved,
    });
  }

  overlay = createOverlay(document, window, {
    onSelect: (id) => {
      selected = id;
      overlay.setSelected(id);
      post({ type: 'select', id });
    },
    onHandleDown: (id, event) => drag.begin(id, event),
  });

  drag = createDragController({
    document,
    window,
    overlay,
    getTree: () => tree,
    getManifest: () => manifest,
    onChange: () => { build(); sendTree(); },
    onMoved: (item) => {
      moved = moved.filter((existing) => existing.module !== item.module);
      moved.push(item);
    },
    isLocked: () => locked,
  });

  const paletteDrop = attachPaletteDrop({
    document,
    window,
    getTree: () => tree,
    getSelectedId: () => selected,
    editorOrigin,
    runtimeToken,
    isLocked: () => locked,
    onAdd: (item) => {
      added.set(item.id, item);
      build();
      sendTree();
    },
    onRemove: (id) => {
      removed.add(id);
      build();
      sendTree();
    },
  });

  window.addEventListener('message', (event) => {
    if (event.origin !== editorOrigin) return;
    const data = event.data;
    if (!data || data.runtimeToken !== runtimeToken) return;
    if (data.type === 'manifest') {
      manifest = data.manifest || null;
      if (!manifest) {
        manifest = heuristicManifest(document, window, {
          page: currentPage(),
          sourceVersion: data.sourceVersion || '',
        });
      }
      build();
      post({
        type: 'ready',
        page: currentPage(),
        tree: serializeRoot(tree),
        unresolved,
        manifest,
      });
    }
    if (data.type === 'lock') locked = true;
    if (data.type === 'unlock') locked = false;
    if (data.type === 'reset') location.reload();
  });

  document.addEventListener('click', (event) => {
    // Alt+click belongs to the candidate path below, never to selection.
    if (event.altKey) return;
    const target = event.target;
    if (!target || !target.closest) return;
    const el = target.closest('[data-web-layout-id]');
    if (!el) return;
    event.preventDefault();
    event.stopPropagation();
    selected = el.getAttribute('data-web-layout-id');
    overlay.setSelected(selected);
    post({ type: 'select', id: selected });
  }, true);

  document.addEventListener('click', (event) => {
    if (!event.altKey) return;
    const target = event.target;
    if (!target || !target.closest) return;
    const containing = target.closest('[data-web-layout-id]');
    if (!containing) return;
    if (target === containing) return;
    event.preventDefault();
    event.stopPropagation();
    post({ type: 'candidate', candidate: candidateForElement(target, tree) });
  }, true);

  const relayout = () => overlay.layout(tree);
  window.addEventListener('scroll', relayout, true);
  window.addEventListener('resize', relayout);
  if (typeof window.ResizeObserver === 'function') {
    new window.ResizeObserver(relayout).observe(document.body);
  }
  if (typeof window.MutationObserver === 'function') {
    new window.MutationObserver(relayout).observe(document.body, { childList: true, subtree: false });
  }

  post({ type: 'boot', page: currentPage() });
}
