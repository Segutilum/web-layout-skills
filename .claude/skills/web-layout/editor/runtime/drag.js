import { computeInsertionIndex, findParent } from './model.js';

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

  function siblingsOf(id) {
    const parent = findParent(getTree(), id);
    return parent ? parent.children : getTree();
  }

  function parentIdOf(id) {
    const parent = findParent(getTree(), id);
    return parent ? parent.id : '__root__';
  }

  function lineRect(others, index, parentNode) {
    if (others[index]) {
      const rect = others[index].el.getBoundingClientRect();
      return { left: rect.left, top: rect.top - 2, width: rect.width };
    }
    if (others.length) {
      const rect = others[others.length - 1].el.getBoundingClientRect();
      return { left: rect.left, top: rect.bottom - 1, width: rect.width };
    }
    const rect = (parentNode ? parentNode.el : document.body).getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width };
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
      targetIndex: -1,
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
    const parent = findParent(getTree(), drag.id);
    const parentNode = parent || null;
    const others = (parentNode ? parentNode.children : getTree()).filter((node) => node.id !== drag.id);
    const rects = others.map((node) => node.el.getBoundingClientRect());
    const index = computeInsertionIndex(rects, { x: event.clientX, y: event.clientY }, parentNode?.module?.layout || 'flow');
    drag.targetIndex = index;
    overlay.showLine(lineRect(others, index, parentNode));
  }

  function onUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const current = drag;
    finish();
    if (current.targetIndex < 0) return;
    const parent = findParent(getTree(), current.id);
    const parentNode = parent || null;
    const parentEl = parentNode ? parentNode.el : (current.node.el.parentNode || document.body);
    const others = (parentNode ? parentNode.children : getTree()).filter((node) => node.id !== current.id);
    const index = Math.max(0, Math.min(current.targetIndex, others.length));
    const oldIndex = (parentNode ? parentNode.children : getTree()).findIndex((node) => node.id === current.id);
    if (oldIndex === index) return;
    parentEl.insertBefore(current.node.el, others[index] ? others[index].el : null);
    onMoved({
      module: current.id,
      from: { parent: parentNode ? parentNode.id : '__root__', index: oldIndex },
      to: { parent: parentNode ? parentNode.id : '__root__', index },
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
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
    window.removeEventListener('blur', onCancel, true);
    window.removeEventListener('keydown', onKey, true);
  }

  return { begin };
}
