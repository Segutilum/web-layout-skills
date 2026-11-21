# Intent schema (schema 1)

The intent is what the editor hands back to the agent: the final module tree plus the user's notes. The agent applies it to the real HTML/CSS, then archives it.

## Location and writing

- Fixed path: `.web-layout/intent.json`. The agent must never look for another name.
- The server writes it atomically on `POST /api/intent`: write a temp file, then `rename`.
- At most one pending intent per workspace. Another submit replaces the previous file (the editor blocks re-submit while in the submitted state until the user chooses “继续编辑”).
- On success, the agent moves it to `.web-layout/history/YYYYMMDDTHHmmssZ-<slug>.json`. The timestamp has no colons (Windows-safe), and `<slug>` is the manifest slug. On failure or interruption, leave `intent.json` in place — do not archive it.
- Unknown fields are ignored by both the server and the agent (forward compatibility for schema 1).

## Structure

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

## Top-level fields

| Field | Rule |
| --- | --- |
| `schema` | Must be `1`. |
| `kind` | Must be `"web-layout-intent"`. |
| `page` | Must equal the manifest's `page`; otherwise `E_PAGE_MISMATCH`. |
| `submittedAt` | ISO-8601; the server fills it if absent. |
| `sourceVersion` | Must equal the server's current HTML hash; otherwise `E_STALE_SOURCE`. |
| `styleVersion` | Must equal the server's current stylesheet hash; otherwise `E_STALE_STYLE`. |
| `globalNote` | Optional page-wide note, **≤ 8000 characters**. |
| `changes` | Object with `moved`, `added`, `removed` arrays (all optional; each defaults to empty). |
| `modules` | Array of existing-module notes and width/align hints. |
| `tree` | Array containing exactly one root node, `{ "id": "__root__", "children": [...] }`. |
| `context` | Server-computed context (see below). |

## `changes`

- `changes.moved` records modules the user **explicitly dragged**, one entry per module, not every sibling whose index shifted because of an insertion. `from` may be omitted; `to` (`{parent, index}`) is required. Final order comes from `tree`.
- `changes.added` contains only metadata and the drop location: `id`, `type`, `label`, `note`, `parent`, `index`, and optionally `width`/`align`. Final nesting comes from `tree` (an added container can have children there).
- `type` must be one of the palette types: `heading`, `paragraph`, `buttons`, `image`, `cards`, `columns-2`, `columns-3`, `divider`, `section`. `columns-2`, `columns-3`, and `section` are containers.
- Added ids must not collide with existing manifest ids or with each other.
- `changes.removed` modules must not appear in `tree`. Remove only the target module; clean up a container left empty only when it makes semantic sense.

## `modules[]`

- Contains **only existing modules that have a note, a width hint, or an align hint**. Structural information for every other module lives in `tree` and the manifest.
- A width/align-only entry (no note) is a real change: an intent whose only effect is width/align hints is valid and is **not** `E_EMPTY_CHANGES`.
- Each entry is `{id, ref, note?, width?, align?}`. `ref` is copied from the manifest to help the agent locate the element.
- `note` ≤ **4000 characters** per module.
- `width` enum: `auto`, `full`, `half`, `third`, `two-thirds`.
- `align` enum: `start`, `center`, `end`, `stretch`.
- Width/align are layout hints, not pixels. They only make sense when the parent layout enables them: parent `row`/`grid-*` allows both; parent `column` allows align only; parent `flow` or `__root__` allows neither.
- Added-module hints live in `changes.added[].width` / `.align`, not in `modules[]`.

## `tree`

Each node carries **only** `{id, children?}`. The editor's runtime `layout` field is wire data and is stripped before submission; do not expect it.

Expansion rules:

- `tree` is an array with exactly one root node `__root__`; `__root__.children` always lists every top-level module that was not removed.
- **Omit `children`** to say “this subtree is unchanged — reuse the manifest.” Descendants of an unexpanded node are not treated as removed.
- **List `children`** to say “this is the complete list for this level.” Once listed, every child that exists after the edit (moved in, added, or kept) must appear; a node omitted from a listed `children` is treated as removed.
- The ancestor chain of any moved, added, or removed module must be expanded down to that module.
- Every added module appears in `tree` and corresponds one-to-one with `changes.added`; removed modules must not appear.
- No duplicate ids; every parent must be a container or `__root__`; no cycles.

## Limits

- Per-module note: ≤ 4000 characters.
- Global note: ≤ 8000 characters.
- Serialized intent: ≤ 2 MiB.

## Validation error codes

| Code | Meaning |
| --- | --- |
| `E_EMPTY_CHANGES` | No move/add/remove, no note, no width/align hint, no global note. |
| `E_STALE_SOURCE` | `sourceVersion` does not match the current HTML. |
| `E_STALE_STYLE` | `styleVersion` does not match the current stylesheets. |
| `E_UNRESOLVED` | A manifest module could not be matched in the live DOM. The editor blocks submit before producing an intent; the agent must regenerate the manifest. |
| `E_TREE_INVALID` | Duplicate ids, non-container parent, cycle, missing/extra tree module, malformed added entry, unknown width/align enum, or an over-long note. |
| `E_PAGE_MISMATCH` | Intent page differs from the manifest/current page. |
| `E_TOO_LARGE` | The intent exceeds the size limit. |
| `E_WRITE_FAILED` | The server could not write the intent to disk. |
| `E_MANIFEST` | At submit time the manifest is missing or invalid; the server cannot resolve modules without it. |

Additional server-side guards: a stale manifest at submit is `E_STALE_SOURCE`, and a non-`ok`/`heuristic` manifest state cannot be resolved. If `context.manifestStatus` is not `ok`, read the manifest the editor persisted, then rebuild/verify it from the intent's `tree` and the current HTML before applying.

## `context`

Server-computed on submit; the agent reads it but does not author it.

- `manifestStatus`: `ok`, `missing`, `invalid`, or `heuristic`. `heuristic` means the manifest was generated by the editor's fallback (`generatedBy: "editor-heuristic"`) — rebuild it from the real HTML.
- `stylesheets`: linked stylesheet paths relative to the root.
- `sharedClassWarnings`: array of `{class, pages}`, at most **50** entries. It names the other pages that use the same class token, computed from the class strings of moved/removed modules, added modules' parents, and modules with notes or width/align hints. Before editing a shared class, confirm the change also holds for those pages or scope the new rule to this page.

## Version checks

The server is authoritative for `sourceVersion` and `styleVersion`:

- `sourceVersion` = SHA-256 of the target HTML file, `sha256:<hex>`.
- `styleVersion` = SHA-256 over the sorted `path + ":" + sha256(file)` lines of all linked stylesheets plus `inline:<hash>` for inline `<style>` text; missing stylesheets are recorded as `missing:<path>` and are not fatal.

The editor records the versions at load and the server recomputes them at submit. The agent re-computes both before applying; on any mismatch, stop and ask the user to reopen the editor. Never apply an intent whose versions do not match the files on disk.
