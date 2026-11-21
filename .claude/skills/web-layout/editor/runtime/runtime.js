import { buildTree, heuristicManifest, serializeRoot } from './dom.js';
import { createDragController } from './drag.js';
import { createOverlay } from './overlay.js';

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
    if (data.type === 'reset') location.reload();
  });

  document.addEventListener('click', (event) => {
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
