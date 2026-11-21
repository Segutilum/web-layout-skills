export function createOverlay(doc, win, { onSelect, onHandleDown }) {
  const host = doc.createElement('div');
  host.setAttribute('data-web-layout-overlay', '');
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = doc.createElement('style');
  style.textContent = [
    '.box{position:fixed;pointer-events:none;border:2px dashed rgba(47,111,237,.55);border-radius:8px;box-sizing:border-box;display:none}',
    '.box.selected{border-style:solid;border-color:#2f6fed;background:rgba(47,111,237,.04)}',
    '.box.drop{border-style:solid;border-color:#16a34a;background:rgba(22,163,74,.06)}',
    '.handle{position:fixed;pointer-events:auto;cursor:grab;height:22px;display:none;align-items:center;padding:0 8px;border-radius:11px;background:#2f6fed;color:#fff;font:600 11px/1 system-ui,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.25);user-select:none;white-space:nowrap;max-width:70%;overflow:hidden;text-overflow:ellipsis;touch-action:none}',
    '.line{position:fixed;height:3px;border-radius:2px;background:#2f6fed;box-shadow:0 0 0 2px rgba(47,111,237,.2);display:none;pointer-events:none}',
  ].join('');
  const line = doc.createElement('div');
  line.className = 'line';
  shadow.append(style, line);
  doc.documentElement.appendChild(host);

  const entries = new Map();
  let selectedId = '';
  let dropId = '';

  function flatten(nodes, out = []) {
    for (const node of nodes || []) {
      out.push(node);
      flatten(node.children, out);
    }
    return out;
  }

  function updateClasses() {
    for (const [id, entry] of entries) {
      entry.box.classList.toggle('selected', id === selectedId);
      entry.box.classList.toggle('drop', id === dropId);
    }
  }

  function ensure(node) {
    if (entries.has(node.id)) return entries.get(node.id);
    const box = doc.createElement('div');
    box.className = 'box';
    const handle = doc.createElement('div');
    handle.className = 'handle';
    handle.setAttribute('role', 'button');
    handle.addEventListener('pointerdown', (event) => onHandleDown(node.id, event));
    shadow.append(box, handle);
    const entry = { node, box, handle };
    entries.set(node.id, entry);
    return entry;
  }

  function layout(nodes) {
    const live = new Set(flatten(nodes).map((node) => node.id));
    for (const [id, entry] of entries) {
      if (!live.has(id)) {
        entry.box.remove();
        entry.handle.remove();
        entries.delete(id);
      }
    }
    const walk = (list) => {
      for (const node of list || []) {
        const entry = ensure(node);
        entry.node = node;
        const rect = node.el.getBoundingClientRect();
        const visible = rect.bottom > 2 && rect.top < win.innerHeight - 2 && rect.width > 4 && rect.height > 2;
        entry.box.style.display = visible ? 'block' : 'none';
        entry.handle.style.display = visible ? 'flex' : 'none';
        if (visible) {
          entry.box.style.left = rect.left + 'px';
          entry.box.style.top = rect.top + 'px';
          entry.box.style.width = rect.width + 'px';
          entry.box.style.height = rect.height + 'px';
          entry.handle.style.left = rect.left + 6 + 'px';
          entry.handle.style.top = rect.top + 6 + 'px';
          const flat = flatten(nodes);
          const index = flat.findIndex((item) => item.id === node.id);
          entry.handle.textContent = (index + 1) + ' · ' + (node.module?.label || node.id);
        }
        walk(node.children);
      }
    };
    walk(nodes);
    updateClasses();
  }

  function showLine(rect) {
    line.style.display = 'block';
    line.style.left = rect.left + 'px';
    line.style.top = rect.top + 'px';
    line.style.width = Math.max(20, rect.width) + 'px';
  }

  function hideLine() {
    line.style.display = 'none';
  }

  return {
    layout,
    render: layout,
    showLine,
    hideLine,
    setSelected(id) { selectedId = id || ''; updateClasses(); },
    setDropTarget(id) { dropId = id || ''; updateClasses(); },
    destroy() { host.remove(); entries.clear(); },
  };
}
