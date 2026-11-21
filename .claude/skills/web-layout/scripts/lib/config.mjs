import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { parseArgs as nodeParseArgs } from 'node:util';
import { layoutDir, ensureLayoutDir } from './layout-dir.mjs';

function usage(message) {
  return Object.assign(new Error(message), { code: 'E_USAGE' });
}

export function parseArgs(argv) {
  const { values } = nodeParseArgs({
    args: argv,
    options: {
      root: { type: 'string' },
      page: { type: 'string' },
      'editor-port': { type: 'string' },
      'preview-port': { type: 'string' },
      'idle-minutes': { type: 'string' },
      open: { type: 'boolean' },
      stop: { type: 'boolean' },
    },
    strict: true,
  });
  if (!values.root) throw usage('--root is required');
  const parsePort = (value, name) => {
    if (value === undefined) return 0;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 65535) throw usage(name + ' must be a port');
    return n;
  };
  const idle = values['idle-minutes'] === undefined ? 60 : Number(values['idle-minutes']);
  if (!Number.isFinite(idle) || idle < 0) throw usage('--idle-minutes must be >= 0');
  return {
    root: path.resolve(values.root),
    page: values.page || '',
    editorPort: parsePort(values['editor-port'], '--editor-port'),
    previewPort: parsePort(values['preview-port'], '--preview-port'),
    idleMinutes: idle,
    open: values.open === true,
    stop: values.stop === true,
  };
}

export function createConfig(parsed) {
  return {
    ...parsed,
    editorToken: crypto.randomBytes(32).toString('hex'),
    runtimeToken: crypto.randomBytes(32).toString('hex'),
    idleMs: parsed.idleMinutes * 60 * 1000,
    serverJsonPath: path.join(layoutDir(parsed.root), 'server.json'),
  };
}

export async function readServerJson(root) {
  try {
    return JSON.parse(await fs.readFile(path.join(layoutDir(root), 'server.json'), 'utf8'));
  } catch {
    return null;
  }
}

export async function writeServerJson(root, data) {
  await ensureLayoutDir(root);
  const file = path.join(layoutDir(root), 'server.json');
  const tmp = file + '.' + process.pid + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n');
  await fs.rename(tmp, file);
}

export async function clearServerJson(root) {
  await fs.rm(path.join(layoutDir(root), 'server.json'), { force: true });
}

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
