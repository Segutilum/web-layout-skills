# Manifest schema (schema 1)

The manifest is the module tree the editor renders over a page. It is a cache, **not the source of truth** — the HTML is always the source of truth. The agent writes it before opening the editor; the editor may rewrite it when the user promotes/demotes modules.

## Location and naming

- Path: `.web-layout/pages/<slug>.json` (relative to the site root passed as `--root`).
- `slug` = page path relative to the root, with `.html`/`.htm` removed and `/` replaced by `__`:
  - `index.html` → `index.json`
  - `about/team.html` → `about__team.json`
- `.web-layout/.gitignore` is created on first server start and contains exactly:
  ```gitignore
  server.json
  intent.json
  history/
  ```
  Files under `pages/` may be committed or ignored by the user. History filenames use `YYYYMMDDTHHmmssZ` (no colons, Windows-safe), e.g. `.web-layout/history/20261121T131000Z-index.json`.

## Structure

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

## Top-level fields

| Field | Required | Rule |
| --- | --- | --- |
| `schema` | yes | Must be `1`. |
| `page` | yes | Non-empty page path relative to the root; must match the page being edited (`loadManifest` rejects a mismatch as invalid). |
| `generatedBy` | recommended | `agent`, `editor`, or `editor-heuristic`. See [Editor writes](#editor-writes). |
| `generatedAt` | server-written | ISO-8601 timestamp. The server overwrites it on every save. |
| `sourceVersion` | yes | `sha256:<64 lowercase hex>` — SHA-256 of the target HTML file at generation/save time. |
| `stylesheets` | optional | Array of linked stylesheet paths relative to the root. |
| `modules` | yes | Array of module objects (see below). |

## Module fields

| Field | Type | Required | Rule |
| --- | --- | --- | --- |
| `id` | string | yes | Page-unique, stable, kebab-case. Regex `^[a-z0-9][a-z0-9-]*$`. Prefer source `data-module`, then element `id`, then `role + slug(tag/class/text prefix)`. Never use a volatile index as the sole id. |
| `role` | string | yes | One of the role enum below. Unknown roles use `block`. |
| `label` | string | yes | Human-readable short name, **≤ 40 characters**. |
| `ref` | string | yes | Non-empty selector for browser `querySelectorAll`. Allowed: tag, `#id`, `.class`, `[data-*]`, descendant/child combinators, `:nth-of-type()`. Avoid `:has()` and sibling-order-dependent `:nth-child()`. |
| `matchIndex` | integer | yes | Non-negative integer. When `ref` matches several elements, which one to use (`0` = first). |
| `tag` | string | yes | Non-empty lowercase tag name (`section`, `h1`, ...). |
| `classes` | string | yes | Full class attribute string, possibly empty. Used for shared-stylesheet warnings. |
| `text` | string | yes | Text preview with whitespace collapsed, **≤ 80 characters**. |
| `fingerprint` | string | yes | `tag|firstClass|first 40 chars of text`. The runtime uses it to detect that a selector still points at the intended element. |
| `container` | boolean | yes | `true` makes the module a valid drop target and allows `children`. |
| `layout` | string | yes | One of the layout enum below. `flow` is ordinary document flow and cannot receive cross-column drops. |
| `children` | array | optional | Only when `container` is `true`; a leaf with `children` is invalid. |

### Role enum

`header`, `nav`, `hero`, `section`, `article`, `aside`, `footer`, `form`, `cards`, `list`, `table`, `heading`, `paragraph`, `image`, `button`, `link`, `divider`, `container`, `block`

### Layout enum

`row`, `column`, `grid-2col`, `grid-3col`, `grid-4col`, `grid-auto`, `flow`

## Limits

- Maximum module depth: **3 levels** (top-level modules count as level 1).
- Maximum total modules per page: **300**. Above that the editor warns; the agent should aggregate or split the page first.
- `label` ≤ 40 characters, `text` ≤ 80 characters.
- No duplicate `id` anywhere in the tree.
- Top-level modules have the synthetic parent `__root__`; intents use `"parent": "__root__"` for page-level placement.

## Version semantics

- `sourceVersion` is the SHA-256 of the target HTML file, formatted `sha256:<hex>`.
- It records the moment the manifest was generated. It is not authoritative — the server recomputes it from disk.
- `loadManifest` returns `ok`, `missing` (no file), `invalid` (bad JSON, schema errors, or `page` mismatch), or `stale` (`sourceVersion` differs from the live HTML).
- After every apply, the agent must regenerate the manifest. Otherwise the editor detects the mismatch, enters stale/heuristic mode, and disables submit.
- `styleVersion` is **not** a manifest field; it belongs to the intent. See `intent-schema.md`.

## Generation rules

- The primary path is the agent reading HTML/CSS and writing the manifest: semantic roles, parseable selectors, container flags, and layout hints.
- Do not list every `div`; top-level modules are the semantic blocks of `main` or `body`, at most 3 levels deep.
- If the manifest exists but its `sourceVersion` does not match the current HTML, regenerate it.

## Editor writes

- The editor saves through `PUT /api/manifest`. The server merges: unknown fields on existing modules are preserved, and only the promoted/demoted modules and their parents' `children` are changed. The server recomputes and overwrites `sourceVersion` and `generatedAt`.
- `generatedBy` becomes `editor` after a normal promotion/demotion.
- If the editor falls back to a heuristic tree (manifest missing/invalid/stale) and the user then promotes/demotes, the saved manifest keeps `generatedBy: "editor-heuristic"`, and the intent's `context.manifestStatus` is reported as `heuristic`.
- **Treat any `generatedBy: "editor-heuristic"` manifest as heuristic, not authored.** Read the live HTML and rebuild/verify the module tree instead of trusting its selectors as if an agent wrote them.
- A stale manifest cannot be saved this way: the server rejects it with `E_STALE_SOURCE`.

## Editor heuristic fallback

When the manifest is missing, unparsable, or its selectors fail, the runtime generates a temporary tree and shows a banner. The heuristic picks `main` (else `body`), ignores `script/style/link/meta/template/noscript/br` and invisible elements, infers roles from tag/class/aria, marks flex/grid parents with two or more block children as containers, and maps flex direction / grid column count to `layout`. This tree is a starting point only — the agent must re-derive the real structure before applying an intent.
