/**
 * Layout editor for HTML files in the Web GUI.
 *
 * The right Sidebar hosts one tab: it loads an HTML file from the current
 * Session's workspace, renders it in a sandboxed iframe, lets the user drag the
 * page's top-level blocks into a new order, and hands that arrangement to the
 * agent as a user message. The agent reads the arrangement and rewrites the real
 * HTML/CSS; the preview stays an approximation and never writes files.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-html-layout',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const TAG = '__dshHtmlLayout';
    const TAB_ID = '@local/dsh-html-layout';
    const KIND = 'html-layout';
    const NS = 'htmlLayout';
    const STORAGE_PREFIX = 'dsh.html-layout.path.';
    const DEFAULT_PATH = 'demo/index.html';

    const DICT = {
      en: {
        tabTitle: 'Layout editor',
        guideTitle: 'Layout editor',
        guideHint: 'Drag page blocks into order, then let the agent rewrite the code.',
        pathLabel: 'HTML file path',
        pathPlaceholder: 'demo/index.html',
        load: 'Load',
        reload: 'Reload the file',
        loading: 'Loading',
        empty: 'Load an HTML file from this workspace to start.',
        hint: 'Drag a numbered handle to reorder the page blocks. Page scripts are not executed here.',
        undo: 'Reset order',
        send: 'Ask the agent to apply',
        sending: 'Sending',
        clean: 'No changes',
        dirty: 'changed',
        modules: 'blocks',
        loadedNote: 'Loaded version {v}',
        stale: 'The file changed on disk',
        staleReload: 'Reload',
        horizontal: 'This container lays its blocks out in a row; DOM order changes may not move them.',
        discardConfirm: 'Discard the order you dragged and reload the file?',
        errorNoSession: 'This tab has no Session binding yet.',
        errorNoRemote: 'Workspace file access is unavailable.',
        errorNoFiles: 'The workspace file namespace is unavailable',
        errorNoPath: 'Enter a file path first.',
        errorEmptyDocument: 'No top-level block was found in this page.',
        errorNoRuntime: 'The preview did not start; the page may block scripts.',
        sent: 'Sent to the agent.',
        sendFailed: 'Could not send: {e}',
        loadFailed: 'Could not load: {e}',
      },
      zh: {
        tabTitle: '布局编辑器',
        guideTitle: '布局编辑器',
        guideHint: '拖动页面区块排序，然后让 agent 改写代码。',
        pathLabel: 'HTML 文件路径',
        pathPlaceholder: 'demo/index.html',
        load: '加载',
        reload: '重新读取文件',
        loading: '加载中',
        empty: '加载工作区里的一个 HTML 文件。',
        hint: '拖动区块左上角的编号手柄调整顺序；预览不执行页面脚本。',
        undo: '恢复顺序',
        send: '让 agent 改代码',
        sending: '发送中',
        clean: '无改动',
        dirty: '处改动',
        modules: '个区块',
        loadedNote: '已加载，版本 {v}',
        stale: '文件已在磁盘上改变',
        staleReload: '重新加载',
        horizontal: '这个容器是横向排列的，改 DOM 顺序可能看不出变化。',
        discardConfirm: '放弃你拖好的顺序并重新读取文件？',
        errorNoSession: '这个标签页还没有会话绑定。',
        errorNoRemote: '工作区文件服务不可用。',
        errorNoFiles: '工作区文件接口不可用',
        errorNoPath: '请先填写文件路径。',
        errorEmptyDocument: '页面里没有找到顶层区块。',
        errorNoRuntime: '预览没有启动，页面可能阻止了脚本。',
        sent: '已发送给 agent。',
        sendFailed: '发送失败：{e}',
        loadFailed: '加载失败：{e}',
      },
    };

    /* ------------------------------------------------------------------ */
    /* The script injected into the preview iframe.                          */
    /* Self-contained: it runs in a sandboxed document with no module access. */
    /* ------------------------------------------------------------------ */
    function previewRuntime() {
      var TAG = '__dshHtmlLayout';
      var SKIP = { SCRIPT: 1, STYLE: 1, LINK: 1, META: 1, TEMPLATE: 1, NOSCRIPT: 1, BR: 1 };
      var seq = 0;
      var modules = [];
      var boxes = [];
      var layer = null;
      var line = null;
      var drag = null;
      var raf = 0;

      function post(message) {
        message[TAG] = true;
        try {
          window.parent.postMessage(message, '*');
        } catch (error) {
          /* nothing to do */
        }
      }

      function childrenOf(el) {
        var out = [];
        var kids = el.children;
        for (var i = 0; i < kids.length; i++) {
          if (!SKIP[kids[i].tagName]) out.push(kids[i]);
        }
        return out;
      }

      function moduleRoot() {
        var root = document.body || document.documentElement;
        for (var i = 0; i < 2; i++) {
          var kids = childrenOf(root);
          if (kids.length === 1 && childrenOf(kids[0]).length >= 2) root = kids[0];
          else break;
        }
        return root;
      }

      function shortText(el) {
        var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        return text.slice(0, 60);
      }

      function firstClass(el) {
        var cls = el.className;
        if (typeof cls !== 'string') return '';
        var parts = cls.split(/\s+/);
        return parts.length ? parts[0] : '';
      }

      function refOf(el) {
        var attr = el.getAttribute('data-module');
        if (attr) return '[data-module="' + attr + '"]';
        if (el.id) return '#' + el.id;
        var cls = firstClass(el);
        if (cls && /^[A-Za-z_-][\w-]*$/.test(cls)) return '.' + cls;
        return '<' + el.tagName.toLowerCase() + '>';
      }

      function labelOf(el, index) {
        var attr = el.getAttribute('data-module') || el.getAttribute('aria-label') || '';
        if (attr) return attr;
        if (el.id) return '#' + el.id;
        var cls = firstClass(el);
        if (cls) return cls;
        var text = shortText(el);
        if (text) return text.slice(0, 24);
        return el.tagName.toLowerCase() + ' ' + (index + 1);
      }

      function idOf(el, index) {
        if (!el.__dshLayoutId) {
          seq += 1;
          el.__dshLayoutId = 'b' + seq + '-' + el.tagName.toLowerCase();
        }
        return el.__dshLayoutId;
      }

      function collect() {
        var root = moduleRoot();
        var list = childrenOf(root);
        if (!list.length && root !== document.body) list = childrenOf(document.body);
        modules = list;
        return list;
      }

      function catalog() {
        return modules.map(function (el, index) {
          return {
            id: idOf(el, index),
            index: index,
            tag: el.tagName.toLowerCase(),
            ref: refOf(el),
            label: labelOf(el, index),
            text: shortText(el),
            classes: typeof el.className === 'string' ? el.className : '',
            elementId: el.id || '',
          };
        });
      }

      function isHorizontal() {
        if (modules.length < 2) return false;
        var first = modules[0].getBoundingClientRect();
        var sameRow = 0;
        var counted = 0;
        for (var i = 1; i < modules.length; i++) {
          var rect = modules[i].getBoundingClientRect();
          if (rect.width <= 0) continue;
          counted += 1;
          if (Math.abs(rect.top - first.top) < 12 && rect.left > first.left) sameRow += 1;
        }
        return counted > 0 && sameRow >= Math.ceil(counted * 0.6);
      }

      function ensureElements() {
        if (layer) return;
        layer = document.createElement('div');
        layer.setAttribute('data-dsh-layout-layer', '');
        layer.style.cssText =
          'position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483000;';
        line = document.createElement('div');
        line.style.cssText =
          'position:fixed;height:3px;border-radius:2px;background:#3b82f6;box-shadow:0 0 0 2px rgba(59,130,246,.22);pointer-events:none;z-index:2147483001;display:none;';
        document.documentElement.appendChild(layer);
        document.documentElement.appendChild(line);
      }

      function clearBoxes() {
        for (var i = 0; i < boxes.length; i++) {
          if (boxes[i].box.parentNode) boxes[i].box.parentNode.removeChild(boxes[i].box);
          if (boxes[i].handle.parentNode) boxes[i].handle.parentNode.removeChild(boxes[i].handle);
        }
        boxes = [];
      }

      function buildBoxes() {
        ensureElements();
        clearBoxes();
        boxes = modules.map(function (el, index) {
          var box = document.createElement('div');
          box.style.cssText =
            'position:fixed;pointer-events:none;box-sizing:border-box;border:2px dashed rgba(59,130,246,.55);border-radius:8px;';
          var handle = document.createElement('div');
          handle.setAttribute('role', 'button');
          handle.setAttribute('title', '拖动排序');
          handle.style.cssText =
            'position:fixed;pointer-events:auto;cursor:grab;display:flex;align-items:center;height:22px;padding:0 8px;border-radius:11px;background:#3b82f6;color:#fff;font:600 11px/1 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.28);user-select:none;white-space:nowrap;max-width:70%;overflow:hidden;text-overflow:ellipsis;touch-action:none;';
          handle.textContent = index + 1 + ' · ' + labelOf(el, index);
          handle.addEventListener('pointerdown', onHandleDown.bind(null, index));
          document.documentElement.appendChild(box);
          document.documentElement.appendChild(handle);
          return { box: box, handle: handle };
        });
        layout();
      }

      function layout() {
        for (var i = 0; i < modules.length; i++) {
          var entry = boxes[i];
          if (!entry) continue;
          var rect = modules[i].getBoundingClientRect();
          var visible =
            rect.bottom > 2 && rect.top < window.innerHeight - 2 && rect.width > 4 && rect.height > 2;
          entry.box.style.display = visible ? 'block' : 'none';
          entry.handle.style.display = visible ? 'flex' : 'none';
          if (!visible) continue;
          entry.box.style.left = rect.left + 'px';
          entry.box.style.top = rect.top + 'px';
          entry.box.style.width = rect.width + 'px';
          entry.box.style.height = rect.height + 'px';
          entry.handle.style.left = rect.left + 6 + 'px';
          entry.handle.style.top = rect.top + 6 + 'px';
        }
      }

      function scheduleLayout() {
        if (raf) return;
        raf = window.requestAnimationFrame(function () {
          raf = 0;
          layout();
        });
      }

      function insertionPoint(y, from) {
        var dragged = modules[from];
        var others = modules.filter(function (_, index) {
          return index !== from;
        });
        var k = others.length;
        for (var i = 0; i < others.length; i++) {
          var rect = others[i].getBoundingClientRect();
          if (y < rect.top + rect.height / 2) {
            k = i;
            break;
          }
        }
        return { dragged: dragged, others: others, k: k };
      }

      function showLine(y) {
        var point = insertionPoint(y, drag.index);
        var rootRect = moduleRoot().getBoundingClientRect();
        var top;
        if (point.k < point.others.length) top = point.others[point.k].getBoundingClientRect().top;
        else if (point.others.length) {
          top = point.others[point.others.length - 1].getBoundingClientRect().bottom;
        } else {
          top = rootRect.top;
        }
        var clamped = Math.max(1, Math.min(window.innerHeight - 4, top));
        line.style.display = 'block';
        line.style.left = rootRect.left + 4 + 'px';
        line.style.width = Math.max(20, rootRect.width - 8) + 'px';
        line.style.top = clamped - 1 + 'px';
      }

      function autoScroll(y) {
        var edge = 56;
        var step = 0;
        if (y < edge) step = -Math.ceil((edge - y) / 3);
        else if (y > window.innerHeight - edge) step = Math.ceil((y - (window.innerHeight - edge)) / 3);
        if (!step) return;
        window.scrollBy(0, step);
        scheduleLayout();
        showLine(y);
      }

      function addDragListeners() {
        window.addEventListener('pointermove', onPointerMove, true);
        window.addEventListener('pointerup', onPointerUp, true);
        window.addEventListener('pointercancel', onPointerCancel, true);
        window.addEventListener('blur', onPointerCancel, true);
        window.addEventListener('keydown', onKeyDown, true);
      }

      function removeDragListeners() {
        window.removeEventListener('pointermove', onPointerMove, true);
        window.removeEventListener('pointerup', onPointerUp, true);
        window.removeEventListener('pointercancel', onPointerCancel, true);
        window.removeEventListener('blur', onPointerCancel, true);
        window.removeEventListener('keydown', onKeyDown, true);
      }

      function onHandleDown(index, event) {
        if (drag) return;
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        drag = { index: index, pointerId: event.pointerId, y: event.clientY };
        try {
          event.target.setPointerCapture(event.pointerId);
        } catch (error) {
          /* ignore */
        }
        addDragListeners();
        showLine(event.clientY);
      }

      function onPointerMove(event) {
        if (!drag || event.pointerId !== drag.pointerId) return;
        drag.y = event.clientY;
        event.preventDefault();
        autoScroll(drag.y);
        showLine(drag.y);
      }

      function onPointerUp(event) {
        if (!drag || event.pointerId !== drag.pointerId) return;
        var from = drag.index;
        var y = drag.y;
        finishDrag();
        var point = insertionPoint(y, from);
        if (point.k === from) {
          layout();
          return;
        }
        var parent = point.dragged.parentNode;
        if (!parent) return;
        parent.insertBefore(point.dragged, point.others[point.k] || null);
        modules = childrenOf(parent);
        buildBoxes();
        postOrder();
      }

      function onPointerCancel() {
        if (!drag) return;
        finishDrag();
        layout();
      }

      function onKeyDown(event) {
        if (event.key === 'Escape' && drag) {
          event.preventDefault();
          finishDrag();
          layout();
        }
      }

      function finishDrag() {
        drag = null;
        removeDragListeners();
        line.style.display = 'none';
      }

      function postOrder() {
        post({
          type: 'order',
          order: modules.map(function (el, index) {
            return idOf(el, index);
          }),
          horizontal: isHorizontal(),
        });
      }

      function applyOrder(order) {
        if (!modules.length) return;
        var parent = modules[0].parentNode;
        if (!parent) return;
        var byId = {};
        modules.forEach(function (el, index) {
          byId[idOf(el, index)] = el;
        });
        order.forEach(function (id) {
          var el = byId[id];
          if (el) parent.appendChild(el);
        });
        modules = childrenOf(parent);
        buildBoxes();
      }

      function boot() {
        collect();
        buildBoxes();
        window.addEventListener('scroll', scheduleLayout, true);
        window.addEventListener('resize', scheduleLayout);
        if (typeof window.ResizeObserver === 'function') {
          try {
            new window.ResizeObserver(scheduleLayout).observe(document.body);
          } catch (error) {
            /* ignore */
          }
        }
        if (typeof window.MutationObserver === 'function') {
          try {
            new window.MutationObserver(scheduleLayout).observe(document.body, { childList: true, subtree: false });
          } catch (error) {
            /* ignore */
          }
        }
        window.addEventListener('message', function (event) {
          if (event.source && event.source !== window.parent) return;
          var data = event.data;
          if (!data || data[TAG] !== true) return;
          if (data.type === 'applyOrder' && Array.isArray(data.order)) applyOrder(data.order);
          if (data.type === 'layout') layout();
        });
        post({
          type: 'ready',
          catalog: catalog(),
          order: modules.map(function (el, index) {
            return idOf(el, index);
          }),
          horizontal: isHorizontal(),
          title: document.title,
        });
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
      } else {
        boot();
      }
    }

    /* ------------------------------------------------------------------ */
    /* Helpers                                                              */
    /* ------------------------------------------------------------------ */
    function toBase64(bytes) {
      const view =
        bytes instanceof Uint8Array
          ? bytes
          : bytes instanceof ArrayBuffer
            ? new Uint8Array(bytes)
            : new Uint8Array(bytes && bytes.buffer ? bytes.buffer : bytes || []);
      const chunk = 0x8000;
      let text = '';
      for (let i = 0; i < view.length; i += chunk) {
        text += String.fromCharCode.apply(null, view.subarray(i, i + chunk));
      }
      return window.btoa(text);
    }

    function mimeOf(path) {
      const lower = String(path).toLowerCase();
      if (/\.png$/.test(lower)) return 'image/png';
      if (/\.jpe?g$/.test(lower)) return 'image/jpeg';
      if (/\.gif$/.test(lower)) return 'image/gif';
      if (/\.webp$/.test(lower)) return 'image/webp';
      if (/\.svg$/.test(lower)) return 'image/svg+xml';
      if (/\.bmp$/.test(lower)) return 'image/bmp';
      if (/\.ico$/.test(lower)) return 'image/x-icon';
      if (/\.avif$/.test(lower)) return 'image/avif';
      return 'application/octet-stream';
    }

    /** Resolve a page-relative or root-relative reference to a workspace path. */
    function resolveRelative(basePath, href) {
      if (!href) return null;
      const raw = String(href).trim();
      if (!raw || raw.charAt(0) === '#') return null;
      if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
      if (raw.slice(0, 2) === '//') return null;
      const clean = raw.split('#')[0].split('?')[0];
      if (!clean) return null;
      const normalized = String(basePath).replace(/\\/g, '/');
      const slash = normalized.lastIndexOf('/');
      const dir = slash >= 0 ? normalized.slice(0, slash + 1) : '';
      const rootRelative = clean.charAt(0) === '/';
      const segments = (rootRelative ? clean : dir + clean).split('/');
      const out = [];
      for (let i = 0; i < segments.length; i += 1) {
        const segment = segments[i];
        if (!segment || segment === '.') continue;
        if (segment === '..') {
          if (out.length > 1) out.pop();
          continue;
        }
        out.push(segment);
      }
      return out.join('/');
    }

    function errorText(result) {
      if (!result) return 'unknown error';
      if (result.ok === false && result.error) return result.error.message || result.error.code || 'error';
      return 'error';
    }

    function useHover() {
      const [hover, setHover] = React.useState(false);
      return [hover, { onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false) }];
    }

    function LayoutGlyph(props) {
      const size = (props && props.size) || 16;
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': true, fill: 'currentColor' },
        h('rect', { x: 1.5, y: 2, width: 13, height: 3.2, rx: 1 }),
        h('rect', { x: 1.5, y: 6.6, width: 13, height: 3.2, rx: 1, opacity: 0.7 }),
        h('rect', { x: 1.5, y: 11.2, width: 13, height: 2.8, rx: 1, opacity: 0.45 }),
      );
    }

    /* ------------------------------------------------------------------ */
    /* The plugin                                                           */
    /* ------------------------------------------------------------------ */
    return {
      inject: [
        'slots',
        'sessions',
        'sidebarRightTabs',
        'sidebarRight',
        'locale',
        'remote',
        'remote.workspaceFiles',
      ],

      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, 'en', DICT.en));
        ctx.effect(() => ctx.locale.register(NS, 'zh', DICT.zh));
        const t = ctx.locale.bind(NS);

        const label = (key) => {
          try {
            return t(key);
          } catch (error) {
            return DICT.en[key] || key;
          }
        };
        const format = (key, values) => {
          let text = label(key);
          Object.keys(values || {}).forEach((name) => {
            text = text.split('{' + name + '}').join(String(values[name]));
          });
          return text;
        };

        const sidebarRight = () => {
          try {
            if (ctx.sidebarRight) return ctx.sidebarRight;
          } catch (error) {
            /* not injected */
          }
          try {
            return ctx.get('sidebarRight') || null;
          } catch (error) {
            return null;
          }
        };

        /** Open the editor tab on one session, falling back through the available entry points. */
        const openEditor = (sessionId) => {
          const service = sidebarRight();
          if (!service) return false;
          let target = sessionId;
          if (!target) {
            try {
              target = service.mounted && service.mounted.getSnapshot ? service.mounted.getSnapshot() : undefined;
            } catch (error) {
              target = undefined;
            }
          }
          if (target && typeof service.openTabIn === 'function') {
            try {
              service.openTabIn(target, KIND);
              return true;
            } catch (error) {
              console.error('[html-layout] openTabIn failed', error);
            }
          }
          if (typeof service.openTab === 'function') {
            try {
              service.openTab(KIND);
              return true;
            } catch (error) {
              console.error('[html-layout] openTab failed', error);
            }
          }
          return false;
        };

        const remoteServices = (sessionId) => {
          const candidates = [];
          try {
            if (ctx.remote) candidates.push(ctx.remote);
          } catch (error) {
            /* not injected */
          }
          try {
            const global = ctx.get('remote');
            if (global && candidates.indexOf(global) < 0) candidates.push(global);
          } catch (error) {
            /* not mounted */
          }
          if (sessionId) {
            try {
              const scoped = ctx.sessions.scope(sessionId);
              if (scoped && scoped.remote) candidates.push(scoped.remote);
            } catch (error) {
              /* no scoped context */
            }
            try {
              const binding = ctx.sessions.binding(sessionId);
              if (binding && binding.ctx && binding.ctx.remote) candidates.push(binding.ctx.remote);
            } catch (error) {
              /* no binding */
            }
          }
          return candidates;
        };

        /** Resolve the workspace-file namespace; every path needs its own injected fiber access. */
        const workspaceFiles = (sessionId) => {
          const candidates = remoteServices(sessionId);
          if (!candidates.length) throw new Error(label('errorNoRemote'));
          let available = '';
          for (const candidate of candidates) {
            let files = null;
            try {
              files = candidate.workspaceFiles;
            } catch (error) {
              files = null;
            }
            if (files && typeof files.read === 'function') return files;
            try {
              const keys = Object.keys(candidate)
                .filter((key) => key.charAt(0) !== '$')
                .join(', ');
              if (!available && keys) available = keys;
            } catch (error) {
              /* an opaque service has no readable keys */
            }
          }
          throw new Error(label('errorNoFiles') + (available ? ' (' + available + ')' : ''));
        };

        const readText = async (sessionId, path, signal) => {
          const files = workspaceFiles(sessionId);
          let offset = 1;
          let text = '';
          let version = 0;
          let absolutePath = path;
          let pages = 0;
          for (;;) {
            const result = await files.read(sessionId, path, { offset, limit: 4000 }, signal);
            if (!result || result.ok !== true) throw new Error(errorText(result));
            const value = result.value || {};
            const chunk = typeof value.text === 'string' ? value.text : '';
            if (pages > 0 && chunk) text += '\n';
            text += chunk;
            if (value.version) version = value.version;
            if (value.absolutePath) absolutePath = value.absolutePath;
            const lines = typeof value.lines === 'number' ? value.lines : chunk ? chunk.split('\n').length : 0;
            offset += lines;
            pages += 1;
            if (value.eof !== false) break;
            if (!lines || pages > 40) break;
          }
          return { text, version, absolutePath };
        };

        /** Build the srcdoc, inlining local stylesheets and images; returns the sheets it used. */
        const buildDocument = async (sessionId, path, text, signal) => {
          const doc = new DOMParser().parseFromString(text, 'text/html');
          Array.from(doc.querySelectorAll('meta[http-equiv]')).forEach((meta) => {
            if (/content-security-policy/i.test(meta.getAttribute('http-equiv') || '')) meta.remove();
          });
          Array.from(doc.querySelectorAll('script')).forEach((script) => script.remove());
          Array.from(doc.querySelectorAll('base')).forEach((base) => base.remove());

          const head = doc.head || doc.documentElement;
          const styles = [];
          const sheets = [];
          let cssBudget = 1200000;
          const links = Array.from(doc.querySelectorAll('link[rel~="stylesheet" i][href]'));
          for (const link of links) {
            const href = link.getAttribute('href');
            link.remove();
            if (cssBudget <= 0) continue;
            const target = resolveRelative(path, href);
            if (!target) continue;
            try {
              const css = await readText(sessionId, target, signal);
              if (signal.aborted) return null;
              cssBudget -= css.text.length;
              styles.push('/* ' + href + ' */\n' + css.text);
              sheets.push(target);
            } catch (error) {
              /* an unreadable stylesheet must not break the preview */
            }
          }

          let imageBudget = 4 * 1024 * 1024;
          let imageCount = 12;
          const images = Array.from(doc.querySelectorAll('img[src]'));
          for (const image of images) {
            if (imageCount <= 0 || imageBudget <= 0) break;
            const src = image.getAttribute('src');
            const target = resolveRelative(path, src);
            if (!target) continue;
            try {
              const result = await workspaceFiles(sessionId).readBytes(sessionId, target, {}, signal);
              if (signal.aborted) return null;
              if (!result || result.ok !== true) continue;
              const bytes = result.value && result.value.data;
              const size = bytes ? (bytes.byteLength === undefined ? bytes.length : bytes.byteLength) : 0;
              if (!size || size > imageBudget) continue;
              imageBudget -= size;
              imageCount -= 1;
              image.setAttribute('src', 'data:' + mimeOf(target) + ';base64,' + toBase64(bytes));
            } catch (error) {
              /* leave the original reference in place */
            }
          }

          const overlayStyle = doc.createElement('style');
          overlayStyle.textContent =
            '[data-dsh-layout-layer], [data-dsh-layout-layer] * { box-sizing: border-box; }';
          if (styles.length) {
            const css = doc.createElement('style');
            css.textContent = styles.join('\n');
            head.appendChild(css);
          }
          head.appendChild(overlayStyle);

          const runtime = doc.createElement('script');
          runtime.textContent = '(' + previewRuntime.toString() + ')();';
          (doc.body || doc.documentElement).appendChild(runtime);

          return { srcDoc: '<!doctype html>\n' + doc.documentElement.outerHTML, sheets };
        };

        const buildPrompt = (path, order, catalog, version, sheets) => {
          const byId = new Map(catalog.map((item) => [item.id, item]));
          const describe = (item) => {
            if (!item) return '(unknown block)';
            const bits = ['<' + item.tag + '>', item.ref];
            const text = (item.text || '').replace(/\s+/g, ' ').trim();
            const head = item.label + '   ' + bits.join(' ');
            return text && text.indexOf(item.label) !== 0 ? head + '  "' + text.slice(0, 28) + '…"' : head;
          };
          const rows = order.map((id, index) => String(index + 1) + '. ' + describe(byId.get(id)));
          const before = catalog
            .slice()
            .sort((left, right) => left.index - right.index)
            .map((item) => item.label)
            .join(' → ');
          const intent = {
            file: path,
            blocks: order.map((id) => {
              const item = byId.get(id) || {};
              return { ref: item.ref || id, tag: item.tag || '', classes: item.classes || '' };
            }),
          };
          const lines = [
            '[布局编辑器] 我在预览里拖动了 `' + path + '` 顶层区块的顺序，请把 HTML 结构调整成下面的新顺序，并同步修正受影响的 CSS（首屏留白、相邻间距、边框、分隔线等）。',
            '',
            '新顺序（从上到下）：',
            rows.join('\n'),
            '',
            '原顺序（供你核对差异）：' + (before || '(unknown)'),
            '',
            '机器可读的布局意图（ref 用于在源码里定位元素）：',
            '```json',
            JSON.stringify(intent, null, 2),
            '```',
            '',
            '本次预览内联的样式表（改 CSS 时优先看这些文件）：',
          ];
          if (sheets.length) sheets.forEach((sheet) => lines.push('- ' + sheet));
          else lines.push('- （页面没有引用外部样式表，样式在 HTML 内）');
          lines.push(
            '',
            '要求：文案、图片和交互内容保持不变；只调整与顺序相关的结构、语义标签与 CSS；不要留下临时内联样式。',
            '请直接修改上述文件，不要反问；完成后用一句话说明改了哪些文件以及关键调整。',
          );
          if (version) lines.push('', '我读到文件版本 ' + version + '；若你编辑时版本已变，以文件实际内容为准。');
          return lines.join('\n');
        };

        const storeKey = (sessionId) => STORAGE_PREFIX + sessionId;

        const readStoredPath = (sessionId) => {
          try {
            return window.localStorage.getItem(storeKey(sessionId)) || '';
          } catch (error) {
            return '';
          }
        };

        const storePath = (sessionId, path) => {
          try {
            window.localStorage.setItem(storeKey(sessionId), path);
          } catch (error) {
            /* ignore */
          }
        };

        const styles = {
          root: {
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            minHeight: 0,
            background: 'var(--dsw-alias-bg-base)',
            color: 'var(--dsw-alias-label-primary)',
            fontSize: '12px',
          },
          toolbar: {
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '6px',
            padding: '8px 10px',
            borderBottom: '1px solid var(--dsw-alias-border-l1)',
            flex: 'none',
          },
          input: {
            flex: '1 1 140px',
            minWidth: 0,
            height: '28px',
            padding: '0 8px',
            borderRadius: '8px',
            border: '1px solid var(--dsw-alias-border-l1)',
            background: 'var(--dsw-alias-bg-layer-1)',
            color: 'inherit',
            fontSize: '12px',
            fontFamily: 'inherit',
          },
          canvas: { flex: 1, minHeight: 0, position: 'relative', background: '#fff' },
          frame: { width: '100%', height: '100%', border: 0, display: 'block', background: '#fff' },
          empty: {
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            padding: '24px',
            textAlign: 'center',
            color: 'var(--dsw-alias-label-secondary)',
            background: 'var(--dsw-alias-bg-base)',
          },
          hint: { fontSize: '11px', lineHeight: 1.6, maxWidth: '260px' },
          footer: {
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '8px',
            padding: '8px 10px',
            borderTop: '1px solid var(--dsw-alias-border-l1)',
            flex: 'none',
          },
          meta: {
            flex: '1 1 120px',
            minWidth: 0,
            color: 'var(--dsw-alias-label-secondary)',
            fontSize: '11px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          },
          error: {
            padding: '6px 10px',
            background: 'var(--dsw-alias-bg-layer-2)',
            color: 'var(--dsw-alias-state-error-primary)',
            fontSize: '11px',
            borderBottom: '1px solid var(--dsw-alias-border-l1)',
          },
          notice: {
            padding: '6px 10px',
            background: 'var(--dsw-alias-bg-layer-2)',
            color: 'var(--dsw-alias-label-secondary)',
            fontSize: '11px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            borderBottom: '1px solid var(--dsw-alias-border-l1)',
          },
          linkButton: {
            border: 0,
            background: 'transparent',
            color: 'var(--dsw-alias-label-primary)',
            font: 'inherit',
            cursor: 'pointer',
            padding: 0,
            textDecoration: 'underline',
          },
        };

        const secondaryButton = (hover, disabled) => ({
          height: '28px',
          padding: '0 10px',
          borderRadius: '8px',
          border: '1px solid ' + (hover && !disabled ? 'var(--dsw-alias-border-l2)' : 'var(--dsw-alias-border-l1)'),
          background: 'var(--dsw-alias-bg-layer-1)',
          color: 'inherit',
          font: 'inherit',
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.45 : 1,
          whiteSpace: 'nowrap',
        });

        const primaryButton = (hover, disabled) => ({
          height: '28px',
          padding: '0 12px',
          borderRadius: '8px',
          border: '1px solid transparent',
          background: 'var(--dsw-alias-label-primary)',
          color: 'var(--dsw-alias-bg-base)',
          font: 'inherit',
          fontWeight: 600,
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.45 : hover ? 0.88 : 1,
          whiteSpace: 'nowrap',
        });

        function useLocaleTick() {
          const [, setTick] = React.useState(0);
          React.useEffect(() => {
            let alive = true;
            const off = ctx.locale.subscribe(() => {
              if (alive) setTick((value) => value + 1);
            });
            return () => {
              alive = false;
              if (typeof off === 'function') off();
            };
          }, []);
        }

        function LayoutEditor(props) {
          const sessionId = props && props.sessionId;
          useLocaleTick();

          const [path, setPath] = React.useState(() => readStoredPath(sessionId) || DEFAULT_PATH);
          const [doc, setDoc] = React.useState(null);
          const [catalog, setCatalog] = React.useState([]);
          const [order, setOrder] = React.useState([]);
          const [baseline, setBaseline] = React.useState([]);
          const [busy, setBusy] = React.useState(false);
          const [error, setError] = React.useState('');
          const [notice, setNotice] = React.useState('');
          const [stale, setStale] = React.useState(false);
          const [ready, setReady] = React.useState(false);
          const [horizontal, setHorizontal] = React.useState(false);
          const iframeRef = React.useRef(null);
          const abortRef = React.useRef(null);
          const [loadHover, loadHoverProps] = useHover();
          const [reloadHover, reloadHoverProps] = useHover();
          const [undoHover, undoHoverProps] = useHover();
          const [sendHover, sendHoverProps] = useHover();

          const dirty = order.length > 0 && order.join('|') !== baseline.join('|');
          const changedCount = React.useMemo(() => {
            if (!dirty) return 0;
            let count = 0;
            for (let i = 0; i < order.length; i += 1) if (order[i] !== baseline[i]) count += 1;
            return count;
          }, [dirty, order, baseline]);

          const postToFrame = (message) => {
            const frame = iframeRef.current;
            if (!frame || !frame.contentWindow) return;
            message[TAG] = true;
            frame.contentWindow.postMessage(message, '*');
          };

          React.useEffect(() => {
            const onMessage = (event) => {
              const data = event.data;
              if (!data || data[TAG] !== true) return;
              const frame = iframeRef.current;
              if (!frame || !frame.contentWindow) return;
              if (event.source && event.source !== frame.contentWindow) return;
              if (data.type === 'ready') {
                setReady(true);
                setCatalog(Array.isArray(data.catalog) ? data.catalog : []);
                setOrder(Array.isArray(data.order) ? data.order : []);
                setBaseline(Array.isArray(data.order) ? data.order : []);
                setHorizontal(data.horizontal === true);
                if (!data.order || !data.order.length) setError(label('errorEmptyDocument'));
                else setError('');
              } else if (data.type === 'order') {
                setOrder(Array.isArray(data.order) ? data.order : []);
                setHorizontal(data.horizontal === true);
                setError('');
              }
            };
            window.addEventListener('message', onMessage);
            return () => window.removeEventListener('message', onMessage);
          }, []);

          React.useEffect(() => {
            return () => {
              if (abortRef.current) abortRef.current.abort();
            };
          }, []);

          React.useEffect(() => {
            if (!doc || ready) return undefined;
            const timer = window.setTimeout(() => {
              setError((previous) => previous || label('errorNoRuntime'));
            }, 4000);
            return () => window.clearTimeout(timer);
          }, [doc, ready]);

          const load = async (target) => {
            const wanted = String(target === undefined ? path : target || '').trim();
            if (!wanted) {
              setError(label('errorNoPath'));
              return;
            }
            if (!sessionId) {
              setError(label('errorNoSession'));
              return;
            }
            if (abortRef.current) abortRef.current.abort();
            const controller = new AbortController();
            abortRef.current = controller;
            setBusy(true);
            setError('');
            setStale(false);
            setReady(false);
            setNotice('');
            try {
              const file = await readText(sessionId, wanted, controller.signal);
              if (controller.signal.aborted) return;
              if (!file.text) throw new Error(label('errorEmptyDocument'));
              const built = await buildDocument(sessionId, wanted, file.text, controller.signal);
              if (controller.signal.aborted || built === null) return;
              storePath(sessionId, wanted);
              setPath(wanted);
              setCatalog([]);
              setOrder([]);
              setBaseline([]);
              setHorizontal(false);
              setDoc({
                srcDoc: built.srcDoc,
                sheets: built.sheets,
                path: wanted,
                version: file.version,
                absolutePath: file.absolutePath,
                stamp: Date.now(),
              });
              setNotice(format('loadedNote', { v: file.version || '?' }));
            } catch (cause) {
              if (!controller.signal.aborted) {
                setError(format('loadFailed', { e: (cause && cause.message) || String(cause) }));
              }
            } finally {
              if (!controller.signal.aborted) setBusy(false);
            }
          };

          const reload = (target) => {
            if (dirty && !window.confirm(label('discardConfirm'))) return;
            load(target);
          };

          React.useEffect(() => {
            if (!doc) return undefined;
            let stopped = false;
            let timer = 0;
            const tick = async () => {
              if (stopped || !sessionId) return;
              if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
                timer = window.setTimeout(tick, 8000);
                return;
              }
              try {
                const result = await workspaceFiles(sessionId).stat(sessionId, doc.path, undefined);
                if (!stopped && result && result.ok === true && result.value && result.value.version) {
                  setStale(result.value.version !== doc.version);
                }
              } catch (cause) {
                /* a failed poll is not worth surfacing */
              }
              if (!stopped) timer = window.setTimeout(tick, 4000);
            };
            timer = window.setTimeout(tick, 4000);
            return () => {
              stopped = true;
              window.clearTimeout(timer);
            };
          }, [doc]);

          const resetOrder = () => {
            if (!dirty) return;
            setOrder(baseline);
            postToFrame({ type: 'applyOrder', order: baseline });
          };

          const send = async () => {
            if (!dirty) return;
            if (!sessionId) {
              setError(label('errorNoSession'));
              return;
            }
            setBusy(true);
            setError('');
            try {
              const binding = ctx.sessions.binding(sessionId);
              if (!binding || !binding.session || typeof binding.session.prompt !== 'function') {
                throw new Error(label('errorNoSession'));
              }
              const text = buildPrompt(
                doc ? doc.path : path,
                order,
                catalog,
                doc ? doc.version : 0,
                (doc && doc.sheets) || [],
              );
              const result = await binding.session.prompt([{ type: 'text', text }], 'queue');
              if (result && result.ok === false) throw new Error(errorText(result));
              setBaseline(order);
              setNotice(label('sent'));
            } catch (cause) {
              setError(format('sendFailed', { e: (cause && cause.message) || String(cause) }));
            } finally {
              setBusy(false);
            }
          };

          const summary = doc
            ? catalog.length +
              ' ' +
              label('modules') +
              ' · ' +
              (dirty ? changedCount + ' ' + label('dirty') : label('clean'))
            : '';

          return h(
            'div',
            { style: styles.root },
            h(
              'div',
              { style: styles.toolbar },
              h('input', {
                value: path,
                placeholder: label('pathPlaceholder'),
                'aria-label': label('pathLabel'),
                spellCheck: false,
                style: styles.input,
                onChange: (event) => setPath(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    reload();
                  }
                },
              }),
              h(
                'button',
                Object.assign(
                  { type: 'button', style: secondaryButton(loadHover, busy), disabled: busy, onClick: () => reload() },
                  loadHoverProps,
                ),
                busy ? label('loading') : label('load'),
              ),
              h(
                'button',
                Object.assign(
                  {
                    type: 'button',
                    style: secondaryButton(reloadHover, busy || !doc),
                    disabled: busy || !doc,
                    title: label('reload'),
                    'aria-label': label('reload'),
                    onClick: () => reload(doc ? doc.path : path),
                  },
                  reloadHoverProps,
                ),
                '⟳',
              ),
            ),
            error ? h('div', { style: styles.error }, error) : null,
            !error && stale
              ? h(
                  'div',
                  { style: styles.notice },
                  h('span', null, label('stale')),
                  h(
                    'button',
                    { type: 'button', style: styles.linkButton, onClick: () => reload(doc ? doc.path : path) },
                    label('staleReload'),
                  ),
                )
              : null,
            !error && !stale && horizontal
              ? h('div', { style: styles.notice }, h('span', null, label('horizontal')))
              : null,
            !error && !stale && !horizontal && notice
              ? h('div', { style: styles.notice }, h('span', null, notice))
              : null,
            h(
              'div',
              { style: styles.canvas },
              doc
                ? h('iframe', {
                    key: doc.stamp,
                    ref: iframeRef,
                    srcDoc: doc.srcDoc,
                    sandbox: 'allow-scripts',
                    referrerPolicy: 'no-referrer',
                    title: label('tabTitle'),
                    style: styles.frame,
                  })
                : h(
                    'div',
                    { style: styles.empty },
                    h('div', null, label('empty')),
                    h('div', { style: styles.hint }, label('hint')),
                  ),
            ),
            h(
              'div',
              { style: styles.footer },
              h('span', { style: styles.meta, title: doc ? doc.absolutePath || doc.path : '' }, summary),
              h(
                'button',
                Object.assign(
                  { type: 'button', style: secondaryButton(undoHover, !dirty || busy), disabled: !dirty || busy, onClick: resetOrder },
                  undoHoverProps,
                ),
                label('undo'),
              ),
              h(
                'button',
                Object.assign(
                  { type: 'button', style: primaryButton(sendHover, !dirty || busy), disabled: !dirty || busy, onClick: send },
                  sendHoverProps,
                ),
                busy ? label('sending') : label('send'),
              ),
            ),
          );
        }

        function OpenEditorButton(props) {
          const sessionId = props && props.sessionId;
          const [hover, hoverProps] = useHover();
          const open = () => {
            if (!openEditor(sessionId)) console.warn('[html-layout] could not open the editor tab');
          };
          return h(
            'button',
            Object.assign(
              {
                type: 'button',
                title: label('tabTitle'),
                'aria-label': label('tabTitle'),
                onClick: open,
                style: {
                  width: '28px',
                  height: '28px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  border: 0,
                  borderRadius: '8px',
                  cursor: 'pointer',
                  background: hover ? 'var(--dsw-alias-border-l1)' : 'transparent',
                  color: 'var(--dsw-alias-label-secondary)',
                },
              },
              hoverProps,
            ),
            h(LayoutGlyph, { size: 15 }),
          );
        }

        function GuideRow(props) {
          const [hover, hoverProps] = useHover();
          const open = () => {
            const opened = openEditor(undefined);
            if (props && typeof props.onDismiss === 'function') props.onDismiss();
            if (!opened) console.warn('[html-layout] could not open the editor tab');
          };
          return h(
            'button',
            Object.assign(
              {
                type: 'button',
                role: 'menuitem',
                onClick: open,
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  minHeight: '32px',
                  padding: '0 10px',
                  border: 0,
                  borderRadius: '8px',
                  background: hover ? 'var(--dsw-alias-border-l1)' : 'transparent',
                  color: 'var(--dsw-alias-label-primary)',
                  font: 'inherit',
                  cursor: 'pointer',
                  textAlign: 'left',
                },
              },
              hoverProps,
            ),
            h('span', { style: { display: 'inline-flex', color: 'var(--dsw-alias-label-secondary)' } }, h(LayoutGlyph, { size: 15 })),
            h(
              'span',
              { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } },
              h('span', null, label('guideTitle')),
              h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '11px' } }, label('guideHint')),
            ),
          );
        }

        ctx.effect(() =>
          ctx.sidebarRightTabs.register({
            id: TAB_ID,
            kind: KIND,
            priority: 'extension',
            title: () => label('tabTitle'),
          }),
        );

        ctx.effect(() =>
          ctx.slots.inject('sidebar.right.pane.tab', () =>
            ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, LayoutEditor),
          ),
        );

        ctx.effect(() =>
          ctx.slots.inject('conversation.session.header.utilities', () =>
            ctx.slots.register(
              {
                name: 'conversation.session.header.utilities',
                id: 'html-layout',
                order: 40,
                label: label('tabTitle'),
              },
              OpenEditorButton,
            ),
          ),
        );

        ctx.effect(() =>
          ctx.slots.inject('sidebar.right.tab.guide.actions', () =>
            ctx.slots.register(
              {
                name: 'sidebar.right.tab.guide.actions',
                id: 'html-layout',
                order: 90,
                label: label('guideTitle'),
              },
              GuideRow,
            ),
          ),
        );
      },
    };
  },
});
