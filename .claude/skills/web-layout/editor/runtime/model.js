const SKIP = new Set(['script', 'style', 'link', 'meta', 'template', 'noscript', 'br']);
const SEMANTIC_CONTAINERS = new Set(['header', 'nav', 'footer', 'section', 'article', 'aside', 'main', 'form', 'container']);

export function textPreview(text, max = 80) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function firstClass(className) {
  const parts = String(className || '').split(/\s+/).filter(Boolean);
  return parts[0] || '';
}

export function fingerprintOf({ tag, className, text }) {
  return String(tag || '').toLowerCase() + '|' + firstClass(className) + '|' + textPreview(text, 40);
}

export function roleOf({ tag, className }) {
  const name = String(tag || '').toLowerCase();
  const cls = String(className || '').toLowerCase();
  if (name === 'header') return 'header';
  if (name === 'nav') return 'nav';
  if (name === 'footer') return 'footer';
  if (name === 'section') return 'section';
  if (name === 'article') return 'article';
  if (name === 'aside') return 'aside';
  if (name === 'form') return 'form';
  if (/^h[1-6]$/.test(name)) return 'heading';
  if (name === 'p') return 'paragraph';
  if (name === 'img' || name === 'picture' || name === 'figure') return 'image';
  if (name === 'ul' || name === 'ol') return 'list';
  if (name === 'table') return 'table';
  if (name === 'hr') return 'divider';
  if (name === 'button' || name === 'a') return name === 'a' ? 'link' : 'button';
  if (/\bcard(s)?\b|card-grid/.test(cls)) return 'cards';
  if (name === 'div' || name === 'main') return 'container';
  return 'block';
}

export function layoutOf({ display, flexDirection, gridTemplateColumns }) {
  if (display === 'flex') return flexDirection === 'column' ? 'column' : 'row';
  if (display === 'grid') {
    const value = String(gridTemplateColumns || 'none');
    const repeat = /repeat\((\d+)/.exec(value);
    let count = 0;
    if (repeat) count = Number(repeat[1]);
    else count = value.split(/\s+/).filter((part) => part && part !== 'none').length;
    if (!count || count === 1 || count > 4) return 'grid-auto';
    return 'grid-' + count + 'col';
  }
  return 'flow';
}

export function computeInsertionIndex(rects, pointer, layout) {
  if (!rects.length) return 0;
  if (layout === 'row') {
    for (let i = 0; i < rects.length; i += 1) {
      // At the exact midpoint, insert before the item (contract: x=160 of item 2 -> index 1).
      if (pointer.x <= rects[i].left + rects[i].width / 2) return i;
    }
    return rects.length;
  }
  if (String(layout || '').startsWith('grid')) {
    const rows = [];
    for (let i = 0; i < rects.length; i += 1) {
      const rect = rects[i];
      let row = rows.find((candidate) => Math.abs(candidate.top - rect.top) < 12);
      if (!row) {
        row = { top: rect.top, items: [] };
        rows.push(row);
      }
      row.items.push({ rect, index: i });
    }
    rows.sort((a, b) => a.top - b.top);
    for (const row of rows) row.items.sort((a, b) => a.rect.left - b.rect.left);
    for (const row of rows) {
      const top = row.items[0].rect.top;
      const bottom = Math.max(...row.items.map((item) => item.rect.top + item.rect.height));
      if (pointer.y < top + (bottom - top) / 2) {
        for (const item of row.items) {
          if (pointer.x < item.rect.left + item.rect.width / 2) return item.index;
        }
        return row.items[row.items.length - 1].index + 1;
      }
    }
    return rects.length;
  }
  for (let i = 0; i < rects.length; i += 1) {
    if (pointer.y < rects[i].top + rects[i].height / 2) return i;
  }
  return rects.length;
}

export function findParent(nodes, id, parent = null) {
  for (const node of nodes || []) {
    if (node.id === id) return parent;
    const found = findParent(node.children, id, node);
    if (found !== null && found !== undefined) return found;
  }
  return null;
}

export function isDescendant(nodes, ancestorId, id) {
  const ancestor = (function find(list) {
    for (const node of list || []) {
      if (node.id === ancestorId) return node;
      const found = find(node.children);
      if (found) return found;
    }
    return null;
  })(nodes);
  if (!ancestor) return false;
  const walk = (list) => (list || []).some((node) => node.id === id || walk(node.children));
  return walk(ancestor.children);
}

function pickRoot(descriptor) {
  let root = descriptor;
  for (let i = 0; i < 2; i += 1) {
    const children = (root.children || []).filter((child) => child.visible !== false);
    if (children.length === 1 && (children[0].children || []).length >= 2) root = children[0];
    else break;
  }
  return root;
}

export function segment(rootDescriptor, { maxDepth = 3 } = {}) {
  const root = pickRoot(rootDescriptor);
  let seq = 0;
  const walk = (descriptor, depth) => {
    const role = roleOf(descriptor);
    const layout = layoutOf(descriptor);
    const children = (descriptor.children || [])
      .filter((child) => child.visible !== false && !SKIP.has(String(child.tag || '').toLowerCase()));
    const container = depth < maxDepth
      && children.length >= 2
      && (SEMANTIC_CONTAINERS.has(role) || layout !== 'flow');
    seq += 1;
    const base = descriptor.dataModule || descriptor.id || (role + '-' + seq);
    const id = String(base).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || ('block-' + seq);
    return {
      id,
      role,
      label: descriptor.dataModule || descriptor.id || role,
      ref: descriptor.ref || '',
      matchIndex: 0,
      tag: descriptor.tag,
      classes: descriptor.className || '',
      text: textPreview(descriptor.text),
      fingerprint: fingerprintOf(descriptor),
      container,
      layout,
      children: container ? children.map((child) => walk(child, depth + 1)) : [],
    };
  };
  return (root.children || [])
    .filter((child) => child.visible !== false && !SKIP.has(String(child.tag || '').toLowerCase()))
    .map((child) => walk(child, 1));
}
