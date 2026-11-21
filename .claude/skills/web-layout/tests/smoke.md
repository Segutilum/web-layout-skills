# Web Layout Smoke Test

Use a copy of `demo/`; do not modify the original.

Prerequisite: generate the page manifest first (SKILL workflow step 3). Steps 5 and 8 assume `hero` is a container and has a `hero-title` child. Without a manifest the editor falls back to heuristics, where the top-level sections are leaves, so 提升为模块 only works inside a palette-added container.

1. Start: `node .claude/skills/web-layout/scripts/server.mjs --root <copy> --page index.html --open`
2. Editor opens; six top-level modules appear: header, hero, features, pricing, faq, footer.
3. Drag hero below features; the preview reorders; summary shows a move.
4. Drag hero back; order returns; summary still reports the explicit moves.
5. Select hero; add note “留白收紧”; select hero-title; set align.
6. Add a heading module “客户证言” under hero; add a note.
7. Type global note “整体更紧凑”.
8. Alt+click a heading inside `hero` that is not itself a module yet (the `h2` if present, otherwise the `h1`) to get the promote button; click 提升为模块. Confirm the heading gets its own drag handle and `<copy>/.web-layout/pages/index.json` (the slug of `index.html`) gains the promoted module under `hero`.
9. Select the promoted module and click 降级为子元素. Confirm it disappears from the preview (no handle), the manifest no longer contains it, and the overlay returns to the `hero` boundary.
10. Palette-drop a 两栏 (columns-2) module into `features`, then drag a manifest module (for example `pricing`) into that new columns container. Confirm width/align controls appear for the child (its parent layout is `grid-2col`).
11. Click 完成; the banner names `.web-layout/intent.json` (appending 共享样式 warnings if any). Confirm palette items, module/global notes, width/align selects, dragging, and Delete are locked. Click 继续编辑 and confirm; all of them unlock.
12. In Claude Code, apply the intent on the copy; verify the HTML/CSS and preview.
13. Reload the editor; the manifest is fresh and modules still resolve (no 清单未匹配 banner).
14. Confirm the page picker lists every HTML file in the copy (the shared-style warning itself is covered by `tests/intent.test.mjs` and `tests/workspace.test.mjs`).
15. Stop: `node .claude/skills/web-layout/scripts/server.mjs --root <copy> --stop`
