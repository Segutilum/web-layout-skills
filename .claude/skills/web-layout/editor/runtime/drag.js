import { computeInsertionIndex, findParent, isDescendant } from './model.js';

export function createDragController({ document, window, overlay, getTree, onChange, onMoved }) {
  let drag = null;

  function nodeById(nodes, id) {
    for (const node of nodes || []) {
      if (node.id === id) return node;
      const found = nodeById(node.children, id);
      if (found) return found;
    }
    return null;
  }

  function domModuleChildren(parentEl) {
    const children = [];
    if (!parentEl) return children;
    for (const child of parentEl.children || []) {
      if (!child.getAttribute) continue;
      const id = child.getAttribute('data-web-layout-id');
      if (!id) continue;
      const node = nodeById(getTree(), id);
      if (node) children.push(node);
    }
    return children;
  }

  function domOthers(parentEl, id) {
    return domModuleChildren(parentEl).filter((node) => node.id !== id);
  }

  function lineRect(others, index, parentEl) {
    if (others[index]) {
      const rect = others[index].el.getBoundingClientRect();
      return { left: rect.left, top: rect.top - 2, width: rect.width };
    }
    if (others.length) {
      const rect = others[others.length - 1].el.getBoundingClientRect();
      return { left: rect.left, top: rect.bottom - 1, width: rect.width };
    }
    const rect = (parentEl || document.body).getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width };
  }

  function validTarget(current, target) {
    if (!current || !target) return false;
    if (!target.parentId) return false;
    if (target.parentId === current.id) return false;
    return !isDescendant(getTree(), current.id, target.parentId);
  }

  function resolveTarget(x, y) {
    const hits = (document.elementsFromPoint && document.elementsFromPoint(x, y)) || [];
    const el = hits.find((item) => item && item.closest && !item.closest('[data-web-layout-overlay]'));
    if (!el || !el.closest) return null;
    const moduleEl = el.closest('[data-web-layout-id]');
    if (!moduleEl) return null;
    const id = moduleEl.getAttribute('data-web-layout-id');
    const node = nodeById(getTree(), id);
    if (!node) return null;

    if (node.module && node.module.container) {
      const rect = node.el.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        const others = domOthers(node.el, drag.id);
        return {
          parentId: node.id,
          parentNode: node,
          index: computeInsertionIndex(
            others.map((child) => child.el.getBoundingClientRect()),
            { x, y },
            node.module.layout,
          ),
          others,
          insertParent: node.el,
        };
      }
    }

    const parent = findParent(getTree(), id);
    if (parent) {
      const domSiblings = domOthers(parent.el, drag.id);
      const others = domSiblings.length
        ? domSiblings
        : (parent.children || []).filter((child) => child.id !== drag.id);
      return {
        parentId: parent.id,
        parentNode: parent,
        index: computeInsertionIndex(
          others.map((child) => child.el.getBoundingClientRect()),
          { x, y },
          parent.module?.layout || 'flow',
        ),
        others,
        insertParent: parent.el,
      };
    }

    const domParent = node.el.parentNode;
    if (!domParent) return null;
    const domSiblings = domOthers(domParent, drag.id);
    const others = domSiblings.length
      ? domSiblings
      : getTree().filter((child) => child.id !== drag.id);
    return {
      parentId: '__root__',
      parentNode: null,
      index: computeInsertionIndex(
        others.map((child) => child.el.getBoundingClientRect()),
        { x, y },
        'flow',
      ),
      others,
      insertParent: domParent,
    };
  }

  function begin(id, event) {
    if (drag) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const node = nodeById(getTree(), id);
    if (!node) return;
    event.preventDefault();
    event.stopPropagation();
    drag = {
      id,
      node,
      pointerId: event.pointerId,
      origin: { x: event.clientX, y: event.clientY },
      target: null,
    };
    try { event.target.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    window.addEventListener('blur', onCancel, true);
    window.addEventListener('keydown', onKey, true);
  }

  function onMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const target = resolveTarget(event.clientX, event.clientY);
    if (!validTarget(drag, target)) {
      drag.target = null;
      overlay.hideLine();
      overlay.setDropTarget('');
      return;
    }
    drag.target = target;
    overlay.setDropTarget(target.parentNode && target.parentNode.id !== drag.id ? target.parentNode.id : '');
    overlay.showLine(lineRect(target.others, target.index, target.insertParent));
  }

  function onUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const current = drag;
    finish();
    const target = current.target;
    if (!validTarget(current, target)) return;

    const parentEl = target.insertParent || (target.parentNode ? target.parentNode.el : document.body);
    const others = (target.others || []).filter((node) => node.id !== current.id);
    const index = Math.max(0, Math.min(target.index, others.length));
    const oldIndex = domModuleChildren(parentEl).findIndex((node) => node.id === current.id);
    if (oldIndex === index) return;

    const fromParent = findParent(getTree(), current.id);
    const domParent = current.node.el.parentNode;
    const fromSiblings = domParent
      ? domModuleChildren(domParent)
      : (fromParent ? fromParent.children : getTree());
    const fromIndex = fromSiblings.findIndex((node) => node.id === current.id);

    parentEl.insertBefore(current.node.el, others[index] ? others[index].el : null);
    onMoved({
      module: current.id,
      from: { parent: fromParent ? fromParent.id : '__root__', index: fromIndex },
      to: { parent: target.parentId, index },
    });
    onChange();
  }

  function onCancel() {
    finish();
  }

  function onKey(event) {
    if (event.key === 'Escape' && drag) {
      event.preventDefault();
      finish();
    }
  }

  function finish() {
    drag = null;
    overlay.hideLine();
    overlay.setDropTarget('');
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
    window.removeEventListener('blur', onCancel, true);
    window.removeEventListener('keydown', onKey, true);
  }

  return { begin };
}
