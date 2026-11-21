import { api } from './api.js';
import { buildIntent, countChanges, countLayoutHints, hasDraft, validateForSubmit } from './state.js';
import { renderInspector as renderInspectorView } from './inspector.js';
import { PALETTE } from './runtime/constants.js';

const ui = {
  pageSelect: document.getElementById('page-select'),
  palette: document.getElementById('palette'),
  inspector: document.getElementById('inspector'),
  banners: document.getElementById('banners'),
  summary: document.getElementById('summary'),
  frame: document.getElementById('preview'),
  frameWrap: document.getElementById('frame-wrap'),
  reset: document.getElementById('reset'),
  submit: document.getElementById('submit'),
};

const app = {
  token: new URLSearchParams(location.hash.replace(/^#/, '')).get('token') || '',
  state: null,
  effectiveManifest: null,
  baselineTree: null,
  currentTree: null,
  added: new Map(),
  removed: new Set(),
  moved: [],
  notes: {},
  layoutHints: {},
  globalNote: '',
  selectedId: '',
  unresolved: [],
  stale: false,
  submitted: false,
  pollTimer: null,
};

function setBanners(items) {
  ui.banners.innerHTML = '';
  for (const item of items) {
    const el = document.createElement('span');
    el.className = 'banner' + (item.error ? ' error' : '');
    el.textContent = item.text;
    ui.banners.appendChild(el);
  }
}

function renderPageSelect(pages, current) {
  ui.pageSelect.innerHTML = '';
  for (const page of pages) {
    const option = document.createElement('option');
    option.value = page;
    option.textContent = page;
    option.selected = page === current;
    ui.pageSelect.appendChild(option);
  }
}

function renderPalette() {
  ui.palette.innerHTML = '';
  for (const item of PALETTE) {
    const el = document.createElement('div');
    el.className = 'palette-item';
    el.textContent = item.label;
    el.draggable = true;
    el.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('application/x-web-layout-module', item.type);
      event.dataTransfer.effectAllowed = 'copy';
    });
    el.addEventListener('click', () => {
      if (!app.state) return;
      postToFrame({ type: 'insertMode', value: item.type, runtimeToken: app.state.runtimeToken });
      setBanners([{ text: '点击预览里的位置来插入「' + item.label + '」' }]);
    });
    ui.palette.appendChild(el);
  }
}

function renderInspector() {
  renderInspectorView({
    container: ui.inspector,
    app,
    onChange: renderSummary,
  });
}

function renderSummary() {
  const counts = countChanges(app);
  ui.summary.textContent = '移动 ' + counts.moved + ' · 新增 ' + counts.added + ' · 删除 ' + counts.removed + ' · ' + counts.notes + ' 条备注';
  const hints = countLayoutHints(app);
  if (hints > 0) ui.summary.textContent += ' · 提示 ' + hints;
  const errors = validateForSubmit(app);
  ui.submit.disabled = app.submitted || errors.length > 0;
  if (errors.length && !app.submitted) {
    ui.summary.textContent += ' · ' + errors.join(', ');
  }
}

function postToFrame(message) {
  const frame = ui.frame;
  if (!frame || !frame.contentWindow || !app.state) return;
  frame.contentWindow.postMessage(message, app.state.previewOrigin);
}

function previewUrlFor(page) {
  return app.state.previewOrigin + '/' + page.split('/').map(encodeURIComponent).join('/');
}

async function loadPage(page) {
  stopPolling();
  setBanners([]);
  const state = await api('/api/state?page=' + encodeURIComponent(page));
  app.state = state;
  app.page = state.page;
  app.sourceVersion = state.sourceVersion;
  app.styleVersion = state.styleVersion;
  app.manifestStatus = state.manifestStatus;
  app.stylesheets = state.stylesheets;
  app.effectiveManifest = state.manifest;
  app.baselineTree = null;
  app.currentTree = null;
  app.added = new Map();
  app.removed = new Set();
  app.moved = [];
  app.notes = {};
  app.layoutHints = {};
  app.globalNote = '';
  app.selectedId = '';
  app.unresolved = [];
  app.stale = state.manifestStatus === 'stale';
  app.submitted = false;
  if (app.stale) setBanners([{ text: '清单已过期，请让 agent 重新生成。', error: true }]);
  else if (state.manifestStatus !== 'ok') setBanners([{ text: '清单缺失或无效，正在使用启发式模块。' }]);
  renderPageSelect(state.pages, page);
  ui.frame.src = previewUrlFor(page);
  renderInspector();
  renderSummary();
  startPolling();
}

function startPolling() {
  stopPolling();
  app.pollTimer = setInterval(async () => {
    if (!app.state || document.visibilityState === 'hidden') return;
    try {
      const version = await api('/api/version?page=' + encodeURIComponent(app.state.page));
      app.stale = version.sourceVersion !== app.state.sourceVersion || version.styleVersion !== app.state.styleVersion;
      if (app.stale) setBanners([{ text: '文件已在磁盘上改变，请重新打开或刷新。', error: true }]);
      renderSummary();
    } catch {
      /* a failed poll is not fatal */
    }
  }, 4000);
}

function stopPolling() {
  if (app.pollTimer) clearInterval(app.pollTimer);
  app.pollTimer = null;
}

window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || !app.state) return;
  if (event.source !== ui.frame.contentWindow) return;
  if (event.origin !== app.state.previewOrigin) return;
  if (data.runtimeToken !== app.state.runtimeToken) return;
  if (data.type === 'boot') {
    const bootPage = decodeURIComponent(data.page || '');
    if (bootPage && bootPage !== app.state.page) {
      if (hasDraft(app)) {
        const ok = window.confirm('预览跳转到了 ' + bootPage + '。切换会放弃结构改动；取消则返回当前页并保留备注。继续切换？');
        if (!ok) {
          ui.frame.src = previewUrlFor(app.state.page) + '?__web_layout_reload=' + Date.now();
          app.currentTree = null;
          app.baselineTree = null;
          app.added = new Map();
          app.removed = new Set();
          app.moved = [];
          app.selectedId = '';
          renderInspector();
          renderSummary();
          return;
        }
      }
      loadPage(bootPage);
      return;
    }
    postToFrame({
      type: 'manifest',
      runtimeToken: app.state.runtimeToken,
      manifest: app.effectiveManifest,
      sourceVersion: app.state.sourceVersion,
      styleVersion: app.state.styleVersion,
    });
  }
  if (data.type === 'ready') {
    app.baselineTree = data.tree;
    app.currentTree = data.tree;
    app.unresolved = data.unresolved || [];
    if (data.manifest) app.effectiveManifest = data.manifest;
    renderInspector();
    renderSummary();
  }
  if (data.type === 'tree') {
    app.currentTree = data.tree;
    const previous = app.added;
    app.added = new Map((data.added || []).map((item) => [
      item.id,
      { ...item, note: previous.get(item.id)?.note || item.note || '' },
    ]));
    app.removed = new Set(data.removed || []);
    app.moved = data.moved || [];
    renderInspector();
    renderSummary();
  }
  if (data.type === 'select') {
    app.selectedId = data.id || '';
    renderInspector();
  }
  if (data.type === 'error') {
    setBanners([{ text: data.message || '预览错误', error: true }]);
  }
});

ui.pageSelect.addEventListener('change', async () => {
  if (hasDraft(app)) {
    if (!window.confirm('放弃当前未提交的改动并切换页面？')) {
      renderPageSelect(app.state.pages, app.state.page);
      return;
    }
  }
  await loadPage(ui.pageSelect.value);
});

for (const button of document.querySelectorAll('.viewports button')) {
  button.addEventListener('click', () => {
    for (const other of document.querySelectorAll('.viewports button')) other.classList.remove('active');
    button.classList.add('active');
    ui.frameWrap.style.width = button.dataset.width + 'px';
  });
}

ui.reset.addEventListener('click', () => {
  if (!window.confirm('重置所有拖拽和备注？')) return;
  app.notes = {};
  app.layoutHints = {};
  app.globalNote = '';
  app.added = new Map();
  app.removed = new Set();
  app.moved = [];
  app.selectedId = '';
  postToFrame({ type: 'reset', runtimeToken: app.state.runtimeToken });
  renderInspector();
  renderSummary();
});

ui.submit.addEventListener('click', async () => {
  const errors = validateForSubmit(app);
  if (errors.length) return;
  ui.submit.disabled = true;
  try {
    const manifest = app.effectiveManifest || app.state.manifest;
    if (manifest) {
      await api('/api/manifest?page=' + encodeURIComponent(app.state.page), {
        method: 'PUT',
        body: { manifest },
      });
    }
    const intent = buildIntent(app);
    const result = await api('/api/intent', { method: 'POST', body: { intent } });
    app.submitted = true;
    setBanners([{ text: '意图已保存到 ' + result.path + '，请回到 Claude Code。' }]);
  } catch (error) {
    setBanners([{ text: '提交失败：' + error.message, error: true }]);
  } finally {
    renderSummary();
  }
});

async function boot() {
  renderPalette();
  renderInspector();
  const page = new URLSearchParams(location.search).get('page') || '';
  try {
    const pages = (await api('/api/pages')).pages;
    const target = page || pages[0] || '';
    if (!target) {
      setBanners([{ text: '工作区里没有 HTML 页面。', error: true }]);
      return;
    }
    await loadPage(target);
  } catch (error) {
    setBanners([{ text: '加载失败：' + error.message, error: true }]);
  }
}

boot();
