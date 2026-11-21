---
name: web-layout
description: Use when the user wants to visually adjust the layout of a static HTML page or site by dragging modules, reordering or moving page blocks, adding or removing layout modules from a palette, or annotating per-module layout requirements. Triggers include 拖拽布局、模块化页面、调整模块顺序、visual layout editor.
---

# Web Layout

Launch a local visual editor for a static site, capture the user's module arrangement and notes as an intent file, then apply that intent to the real HTML/CSS.

## When to use

- The user wants to drag, reorder, move, add, or remove page modules visually.
- The user wants to annotate per-module layout requirements.
- The user says 拖拽布局、模块化页面、调整模块顺序, or asks for a visual layout editor.

Do **not** use this skill for a text-described CSS tweak (for example “make the title 40px”). Edit the code directly in that case.

## Workflow

1. Confirm the site root and target page. If the user did not name a page, list the HTML files and ask.
2. Read the target HTML and its linked/inline CSS.
3. Write or update `.web-layout/pages/<slug>.json` with the module tree. Use semantic roles, stable selectors, containers, and layout hints. Keep at most 3 levels and 300 modules. If the manifest already exists and its `sourceVersion` does not match the current HTML, regenerate it first.
4. Start the server in the background:
   `node .claude/skills/web-layout/scripts/server.mjs --root <root> --page <page> --open`
   Read the JSON line it prints and give the user the `editorUrl`.
5. Tell the user: drag modules, add notes, click 完成, then return here and say it is done. **结束本轮**; do not edit source while the editor is open.
6. When the user returns, read `.web-layout/intent.json`. Verify `sourceVersion` and `styleVersion` against the current files.
7. Apply the intent to HTML/CSS using the rules in `references/apply-playbook.md`.
8. Re-generate the page manifest, move the intent to `.web-layout/history/YYYYMMDDTHHmmssZ-<slug>.json`, and summarize the changed files and assumptions.
9. Keep the server for visual confirmation, or stop it with `--stop` after the user confirms.

## Commands

```bash
node .claude/skills/web-layout/scripts/server.mjs --root <root> --page <page> --open
node .claude/skills/web-layout/scripts/server.mjs --root <root> --stop
```

## 文件约定

- `.web-layout/pages/<slug>.json` — module manifest cache; regenerate after every apply.
- `.web-layout/intent.json` — the pending intent written by the editor; fixed path.
- `.web-layout/server.json` — running server info written by the server.
- `.web-layout/history/YYYYMMDDTHHmmssZ-<slug>.json` — archived intents.
- `.web-layout/.gitignore` — contains `server.json`, `intent.json`, `history/`.

## Rules

- The editor never writes source; it writes only under `.web-layout/`.
- Never apply an intent whose versions do not match the files on disk.
- Treat `tree` as the final structure and `changes` as the explanation of what moved.
- Do not trust a manifest `ref` blindly; cross-check `text`/`fingerprint` against the source.
- Preserve content, links, images, and interactions unless a note explicitly asks for a change.
- Use flex/grid and existing classes; no absolute positioning for structure, no temporary inline styles.
- Check `context.sharedClassWarnings` before changing a shared stylesheet.
- If a change is impossible or would break another page, stop and explain; do not silently approximate.
- Do not add frameworks, build steps, or new dependencies to implement layout.

## 验收自检

Before reporting done:

- [ ] `sourceVersion` and `styleVersion` matched before apply; the manifest was regenerated afterward.
- [ ] The intent was moved to `.web-layout/history/YYYYMMDDTHHmmssZ-<slug>.json`, not left at `intent.json`.
- [ ] The preview reloads cleanly with the new structure.
- [ ] No temporary inline styles or absolute positioning for structure.
- [ ] `context.sharedClassWarnings` pages were checked for shared-class changes.
- [ ] Changed files and any content assumptions were reported.

## References

- `references/manifest-schema.md`
- `references/intent-schema.md`
- `references/apply-playbook.md`
