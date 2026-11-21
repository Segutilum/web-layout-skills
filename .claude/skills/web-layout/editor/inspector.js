import { moduleIndex, findParent, widthAlignEnabled } from './state.js';

const WIDTHS = [
  ['auto', '自动'],
  ['full', '整行'],
  ['half', '半行'],
  ['third', '三分之一'],
  ['two-thirds', '三分之二'],
];
const ALIGNS = [
  ['start', '左'],
  ['center', '中'],
  ['end', '右'],
  ['stretch', '拉伸'],
];

export function parentLayoutOf(tree, manifest, id) {
  const parent = findParent(tree, id);
  if (!parent || parent.id === '__root__') return 'flow';
  // The runtime tree carries the parent's module (manifest or palette-added),
  // so a module dragged into an added grid container resolves to grid-*.
  if (parent.module) return parent.module.layout || 'flow';
  const mod = moduleIndex(manifest).get(parent.id);
  if (mod) return mod.layout;
  const added = (manifest && manifest.modules || []).find((item) => item.id === parent.id);
  if (added) return added.layout;
  return 'flow';
}

function field(labelText, control) {
  const wrapper = document.createElement('div');
  const label = document.createElement('label');
  label.textContent = labelText;
  wrapper.append(label, control);
  return wrapper;
}

export function renderInspector({ container, app, onChange }) {
  container.innerHTML = '';
  const title = document.createElement('h3');
  title.textContent = '检查器';
  container.appendChild(title);

  const index = moduleIndex(app.effectiveManifest || { modules: [] });
  const selected = index.get(app.selectedId);
  const added = app.added.get(app.selectedId);

  if (!app.selectedId) {
    const muted = document.createElement('div');
    muted.className = 'muted';
    muted.textContent = '在预览里点击一个模块。Alt+点击可以选一个子元素。';
    container.appendChild(muted);
  } else {
    const info = document.createElement('div');
    info.className = 'muted';
    info.textContent = (selected || added || { label: app.selectedId }).label + ' · ' + app.selectedId;
    container.appendChild(info);

    const note = document.createElement('textarea');
    note.placeholder = '这个模块要怎么改？';
    note.value = (added ? added.note : app.notes[app.selectedId]) || '';
    note.addEventListener('input', () => {
      if (added) added.note = note.value;
      app.notes[app.selectedId] = note.value;
      onChange();
    });
    container.appendChild(field('模块备注', note));

    if (selected) {
      const layout = parentLayoutOf(app.currentTree || [], app.effectiveManifest, app.selectedId);
      const enabled = widthAlignEnabled(layout);
      if (enabled.width) {
        const select = document.createElement('select');
        select.innerHTML = WIDTHS.map(([value, text]) => '<option value="' + value + '">' + text + '</option>').join('');
        select.value = (app.layoutHints[app.selectedId] && app.layoutHints[app.selectedId].width) || 'auto';
        select.disabled = Boolean(app.submitted);
        select.addEventListener('change', () => {
          app.layoutHints[app.selectedId] = { ...(app.layoutHints[app.selectedId] || {}), width: select.value };
          onChange();
        });
        container.appendChild(field('宽度', select));
      }
      if (enabled.align) {
        const select = document.createElement('select');
        select.innerHTML = ALIGNS.map(([value, text]) => '<option value="' + value + '">' + text + '</option>').join('');
        select.value = (app.layoutHints[app.selectedId] && app.layoutHints[app.selectedId].align) || 'stretch';
        select.disabled = Boolean(app.submitted);
        select.addEventListener('change', () => {
          app.layoutHints[app.selectedId] = { ...(app.layoutHints[app.selectedId] || {}), align: select.value };
          onChange();
        });
        container.appendChild(field('对齐', select));
      }
      if (!enabled.width && !enabled.align) {
        const muted = document.createElement('div');
        muted.className = 'muted';
        muted.textContent = '这个模块的父容器是普通文档流，宽度/对齐不可调。';
        container.appendChild(muted);
      }
    }
  }

  const global = document.createElement('textarea');
  global.placeholder = '例如：整体更紧凑，首屏标题更突出';
  global.value = app.globalNote;
  global.addEventListener('input', () => { app.globalNote = global.value; onChange(); });
  container.appendChild(field('整体要求', global));

  if (!app.submitted && app.candidate && typeof app.onPromote === 'function') {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '提升为模块';
    button.addEventListener('click', () => app.onPromote(app.candidate));
    container.appendChild(button);
  }
  if (!app.submitted && selected && typeof app.onDemote === 'function') {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '降级为子元素';
    button.addEventListener('click', () => app.onDemote(selected.id));
    container.appendChild(button);
  }
}
