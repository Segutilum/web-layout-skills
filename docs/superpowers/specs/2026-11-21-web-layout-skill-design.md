# Web Layout Skill 设计

- 日期：2026-11-21
- 状态：待审阅（draft）
- 范围：v1
- 目标目录：本项目根目录

## 1. 背景

当前项目里的 `html-layout` 是 DeepSeek Harness Web GUI 的右侧栏插件：加载工作区里的一个 HTML 文件，在沙箱 iframe 中预览，只允许拖动**同一容器内的顶层区块**排序，然后把顺序和区块定位信息作为一条用户消息发给 agent，由 agent 改写 HTML/CSS。

它验证了“拖拽只产出意图、不写文件”的方向，但有明显限制：

- 模块判定只有 `body` 顶层块（最多下钻两层），没有模块树、容器归属和语义角色。
- 不支持跨容器移动、分栏、模块增删、宽度/对齐提示。
- 不支持逐模块备注，AI 只能收到一个顺序数组和区块描述。
- 预览用 `srcdoc` 内联 CSS/图片，跨页面导航和依赖脚本的页面会失真，不适合多文件静态站点。
- 只能运行在 DSH 的右侧栏里，不是可独立分发的 Claude Code skill。

本设计把能力重做成一个 Claude Code skill：本地启动可视化编辑器，用户在真实站点预览里像搭积木一样拖拽模块、写要求，编辑器把结构化的“布局意图”写到工作区，agent 读取后改源码。

## 2. 目标与成功标准

### 目标

1. 用户可以在浏览器里打开一个静态站点的任意页面，看到由清单定义的模块树。
2. 用户可以同容器排序、跨容器移动、从模块面板新增、删除模块。
3. 用户可以为每个模块写自由备注，并写一条全局要求。
4. 拖拽和备注产出结构化的布局意图文件，明确表达目标模块树、每个模块的备注、宽度/对齐提示和用户看到源码版本。
5. agent 读取意图后，能稳定地定位模块、改写 HTML/CSS，并保持内容、语义和响应式行为。
6. 编辑器只写 `.web-layout/` 下的 sidecar 文件，**永不写源码**。

### 成功标准

- 在 `demo/` 站点上完成一轮：把 hero 移到 features 之后、新增一个标题模块、给两个模块写备注、写全局要求、提交；agent 应用后源码结构与预览一致。
- 意图文件能通过 schema 校验，版本号与用户看到的一致；过期或被篡改时提交被拒绝。
- 多文件站点里，被修改模块的 class 若在其他页面也在使用，意图里会出现共享样式警告。
- 用户用自然语言（如“帮我把首页模块化拖一下”）能正确触发 skill；普通的文字描述式布局修改不会被误触发。
- 编辑器、服务和 agent 的职责边界清晰：编辑器不写源码，agent 不以启发式猜测代替意图。

## 3. 已确认的决策

| 维度 | 决策 |
|---|---|
| 交付形态 | Claude Code Skill，本地浏览器编辑器 + 意图文件 |
| 页面范围 | 静态多文件站点（HTML/CSS/静态资源） |
| 模块来源 | 已有页面切分 + 模块面板增删 |
| 拖拽语义 | 结构 + 容器归属；排序、跨容器移动、增删；宽度/对齐作为结构化提示 |
| 需求表达 | 逐模块自由文本 + 全局自由文本 |
| 交接方式 | 单次交接：用户点“完成”，回到 Claude Code 由 agent 应用 |
| 运行时 | 一个 Node 进程，双 HTTP 监听（编辑器/API 与站点预览分离） |
| 模块模型 | agent 预生成模块清单（manifest），运行时启发式作为兜底 |
| 总体方案 | 方案 C：双端口真站点预览 + 预生成清单 |

## 4. 术语

- **站点根目录（root）**：用户指定的静态站点目录。所有可服务文件、清单、意图都限制在它下面。
- **页面（page）**：站点根目录内的一个 HTML 文件，例如 `index.html`。
- **模块（module）**：页面中一个可被识别、选择、拖拽的语义区块，例如 header、hero、标题、段落、卡片组、页脚。
- **容器（container）**：可以容纳子模块的模块，例如 `main`、`section`、网格或行容器。
- **模块树（module tree）**：模块与容器形成的树；根是一个合成节点 `__root__`。
- **清单（manifest）**：`.web-layout/pages/<slug>.json`，记录页面的模块树、角色、选择器、布局提示和源码版本。
- **意图（intent）**：`.web-layout/intent.json`，用户一次提交的布局目标，包含目标树、增删移动、备注、宽度/对齐和版本。
- **运行时（runtime）**：注入预览页的脚本，负责覆盖层、模块识别、拖拽、占位模块和与编辑器通信。
- **编辑器（editor）**：运行在 P1 的网页 UI，负责页面选择、模块面板、检查器、备注和提交。
- **预览服务（P2）**：按真实路径提供站点、注入运行时的 HTTP 监听。
- **编辑器服务（P1）**：提供编辑器静态文件和 API 的 HTTP 监听。

## 5. 总体架构

```text
Claude Code 会话
  └─ agent（按 SKILL.md 的 playbook）
       ├─ 读取 HTML/CSS，写 .web-layout/pages/*.json
       ├─ 后台启动 server.mjs
       └─ 用户点完成后读 .web-layout/intent.json → 改源码

server.mjs（只绑定 127.0.0.1）
  ├─ P1：编辑器页面 + API（token + Origin 校验）
  │     └─ iframe（跨 origin）──────────────┐
  └─ P2：站点静态文件 + 注入 runtime.js     │
        └─ runtime.js（Shadow DOM 覆盖层）──┘
             ↕ postMessage（模块树、拖拽、占位）
```

### 数据流

1. agent 确认站点根目录和目标页面，读取 HTML/CSS，生成/更新清单。
2. agent 后台启动 `server.mjs`；服务打印编辑器 URL、预览 URL、pid，并写 `.web-layout/server.json`。
3. 用户打开编辑器 URL；编辑器通过 P1 API 读取页面列表、清单和版本，iframe 加载 P2 的真实页面。
4. runtime 在页面内按清单匹配模块，建立覆盖层，向编辑器上报就绪消息和模块树。
5. 用户拖拽、增删、写备注；runtime 与编辑器通过 `postMessage` 同步当前树。
6. 用户点“完成”；编辑器校验后 POST 意图；服务原子写入 `.web-layout/intent.json`。
7. 用户回到 Claude Code；agent 读取意图，校验版本，改 HTML/CSS，重新生成清单，把意图归档到 `.web-layout/history/`。
8. 用户可重新加载预览确认；服务在确认后停止，或由 60 分钟空闲超时回收。

### 信任边界

- 预览页是用户自己的本地代码，视为可信但隔离：iframe 跨 origin，页面脚本不能访问编辑器的 DOM、API 或 token。
- 站点端口只服务站点根目录内的非隐藏文件；`frame-ancestors` 只允许编辑器 origin。
- 编辑器只接受来自当前 iframe、当前 origin、带 runtime token 的消息。
- API 只接受带 `X-Layout-Token` 的请求；写操作还要求 `Origin` 精确等于编辑器 origin。
- 站点页面的脚本可以伪造布局消息（它能看到注入的 runtime token），但只能影响编辑器里的待提交状态；最终提交由用户点击完成。这是本地单用户工具的接受边界。

## 6. 运行时与进程模型

### 6.1 启动命令

```bash
node .claude/skills/web-layout/scripts/server.mjs \
  --root <站点根目录> \
  --page <初始页面，相对 root> \
  --open \
  --idle-minutes 60
```

- `--root` 必填；不存在或不是目录时退出并打印错误。
- `--page` 可选；缺省时编辑器显示页面选择器。
- 端口默认都是 `0`（由系统分配）。可用 `--editor-port` / `--preview-port` 指定；被占用时回退到 `0` 并警告。
- `--open` 用平台命令打开默认浏览器：Windows `start`、macOS `open`、Linux `xdg-open`。失败只打印 URL，不阻塞。
- 启动成功后向 stdout 打印**一行 JSON**：
  ```json
  {"type":"web-layout-server","pid":1234,"root":"...","page":"index.html","editorUrl":"http://127.0.0.1:50123/#token=...","previewUrl":"http://127.0.0.1:50124/index.html","startedAt":"..."}
  ```
- 同时写 `.web-layout/server.json`，内容同上（含 token）。文件用原子写。
- `previewUrl` 是初始页面的 P2 URL；没有 `--page` 时为 P2 origin。
- `node server.mjs --stop --root <root>` 读取 `server.json`，向 pid 发终止信号，等待退出后删除 `server.json`。
- 若 `server.json` 已存在且 pid 仍存活，**拒绝重复启动**，打印已有 URL；若 pid 已死，覆盖。
- 空闲超时：P1 和 P2 都没有请求超过 `idle-minutes` 时优雅退出；`0` 表示禁用。
- 退出时关闭两个监听并删除 `server.json`。

### 6.2 端口与 origin

- P1：`http://127.0.0.1:<editorPort>`，编辑器页面在 `/`，API 在 `/api/*`。
- P2：`http://127.0.0.1:<previewPort>`，站点按相对路径提供，runtime 在 `/__layout/runtime.js`。
- token：启动时生成 32 字节 hex，放在编辑器 URL 的 **fragment** 里（`#token=...`，不会发给服务器或写日志）。编辑器读 fragment，后续 API 用 `X-Layout-Token` 头。
- runtime token：另一个随机值，通过注入的 bootstrap 配置传给 runtime；runtime 的每条消息都带它，编辑器校验。
- P1 响应头：`X-Frame-Options: DENY`，`Content-Security-Policy: frame-ancestors 'none'`。
- P2 响应头：移除页面自己的 CSP 与 `X-Frame-Options`，设置 `Content-Security-Policy: frame-ancestors <editorOrigin>`，`X-Content-Type-Options: nosniff`，`Cache-Control: no-store`，`Referrer-Policy: no-referrer`。
- 不启用 CORS；编辑器与 API 同 origin。

### 6.3 静态文件与路径安全

- P2 只处理 `GET`/`HEAD`。
- 解码 URL，拒绝 NUL、反斜杠归一化、`..` 段；用 `path.resolve(root, '.' + pathname)` 后校验结果仍在 root 内；再用 `fs.realpath` 防止符号链接逃逸。
- 拒绝任何以 `.` 开头的路径段（因此 `.git`、`.env`、`.web-layout` 都不会被服务）。
- 允许 `node_modules` 下的资源（静态站点可能引用），但受大小上限约束；`/__layout/*` 保留给 runtime 资源，不映射到工作区文件。
- 单文件上限 64 MiB；HTML 注入上限 10 MiB，超过则不注入并返回提示页。
- MIME：HTML/CSS/JS/JSON/SVG/常见图片/字体/wasm；未知类型用 `application/octet-stream`，并保持 `nosniff`。

### 6.4 HTML 注入

对每个 `text/html` 响应（仅在内存中）：

1. 移除 `<meta http-equiv="content-security-policy">`（大小写不敏感、属性顺序不敏感）。
2. 移除 `<meta http-equiv="refresh">`，避免预览被自动跳转打断。
3. 在 `<head>` 开头（没有则文档开头）注入 bootstrap：
   ```html
   <script>window.__WEB_LAYOUT__={editorOrigin:"http://127.0.0.1:<P1>",runtimeToken:"..."};
   (function(){try{Object.defineProperty(ServiceWorkerContainer.prototype,"register",{value:function(){return Promise.reject(new Error("web-layout preview disables service workers"));}})}catch(e){}})();</script>
   ```
4. 在 `</body>` 前（没有则末尾）注入 `<script src="/__layout/runtime.js" defer></script>`。
5. 不做其他改写；相对路径、页面脚本、跨页面链接保持原样。

Service Worker 禁用是尽力而为；端口每次启动都可能不同，旧 origin 的 SW 通常也无法命中新实例。

### 6.5 API（P1）

所有 `/api/*` 都要求 `X-Layout-Token`；`PUT`/`POST` 还要求 `Origin === editorOrigin`。

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/state?page=` | 页面列表、当前页清单、版本、样式表、警告 |
| GET | `/api/pages` | 站点内 HTML 文件列表 |
| GET | `/api/manifest?page=` | 清单或 `null` |
| PUT | `/api/manifest?page=` | 保存编辑器整理/导出的清单草稿 |
| GET | `/api/version?page=` | `{sourceVersion, styleVersion}`，供轮询 |
| POST | `/api/intent` | 校验并原子写 `.web-layout/intent.json` |
| POST | `/api/shutdown` | 带 token 的优雅退出 |

- 页面列表：递归扫描 root，扩展名 `.html`/`.htm`，跳过隐藏目录、`.web-layout` 和 `node_modules`；不跳过 `dist` 等构建输出。最多 6 层、500 个文件。
- `state` 里同时返回 `manifestStatus`：`ok` / `missing` / `invalid` / `stale`。
- 请求体上限 2 MiB；超限返回 413。
- 所有响应是 JSON（编辑器静态文件除外），错误格式 `{ok:false,error:{code,message}}`。

### 6.6 版本

- `sourceVersion`：目标 HTML 文件字节的 SHA-256，格式 `sha256:<hex>`。
- `styleVersion`：所有关联样式表的哈希汇总：
  - 关联样式表 = HTML 中 `<link rel="stylesheet" href>` 解析出的 root 内文件 + 页面内联 `<style>` 文本。
  - 汇总方式：对 `path + ":" + sha256(file)` 排序后用换行连接，再取 SHA-256。
  - 缺失的样式表记录为 `missing:<path>`，不致命。
- 服务端是版本的权威来源；清单里的 `sourceVersion` 只表示生成时刻，用于过期提示。
- 编辑器在加载时记录 `baseSourceVersion` / `baseStyleVersion`；提交时服务端重新计算，不一致就拒绝。
- agent 应用前重新计算并比对意图里的版本；不一致就停止，要求用户重新打开编辑器。

## 7. 模块模型与清单

### 7.1 清单位置与命名

- `.web-layout/pages/<slug>.json`。
- `slug` = 页面相对路径，`/` 替换为 `__`，去掉 `.html`/`.htm`。例如：
  - `index.html` → `index.json`
  - `about/team.html` → `about__team.json`
- 清单是缓存，不是真相源；HTML 始终是真相源。
- `.web-layout/.gitignore` 由服务端首次启动时创建：
  ```gitignore
  server.json
  intent.json
  history/
  ```
  `pages/` 下的清单可以由用户决定是否提交。

### 7.2 清单结构

```json
{
  "schema": 1,
  "page": "index.html",
  "generatedBy": "agent",
  "generatedAt": "2026-11-21T13:00:00.000Z",
  "sourceVersion": "sha256:...",
  "stylesheets": ["styles.css"],
  "modules": [
    {
      "id": "hero",
      "role": "hero",
      "label": "首屏 Hero",
      "ref": "section.hero",
      "matchIndex": 0,
      "tag": "section",
      "classes": "hero",
      "text": "把散落的讨论，收拢成一条清晰的决策线。",
      "fingerprint": "section|hero|把散落的讨论",
      "container": true,
      "layout": "grid-2col",
      "children": [
        {
          "id": "hero-copy",
          "role": "container",
          "label": "Hero 文案",
          "ref": "section.hero .hero-copy",
          "matchIndex": 0,
          "tag": "div",
          "classes": "hero-copy",
          "text": "团队协作工作台",
          "fingerprint": "div|hero-copy|团队协作工作台",
          "container": true,
          "layout": "column",
          "children": [
            {
              "id": "hero-title",
              "role": "heading",
              "label": "主标题",
              "ref": "section.hero h1",
              "matchIndex": 0,
              "tag": "h1",
              "classes": "",
              "text": "把散落的讨论，收拢成一条清晰的决策线。",
              "fingerprint": "h1||把散落的讨论",
              "container": false,
              "layout": "flow"
            }
          ]
        }
      ]
    }
  ]
}
```

### 7.3 字段规则

- `id`：页内唯一、kebab-case、稳定。优先级：源码 `data-module` → 元素 `id` → `role + slug(标签/class/文本前缀)`。不要用易变的索引作为唯一 id。
- `role` 枚举：`header, nav, hero, section, article, aside, footer, form, cards, list, table, heading, paragraph, image, button, link, divider, container, block`。未知用 `block`。
- `label`：给人看的短名，≤ 40 字符；用于覆盖层和意图。
- `ref`：给浏览器 `querySelectorAll` 的选择器。允许：标签、`#id`、`.class`、`[data-*]`、后代/子代组合、`:nth-of-type()`。避免 `:has()`、`:nth-child()` 依赖兄弟顺序的写法。
- `matchIndex`：当 `ref` 匹配多个元素时取第几个，默认 `0`。
- `classes`：完整 class 字符串，用于共享样式警告。
- `text`：文本预览，压空白后 ≤ 80 字符。
- `fingerprint`：`tag|firstClass|text前40字`，运行时用它检测选择器是否仍指向预期元素。
- `container`：`true` 才能作为投放目标。
- `layout` 枚举：`row, column, grid-2col, grid-3col, grid-4col, grid-auto, flow`。`flow` 表示普通文档流，不能跨列投放。
- `children`：仅 `container: true` 时出现；整页最多 3 层模块深度（根 → 区块 → 区块内一层）。
- 顶层模块的父节点是合成 `__root__`；意图里用 `"parent": "__root__"` 表示放在页面根。
- 页面模块总数上限 300；超过时编辑器提示，agent 应先聚合或拆分页面。

### 7.4 生成与更新

- **主路径**：agent 读 HTML/CSS 后写清单。agent 必须给出语义角色、可解析选择器、容器标记和布局提示。
- **兜底**：清单缺失、解析失败或选择器失效时，runtime 用启发式生成临时模块树，编辑器顶部提示“清单缺失/过期，正在使用启发式”。
- **启发式规则**：
  - 根：`main` 优先，否则 `body`；若只有一个包裹元素且它有多块子元素，向内下钻最多两层。
  - 忽略 `script/style/link/meta/template/noscript/br` 和不可见元素。
  - 角色按标签/class/aria 推断：header/nav/footer/section/article/aside/form/h1-h6/p/img/ul/ol/table/hr/button。
  - 容器：计算样式为 `flex`/`grid` 且有两个以上块级子元素，或语义容器且子元素 ≥ 2。
  - 布局：`flex-direction: row` → `row`；`column` → `column`；`grid` 解析 `grid-template-columns` 的列数（含 `repeat(N, …)`）→ `grid-Ncol`，超过 4 列用 `grid-auto`；否则 `flow`。
- **编辑器整理**：用户可以“提升为模块 / 降级为子元素”，编辑器通过 `PUT /api/manifest` 写回清单，`generatedBy: "editor"`，`sourceVersion` 由服务端填当前值。下次打开仍然稳定。
- **编辑器写回**：`PUT /api/manifest` 保留未知字段，只修改被提升/降级的模块及其父级的 `children`；服务端重算并覆盖 `sourceVersion`。
- **重新生成**：agent 每次应用意图后必须重新生成清单；否则编辑器检测到 `sourceVersion` 不一致，进入过期/启发式模式并禁止提交。

## 8. 编辑器交互

### 8.1 布局

```text
┌──────────────────────────────────────────────────────────────┐
│ 页面选择器 ▾   视口：桌面/平板/手机        状态/警告横幅        │
├──────────────┬──────────────────────────────┬────────────────┤
│ 模块面板      │  iframe 预览 + 覆盖层          │ 检查器          │
│ 标题          │                              │ 角色 / 标签      │
│ 段落          │                              │ 备注 textarea    │
│ 按钮组        │                              │ 宽度 / 对齐      │
│ 图片          │                              │ 引用 ref         │
│ 卡片组        │                              │                │
│ 两栏 / 三栏    │                              │                │
│ 分隔线 / 区块  │                              │                │
├──────────────┴──────────────────────────────┴────────────────┤
│ 改动摘要：移动 2 · 新增 1 · 删除 1 · 3 条备注   [重置] [完成]  │
└──────────────────────────────────────────────────────────────┘
```

- iframe：`sandbox="allow-scripts allow-same-origin allow-forms allow-modals"`，不加 `allow-top-navigation`、`allow-popups`。跨 origin 下允许同源是为了让站点自己的 localStorage/模块脚本正常工作；站点仍无法访问 P1。

### 8.2 选择与覆盖层

- runtime 在页面内创建 Shadow DOM 宿主（`position: fixed; inset: 0; pointer-events: none; z-index: 2147483646`），内部画模块边框、编号手柄、插入线、投放区高亮。
- 悬停显示标签与角色；点击选中，编辑器检查器切换到该模块；有备注的模块带角标。
- 覆盖层用 `getBoundingClientRect` 定位，滚动、resize、`ResizeObserver`、`MutationObserver` 时重排。
- 覆盖层手柄 `pointer-events: auto`，其余区域不拦截页面交互。
- 编辑器只接受 `event.source === iframe.contentWindow`、`event.origin === previewOrigin`、`data.runtimeToken` 匹配的消息；runtime 的 `postMessage` 只发往 `editorOrigin`。
- 编辑器在 runtime 上报 `boot` 后把当前页清单发给它；runtime 应用清单（或启发式）后上报基线树，编辑器保存为 diff 基线。

### 8.3 拖拽

**同容器排序**

- 拖手柄，`pointerdown` 设置 pointer capture；`pointermove` 计算插入位并画线；`pointerup` 提交 DOM 变更并向编辑器发送新树；`Escape` 取消。
- 插入位按容器布局计算：
  - `column`：比较指针 Y 与各子模块中线。
  - `row`：比较指针 X。
  - `grid-*`：按阅读顺序（先 top 分桶，再 left）比较，取最近的间隙。
  - `flow`：按 Y。

**跨容器移动**

- 用 `document.elementFromPoint` 找到指针下的页面元素，再向上找最近的清单模块。
- 若目标是 `container: true` 且指针落在其内容区域，投放目标是该容器；否则目标是被指模块的父容器，插到该模块前/后。
- 目标容器不能是拖拽模块自身或它的后代；叶节点不能作为父容器。
- 容器整体高亮，内部画插入线；非法目标不显示投放提示。

**从模块面板新增**

- 面板项可拖拽（HTML5 DnD，`dataTransfer` 携带 `application/x-web-layout-module` 类型）。运行时在 iframe 内监听 `dragover`/`drop`，读取类型，在落点创建占位模块。
- 触屏/无拖拽场景：点击面板项进入“插入模式”，再点击预览中的模块或容器，插到其前/后/内部。
- 占位模块带 `data-web-layout-id="new-N"`、`data-web-layout-added="N"`，用注入的 `<style>` 画出虚线框和类型标签；只存在于当前预览 DOM，不写源码。

**删除**

- 选中后按 Delete 或检查器里的删除按钮；runtime 给元素加 `data-web-layout-removed` 并 `display: none !important`，记录移除。重置/重新加载时恢复。

**重置**

- “重置全部”重新加载 iframe，清空新增/删除/拖拽，并（二次确认后）清空备注与全局要求。

### 8.4 宽度与对齐

- 枚举：
  - `width`: `auto | full | half | third | two-thirds`
  - `align`: `start | center | end | stretch`
- 启用条件（只看父容器布局，不看模块自身是否为叶节点）：
  - 父容器 `row` / `grid-*`：宽度和对齐都可用。
  - 父容器 `column`：只启用对齐（水平），宽度禁用。
  - 父容器 `flow` / 根：都禁用。
- 这些是布局提示，不是像素值；agent 负责映射到 grid span、flex 对齐和响应式堆叠。

### 8.5 备注

- 检查器里每个选中模块一个 textarea（≤ 4000 字符）；有内容的模块显示角标。
- 底部固定“整体要求” textarea（≤ 8000 字符）。
- 备注按模块 `id` 存储；新增模块的备注存在 `added[].note`。
- 备注不直接改页面；只在提交时进入意图。

### 8.6 多页面与视口

- 页面选择器列出 `/api/pages` 的结果；切换页面时，若有未提交改动，先确认放弃。
- 单次交接的范围是**当前页**：一轮只提交一个页面的意图；其他页面重新打开编辑器再改。v1 不做多页批量。
- 视口预设：桌面 1280、平板 834、手机 390；切换只改 iframe 容器宽度，runtime 重排覆盖层，不改变页面本身。
- 预览内导航到另一个页面时，runtime 上报 `navigated`；编辑器把当前页切换过去。切换前有未提交改动时，编辑器提示并允许返回上一页；跨 origin 无法可靠阻止页面脚本主动导航，这是已知限制。

### 8.7 过期与未匹配

- 编辑器每 4 秒轮询 `/api/version`（标签页隐藏时暂停）。版本变化时显示横幅，禁用提交，提供“重新加载”。
- runtime 匹配清单模块时比对 `fingerprint`。选择器找不到元素或指纹不符 → 标记 `unresolved`；编辑器列出未匹配模块并**禁止提交**，提示让 agent 重新生成清单。
- 清单缺失/无效时使用启发式树；提交前提示“清单未生成，意图可能不稳定”，但允许提交。提交时编辑器会把当前使用的清单（含启发式）通过 `PUT /api/manifest` 落盘，`generatedBy` 标记来源，保证 agent 总能读到 id→ref 映射。

### 8.8 提交

- 前置校验：
  - 至少一处移动/新增/删除或一条备注。
  - 没有 `unresolved` 模块。
  - 源码/样式版本与加载时一致。
  - 不存在循环嵌套或把容器拖进自己后代。
- 提交前先把当前使用的清单（含启发式）写回 `.web-layout/pages/`；写入失败则禁止提交。
- 提交成功后，编辑器进入“已提交”只读状态，显示意图路径和“回到 Claude Code”。
- “继续编辑”按钮解除只读；如果上一份意图尚未被 agent 归档，提示会覆盖。
- 编辑器不负责知道 agent 是否应用成功；它只保证意图写入是原子的。

### 8.9 运行时消息协议

| 方向 | 消息 | 负载 |
|---|---|---|
| runtime → editor | `boot` | `{runtimeToken, page}` |
| editor → runtime | `manifest` | `{manifest \| null, sourceVersion, styleVersion}` |
| runtime → editor | `ready` | `{page, tree, unresolved[]}` |
| runtime → editor | `tree` | `{page, tree, added[], removed[]}` |
| runtime → editor | `navigated` | `{page}` |
| runtime → editor | `error` | `{code, message}` |
| editor → runtime | `reset` | `{}` |

- 所有消息都带 `runtimeToken`；`tree` 是当前页面的完整目标树，不是增量。
- 新增/删除的权威状态在 runtime；编辑器用 `tree` + `added`/`removed` 生成意图。
- `unresolved` 非空时编辑器禁止提交，并提示重新生成清单。

## 9. 意图格式

### 9.1 位置与写入

- 固定路径：`.web-layout/intent.json`。
- 服务端收到合法 `POST /api/intent` 后写临时文件再 `rename`，保证原子性。
- agent 应用成功后把文件移动到 `.web-layout/history/<YYYYMMDDTHHmmssZ>-<slug>.json`（文件名不含冒号，兼容 Windows）；失败或中断时保留原文件，不归档。
- 同一工作区一次只应存在一份待处理意图；重复提交覆盖前一份（编辑器在“已提交”状态下默认禁止）。

### 9.2 结构

```json
{
  "schema": 1,
  "kind": "web-layout-intent",
  "page": "index.html",
  "submittedAt": "2026-11-21T13:10:00.000Z",
  "sourceVersion": "sha256:...",
  "styleVersion": "sha256:...",
  "globalNote": "整体更紧凑，首屏标题更突出",
  "changes": {
    "moved": [
      {
        "module": "hero",
        "from": { "parent": "__root__", "index": 1 },
        "to": { "parent": "__root__", "index": 2 }
      }
    ],
    "added": [
      {
        "id": "new-1",
        "type": "heading",
        "label": "客户证言",
        "note": "两行以内，放在 hero 下面",
        "parent": "hero",
        "index": 2
      }
    ],
    "removed": [{ "module": "faq", "ref": "section.faq" }]
  },
  "modules": [
    { "id": "hero", "ref": "section.hero", "note": "留白收紧", "width": "full", "align": "start" }
  ],
  "tree": [
    {
      "id": "__root__",
      "children": [
        { "id": "site-header" },
        { "id": "features" },
        { "id": "hero", "children": [{ "id": "hero-copy" }, { "id": "hero-art" }, { "id": "new-1" }] },
        { "id": "pricing" },
        { "id": "site-footer" }
      ]
    }
  ],
  "context": {
    "manifestStatus": "ok",
    "stylesheets": ["styles.css"],
    "sharedClassWarnings": [
      { "class": "hero", "pages": ["about.html"] }
    ]
  }
}
```

### 9.3 规则

- `changes.moved` 记录用户**显式移动**的模块（被拖拽的模块），不是每个因插入而索引偏移的兄弟；每个模块最多一条，`from` 可省略，但 `to` 必填。最终顺序以 `tree` 为准。
- `changes.added` 只含元数据与落点，可选带 `width`/`align`；最终嵌套以 `tree` 为准（新增容器可以有子节点）。
- `changes.removed` 的模块不出现在 `tree` 中。
- `modules[]` 只收录**有备注或宽度/对齐变化**的已有模块，避免文件过大；其余模块的结构信息在 `tree` 和清单里。
- `tree` 的展开规则：
  - `tree` 是只含一个根节点 `__root__` 的数组；`__root__.children` 总是完整列出所有未删除的顶层模块。
  - 省略某个节点的 `children` 表示该子树沿用清单，未展开的子孙不视为删除。
  - 一旦列出 `children`，必须完整列出该层的所有子节点（新增、保留、不删除的），否则缺失的节点会被视为移除。
  - 任何被移动、新增或删除的模块，其祖先链必须展开到该模块。
  - 所有新增模块必须显式出现，并与 `changes.added` 一一对应；删除的模块不得出现。
  - 没有重复 id；父节点必须是容器或 `__root__`；没有环。
- 备注长度：单模块 ≤ 4000，全局 ≤ 8000；整个意图 ≤ 2 MiB。
- `context.manifestStatus` 为 `ok` / `missing` / `invalid` / `heuristic`；非 `ok` 时编辑器提交前已把运行时清单落盘，agent 应先读它，再按意图和当前 HTML 重建/校验清单并应用。
- `context.sharedClassWarnings` 由服务端在提交时计算：
  - 取被移动/删除模块、新增模块落点父级，以及有备注/宽度/对齐变化的模块的 `classes`（来自清单）。
  - 拆分 class token，扫描站点其他 HTML 的 `class="..."` / `class='...'`（正则，启发式）。
  - 返回精确 token 命中的 `{class, pages}`，最多 50 条。
- 版本字段必须等于用户加载时服务端报告的版本；否则 400。
- 未知字段：服务端忽略；agent 也忽略，保证 schema 1 的前向兼容。

### 9.4 校验错误码

- `E_EMPTY_CHANGES`：没有改动也没有备注。
- `E_STALE_SOURCE` / `E_STALE_STYLE`：版本不一致。
- `E_UNRESOLVED`：存在未匹配模块。
- `E_TREE_INVALID`：重复 id、父节点不是容器、存在环、新增模块缺失。
- `E_PAGE_MISMATCH`：意图页面与当前页不一致。
- `E_TOO_LARGE`：超过大小限制。
- `E_WRITE_FAILED`：磁盘写入失败。

## 10. Agent 应用流程（Playbook）

SKILL.md 必须把下列步骤写成可执行的清单。

**适用判断**：只有用户明确想要可视化拖拽、模块化页面或逐模块提要求时才启动编辑器；纯文字描述的样式修改直接改代码，不启动本 skill。

### 10.1 启动前

1. 确认站点根目录和目标页面；如果用户没说，先在项目里找 HTML，给出候选让用户选。
2. 读目标 HTML、关联 CSS（`<link rel="stylesheet">` 与内联 `<style>`）。
3. 生成/更新 `.web-layout/pages/<slug>.json`：
   - 顶层用 `main` 或 `body` 的语义区块。
   - 每个模块给出 `id`、`role`、`label`、`ref`、`matchIndex`、`tag`、`classes`、`text`、`fingerprint`、`container`、`layout`。
   - 容器最多 3 层；不要把所有 div 都列成模块。
4. 如果清单已存在但 `sourceVersion` 与当前 HTML 不一致，重新生成。
5. 启动服务（后台），读取打印的 JSON，把编辑器 URL 告诉用户，并说明“拖完点完成，再回来告诉我”。
6. **结束本轮**，不要一边启动一边改代码。

### 10.2 用户回来之后

1. 读 `.web-layout/intent.json`；不存在就说明没有待处理意图。
2. 读清单、目标 HTML、关联 CSS；若清单缺失或 `context.manifestStatus !== "ok"`，先按意图的 `tree` 和当前 HTML 重建清单，再继续。
3. 重新计算 `sourceVersion` / `styleVersion`，与意图比对；不一致就停止，要求用户重新打开编辑器。
4. 定位模块：`querySelector` 不支持 Node 环境；按 `ref` 在源码中查找对应元素（id/class/标签/组合选择器），必要时用 `text`/`fingerprint` 核对。不要按行号硬编码。
5. 列出将要做的事：移动、新增、删除、备注对应的 CSS 调整。
6. 检查非法变化：循环嵌套、叶节点当容器、删除后仍被引用的 id/锚点。
7. 改 HTML：
   - 移动保留完整元素与内容；跨容器移动时放到目标容器的正确位置。
   - 删除只删目标模块；如果留下空容器，按语义决定是否一并清理，不要做无关重构。
   - 新增模块按 `type` 生成语义标签（标题用 `h2/h3`、段落用 `p`、按钮组用 `div/a`、图片用 `figure/img`、卡片组用 `article` 列表、两栏/三栏用 grid 容器、分隔线用 `hr`、区块用 `section`）。
   - 新增内容以 `label`、`note`、`globalNote` 为指导；不要留 Lorem ipsum；信息不足时写与站点语气一致的简短内容，并在最后说明假设。
   - 不改变文案、图片、链接和交互，除非备注明确要求。
8. 改 CSS：
   - 遵循页面现有 class/命名与变量；优先 flex/grid，不用绝对定位做结构。
   - 处理首屏留白、相邻间距、边框、分隔线、sticky header 等受顺序影响的样式。
   - 宽度提示映射到网格列跨度或 `max-width`，不要写死像素；移动端要能堆叠。
   - 对齐提示映射到 `justify-self`/`align-items`/`margin` 等。
   - 不留临时内联样式；不引入未使用的样式。
9. 共享样式：检查 `sharedClassWarnings`；如果修改的 class 在其他页面也在用，确认改动对它们同样成立，或把新样式限定在目标页面的作用域（新增 class/父选择器）。
10. 重新生成清单（新的 `sourceVersion`），把意图移动到 `.web-layout/history/`，在最终回复里用一句话说明改了哪些文件、关键调整和任何内容假设。
11. 预览确认：如果服务还在运行，告诉用户“预览已可重新加载查看”；用户确认后再停止服务，或交给空闲超时。若用户要求继续改，重新打开一轮。
12. 失败处理：任何一步无法安全完成（选择器找不到、目标容器不合法、改共享样式会破坏其他页面），停止并说明，不要静默近似；意图保留。多文件修改先规划再写；中途失败时明确列出已改文件，供下一轮核对。

### 10.3 红线

- 不直接相信清单的 `ref`：源码可能已漂移，用 `text`/`fingerprint` 交叉核对。
- 不把意图当操作日志逐条机械执行；以 `tree` 的最终结构为准，`changes` 用于理解差异。
- 不在用户拖拽期间同时改源码。
- 不修改 `.web-layout/` 之外的 sidecar 约定；不把意图或清单内容写进页面源码。
- 不引入框架、构建步骤或新依赖来实现布局。

## 11. Skill 包结构

```text
.claude/skills/web-layout/
├── SKILL.md
├── scripts/
│   └── server.mjs
├── editor/
│   ├── index.html
│   ├── editor.js
│   ├── editor.css
│   └── runtime.js
├── references/
│   ├── manifest-schema.md
│   ├── intent-schema.md
│   └── apply-playbook.md
└── tests/
    ├── fixtures/site/
    ├── server.test.mjs
    └── smoke.md
```

- `SKILL.md` frontmatter：
  ```yaml
  ---
  name: web-layout
  description: Use when the user wants to visually adjust the layout of a static HTML page or site by dragging modules, reordering or moving page blocks, adding or removing layout modules from a palette, or annotating per-module layout requirements. Triggers include 拖拽布局、模块化页面、调整模块顺序、visual layout editor.
  ---
  ```
- `SKILL.md` 正文包含：适用/不适用场景、10.1/10.2 工作流、命令、文件约定、红线、验收自检。
- `references/` 放 schema 与 playbook 的详细版本；`SKILL.md` 只保留流程和关键规则，避免膨胀。
- 安装：项目内 `.claude/skills/web-layout/`；需要跨项目使用时复制到 `~/.claude/skills/web-layout/`。
- 依赖：Node ≥ 20；零第三方 npm 依赖。
- 现有 `html-layout/client.js` 的 `previewRuntime` 可作为 runtime 的参考实现；DSH 的 sidebar/session/workspaceFiles 宿主代码不复用。

## 12. 错误处理

| 情况 | 行为 |
|---|---|
| root 不存在 / 不是目录 | 启动失败，打印用法 |
| page 不存在或不是 HTML | 编辑器显示页面选择器；API 返回 404 |
| 端口被占用 | 回退到系统分配端口并警告 |
| `server.json` 的 pid 存活 | 拒绝重复启动，打印已有 URL |
| 清单缺失 | 启发式树 + 横幅，允许提交但提示不稳定 |
| 清单 JSON 非法 | 同上，`manifestStatus: invalid` |
| 清单过期 / 选择器失效 | 横幅 + 禁止提交，提示重新生成 |
| 源码/样式在拖拽中变化 | 横幅 + 禁止提交，重新加载确认 |
| 未匹配模块 | 禁止提交，列出模块 |
| 非法拖拽（循环/叶节点） | 投放区不显示，松手无变化 |
| token / Origin 不匹配 | 403，JSON 错误 |
| 路径穿越 / 隐藏文件 | 404 |
| 请求体 / 文件过大 | 413 或明确错误页 |
| 意图校验失败 | 400 + 错误码 + 可读原因 |
| 磁盘写入失败 | 500，保留旧意图 |
| 浏览器打开失败 | 打印 URL，不阻塞 |
| 服务崩溃 | 编辑器显示“连接丢失”；意图只可能来自成功的原子写 |
| CSP / Service Worker 干扰 | 预览响应剥离 CSP、禁用 SW，横幅提示 |
| 页面导航到无清单的页 | 切换到该页，启发式模式 |

## 13. 验证与验收

### 13.1 单元测试（`node:test`）

- 路径解析：`..`、编码、反斜杠、符号链接逃逸、隐藏文件全部拒绝。
- token / Origin 校验：缺失、错误、正确三种情况。
- 版本计算：HTML 与关联 CSS/内联 style 变化时 `styleVersion` 改变。
- 清单校验：必填字段、role/layout 枚举、重复 id、深度上限。
- 意图校验：空改动、版本过期、重复 id、父节点非容器、环、新增缺失、大小上限。
- slug 生成：`index.html`、`about/team.html`、异常扩展名。

### 13.2 集成测试

- 用 `tests/fixtures/site` 启动服务（端口 0），`fetch` 编辑器、预览、API。
- 断言预览 HTML 包含 bootstrap 和 runtime 注入、页面 CSP 被移除、`frame-ancestors` 为编辑器 origin。
- 提交一份 fixture 意图，断言 `.web-layout/intent.json` 原子出现且内容正确。
- 断言 `../secret`、`.env`、`.git/config` 返回 404。
- 断言未带 token 的 `POST /api/intent` 返回 403。

### 13.3 浏览器冒烟（可选，Playwright 可用时）

- 打开编辑器 → 等待 runtime ready → 拖动 hero 到 features 后 → 新增标题模块 → 写备注 → 提交。
- 断言意图文件的 `changes` 与 `tree`。
- 截图保存到临时目录，不提交。

### 13.4 手工验收

1. 对 `demo/` 生成清单，启动编辑器，确认 6 个顶层模块（header、hero、features、pricing、faq、footer）和 hero 子模块可见。
2. 把 hero 拖到 features 后面；把 hero-art 拖进另一个容器；新增“客户证言”标题模块；写模块备注与全局要求。
3. 提交，确认意图文件；让 agent 应用，检查源码、CSS、预览。
4. 关闭编辑器重新打开，确认清单已更新、模块仍稳定。
5. 用一句“帮我把首页模块化拖一下”触发 skill；用一句“把标题字号改成 40px”确认不会误触发。
6. 在一个两页共享 `styles.css` 的 fixture 上修改共享 class，确认意图出现共享样式警告，agent 不误伤另一页。

## 14. 已知限制与非目标

### v1 不做

- React/Vue/需要构建的框架；只处理站点根目录内的静态文件。
- 自由几何定位（x/y/宽高）和绝对像素布局。
- 在预览里直接编辑文本内容；新增模块的文案由 agent 按备注生成。
- 多页面批量提交；一轮只提交当前页。
- 多用户并发、远程访问、托管服务。
- 撤销/重做历史；只有“重置全部”。
- 刷新后保留未提交拖拽/备注（内存状态，刷新即丢）。
- 完整的 HTML/CSS 校验；只做轻量检查（重复 id、本地链接/资源存在、选择器可解析）。
- 触屏优先的复杂手势；拖拽以鼠标/触控笔为主，模块面板提供点击插入作为兜底。

### 已知偏差

- 预览是真实站点 + 注入脚本，但不是真实用户环境：CSP 被剥离、SW 被禁用、页面可能因跨 origin 行为差异略有不同。
- 共享样式警告基于 `class` 正则扫描，可能漏掉动态拼接的 class。
- 清单由 agent 生成，复杂页面的模块边界仍可能需要人工“提升/降级”调整。
- 跨 origin iframe 无法可靠阻止页面脚本主动导航；脚本跳转前有未提交改动时，编辑器只能提示并允许返回。
- 页面脚本大规模重写 DOM 时，覆盖层和清单选择器可能失效；编辑器会提示 unresolved，需要重新生成清单。
- 页面脚本可以伪造布局消息；本地单用户工具接受这一边界。

## 15. 未来可扩展

- 多页面批量意图与站点级改版。
- 实时循环：agent 改完自动刷新预览，继续拖。
- 撤销/重做与草稿持久化。
- 模块面板的模板内容（带真实文案/图片占位）。
- 框架适配器（React/Vue 组件树映射）。
- 视觉回归截图对比。
- 与 Git 集成：应用前自动创建分支/提交。

## 16. Schema 演进

- 清单与意图都带 `schema` 字段，当前为 `1`。
- 读方忽略未知字段；新增字段不升版本。
- 破坏性变更升 `schema`；服务端拒绝不支持的版本并给出可读错误。
- 清单的 `generatedBy` 允许 `agent | editor | editor-heuristic`，用于排障，不参与布局判断。

## 17. 待审阅

请重点确认：

1. 双端口、token/Origin 隔离和 HTML 注入的边界是否可以接受。
2. 清单由 agent 预生成、运行时启发式兜底的模块模型是否符合预期。
3. 单页单次交接是否满足第一版；多页批量是否必须进 v1。
4. 意图里的 `tree` + `changes` + `modules` 三个部分是否足够表达你的布局需求。
5. `demo/` 作为手工验收站点是否合适。
