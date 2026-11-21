# Apply playbook

This is the detailed version of steps 6–9 in `SKILL.md`: what to do after the user returns from the editor and `.web-layout/intent.json` exists.

Only run this after the user explicitly asked for visual dragging, page modularization, or per-module layout requirements. A text-described style tweak (“make the title 40px”) is edited directly in code without opening the editor.

## Launching and stopping the server

```bash
node .claude/skills/web-layout/scripts/server.mjs --root <root> --page <page> --open
node .claude/skills/web-layout/scripts/server.mjs --root <root> --stop
```

- It prints **one JSON line** with at least `editorUrl`, `previewUrl`, and `pid` (plus `root`, `page`, origins, tokens, and `startedAt`). Give the user `editorUrl`.
- It binds only `127.0.0.1`, on two separate origins (editor and preview). The editor token is carried in the URL **fragment** (`#token=...`), so it is not sent to servers in request lines.
- If a live server for the same root already exists, it prints the saved info with `reused: true` instead of starting a second one.
- `--stop` reads `.web-layout/server.json`, kills the pid, and removes the file. An idle server also shuts itself down after `--idle-minutes` (default 60).

## The 12-step apply flow

### 1. Read the intent

Read `.web-layout/intent.json`. If it does not exist, say there is no pending intent and stop.

### 2. Read the sources

Read the manifest, the target HTML, and its related CSS (`<link rel="stylesheet">` and inline `<style>`). If the manifest is missing or `context.manifestStatus !== "ok"` (including `heuristic`), first rebuild the manifest from the intent's `tree` and the current HTML, then continue.

### 3. Check versions

Recompute `sourceVersion` (SHA-256 of the HTML) and `styleVersion` (sorted stylesheet hashes plus inline styles) and compare them with the intent. On any mismatch, **stop** and ask the user to reopen the editor. Never apply a stale intent.

### 4. Locate modules

`querySelector` does not exist in Node. Find each element in the source by its `ref` (id/class/tag/combinator), cross-checking `text` and `fingerprint` when a selector is ambiguous. Do not hard-code line numbers.

### 5. List the plan

Before editing, state what will happen: moves, additions, removals, and the CSS adjustments implied by each note and width/align hint. Do this even if the plan is short.

### 6. Check for illegal changes

Look for cycles, leaf nodes used as containers, and ids/anchors still referenced after a removal. If any apply, stop and explain instead of approximating.

### 7. Edit the HTML

- **Move:** preserve the whole element and its content; when moving across containers, insert it at the correct position in the target container.
- **Remove:** delete only the target module. If that leaves an empty container, clean it up only when semantically sensible; never do unrelated refactoring.
- **Add:** generate a semantic element from `type`:
  | type | Element |
  | --- | --- |
  | `heading` | `h2` / `h3` |
  | `paragraph` | `p` |
  | `buttons` | `div` containing `a` |
  | `image` | `figure` / `img` |
  | `cards` | `article` list |
  | `columns-2` / `columns-3` | grid container with that many columns |
  | `divider` | `hr` |
  | `section` | `section` |
- Use `label`, `note`, and `globalNote` as the content brief. Never leave Lorem ipsum. If information is insufficient, write short copy in the site's voice and list the assumption in the final summary.
- Do not change copy, images, links, or interactions unless a note explicitly asks.

### 8. Edit the CSS

- Follow the page's existing classes/naming and variables; prefer flex/grid. No absolute positioning for structure.
- Adjust styles that depend on order: first-screen spacing, adjacent margins, borders, dividers, sticky headers.
- Map width hints to grid column spans or `max-width`, never fixed pixels; mobile must stack.
- Map align hints to `justify-self` / `align-items` / margins.
- No temporary inline styles; no unused rules.

### 9. Shared styles

Check `context.sharedClassWarnings`. If a modified class is also used on other pages, either confirm the change is correct there too or scope the new rule to this page (new class or a parent selector). `pages` names the other pages sharing the class token.

### 10. Regenerate and archive

Regenerate the manifest with the new `sourceVersion`, move the intent to `.web-layout/history/YYYYMMDDTHHmmssZ-<slug>.json`, and summarize in one line which files changed, the key adjustments, and any content assumptions.

### 11. Verify visually

If the server is still running, tell the user the preview can be reloaded. Stop the server with `--stop` only after the user confirms, or let it hit the idle timeout. If the user wants more changes, open another editor round.

### 12. Failure protocol

If any step cannot be completed safely — selector not found, illegal target container, a shared-style change that would break another page, a version mismatch, or a write failure — **stop and explain; do not silently approximate.** Keep the intent unarchived so the next round can reconcile it. For multi-file edits, plan before writing; if you fail midway, list exactly which files were already changed.

## Red lines

- Do not trust the manifest's `ref` blindly: the source may have drifted. Cross-check with `text`/`fingerprint`.
- Do not execute the intent as an operation log. `tree` is the final structure; `changes` only explains the difference.
- Do not edit source while the user is dragging.
- Do not invent sidecar conventions outside `.web-layout/`; never write intent or manifest content into page source.
- Do not add frameworks, build steps, or new dependencies to achieve a layout.

## Width and align mapping

The intent's width/align values are hints; the implementation decides the CSS.

| Hint | Suggested CSS |
| --- | --- |
| `width: full` | `grid-column: 1 / -1` or `flex: 1 1 100%`; `width: 100%` |
| `width: half` | `grid-column: span 2` in a 4-col grid, or `flex-basis: 50%` in a 2-up row |
| `width: third` | `grid-column: span 1` in a 3-col grid, or `max-width: 33.333%` in a flex row |
| `width: two-thirds` | `grid-column: span 2` in a 3-col grid, or `max-width: 66.666%` |
| `width: auto` | content-sized; no override |
| `align: start` | `justify-self: start` / `align-items: flex-start` |
| `align: center` | `justify-self: center` / `align-items: center` |
| `align: end` | `justify-self: end` / `align-items: flex-end` |
| `align: stretch` | default; no override |

Enablement depends on the parent layout: `row` and `grid-*` allow both width and align; `column` allows align only; `flow` and the root allow neither. Always add a mobile rule that stacks (`grid-template-columns: 1fr` / `flex-wrap: wrap`).

## Content rules for added modules

- The `label` names the module; the `note` and `globalNote` describe what it should contain.
- Choose a heading level that fits the page outline; do not skip levels for visual size.
- Cards: use a repeated `article` (or equivalent) with one item per card, under the note's description.
- Columns: `columns-2` / `columns-3` are layouts, not content; fill each column with the described modules.
- Dividers and sections should reflect real grouping, not decorative noise.
- Keep copy brief and consistent with the site's existing voice. Record assumptions in the final reply.
- If a note is contradictory or impossible, stop and ask; do not guess.
