import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createPreviews, descendants, parseCwds, parseListeners } from '../lib/previews.mjs';

test('parseListeners reads pid, command and ports from lsof -F pcn', () => {
  assert.deepEqual(parseListeners('p10\ncnode\nn*:5173\nn[::1]:5173\np20\ncpython3\nn127.0.0.1:8000\n'), [
    { pid: 10, command: 'node', ports: new Set([5173]) },
    { pid: 20, command: 'python3', ports: new Set([8000]) },
  ]);
});

test('descendants walks the process tree', () => {
  assert.deepEqual(descendants('  1 0\n 100 1\n 101 100\n 102 101\n 200 1\n', 100), new Set([101, 102]));
});

test('parseCwds maps pid to working directory', () => {
  assert.deepEqual(parseCwds('p20\nfcwd\nn/home/me/playground/idea\n'), new Map([[20, '/home/me/playground/idea']]));
});

test('previews: ports from the session tree or its directory, never the excluded ones', async () => {
  const run = async (file, args) => {
    if (file === 'ps') return { stdout: '100 1\n101 100\n300 1\n400 1\n' };
    if (args.includes('-iTCP')) return { stdout: 'p101\ncnode\nn*:5173\np300\ncpython3\nn*:8000\np400\ncnode\nn*:3000\np500\ncnode\nn*:7777\n' };
    return { stdout: 'p300\nn/home/me/playground/idea\np400\nn/home/me/other\n' };
  };
  const previews = createPreviews({ run, excludePorts: [7777] });
  assert.deepEqual(await previews.list({ pid: 100, cwd: '/home/me/playground' }), [
    { port: 5173, command: 'node' },
    { port: 8000, command: 'python3' },
  ]);
});
