import path from 'node:path';
import fs from 'node:fs/promises';

export function layoutDir(root) {
  return path.join(root, '.web-layout');
}

export function pagesDir(root) {
  return path.join(layoutDir(root), 'pages');
}

export async function ensureLayoutDir(root) {
  await fs.mkdir(pagesDir(root), { recursive: true });
  const ignore = path.join(layoutDir(root), '.gitignore');
  try {
    await fs.access(ignore);
  } catch {
    await fs.writeFile(ignore, 'server.json\nintent.json\nhistory/\n');
  }
}

export async function writeJsonAtomic(absPath, value) {
  const dir = path.dirname(absPath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, '.' + path.basename(absPath) + '.' + process.pid + '.tmp');
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + '\n');
  await fs.rename(tmp, absPath);
}
