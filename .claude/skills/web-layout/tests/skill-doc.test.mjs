import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('SKILL.md has frontmatter, triggers, and the workflow contract', async () => {
  const text = await fs.readFile('.claude/skills/web-layout/SKILL.md', 'utf8');
  assert.match(text, /^---\nname: web-layout\n/m);
  assert.match(text, /description: Use when/);
  assert.match(text, /拖拽布局/);
  assert.match(text, /模块化页面/);
  assert.match(text, /调整模块顺序/);
  assert.match(text, /visual layout editor/);
  assert.match(text, /server\.mjs/);
  assert.match(text, /\.web-layout\/intent\.json/);
  assert.match(text, /结束本轮/);
  assert.match(text, /sourceVersion/);
  assert.match(text, /regenerate it first/);
  assert.match(text, /fingerprint/);
  assert.match(text, /## 文件约定/);
  assert.match(text, /\.web-layout\/server\.json/);
  assert.match(text, /server\.json`, `intent\.json`, `history\//);
  assert.match(text, /## 验收自检/);
});
