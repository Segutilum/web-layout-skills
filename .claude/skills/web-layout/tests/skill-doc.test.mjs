import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('SKILL.md has frontmatter, triggers, and the workflow contract', async () => {
  const text = await fs.readFile('.claude/skills/web-layout/SKILL.md', 'utf8');
  assert.match(text, /^---\nname: web-layout\n/m);
  assert.match(text, /description: Use when/);
  assert.match(text, /拖拽布局/);
  assert.match(text, /server\.mjs/);
  assert.match(text, /\.web-layout\/intent\.json/);
  assert.match(text, /结束本轮/);
  assert.match(text, /sourceVersion/);
});
