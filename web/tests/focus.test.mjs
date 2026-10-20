import test from 'node:test';
import assert from 'node:assert/strict';

import { createFocus, parseFocusStatus } from '../lib/focus.mjs';

test('parseFocusStatus reads every status line focus prints', () => {
  assert.deepEqual(parseFocusStatus('No active focus session.\n', 0), { active: false, remainingMs: 0, endsAt: null, apps: [], stale: false });
  assert.deepEqual(parseFocusStatus('Focus active: 42m 7s remaining (ends at 14:30:00).\nApps quit for this session: Slack, Spark\n', 1000), {
    active: true,
    remainingMs: (42 * 60 + 7) * 1000,
    endsAt: 1000 + (42 * 60 + 7) * 1000,
    apps: ['Slack', 'Spark'],
    stale: false,
  });
  assert.equal(parseFocusStatus('Focus session expired (watchdog should fire momentarily).').active, false);
  const stale = parseFocusStatus('Warning: session state exists but watchdog (pid 9) is not running.\nRun "focus stop" to clean up and restore apps.');
  assert.deepEqual([stale.active, stale.stale], [false, true]);
});

function fakeRun(state) {
  const calls = [];
  const run = async (bin, args) => {
    calls.push([bin, ...args]);
    if (state.missing) throw Object.assign(new Error('spawn focus ENOENT'), { code: 'ENOENT' });
    if (args[0] === 'start') state.on = true;
    if (args[0] === 'stop') state.on = false;
    const stdout = args[0] === 'status' ? (state.on ? 'Focus active: 59m 59s remaining (ends at 15:00:00).\n' : 'No active focus session.\n') : 'ok\n';
    return { stdout, stderr: '' };
  };
  return { calls, run };
}

test('start and stop run focus only when they change something, and answer the new status', async () => {
  const state = { on: false };
  const { calls, run } = fakeRun(state);
  const focus = createFocus({ run });
  assert.equal((await focus.start(25)).active, true);
  assert.deepEqual(calls.map((c) => c.slice(1).join(' ')), ['status', 'start 25', 'status']);
  calls.length = 0;
  assert.equal((await focus.start()).active, true);
  assert.deepEqual(calls.map((c) => c[1]), ['status']);
  calls.length = 0;
  assert.equal((await focus.stop()).active, false);
  assert.deepEqual(calls.map((c) => c[1]), ['status', 'stop', 'status']);
});

test('a missing focus binary is an error marked missing', async () => {
  const focus = createFocus({ run: fakeRun({ missing: true }).run });
  await assert.rejects(focus.status(), (e) => e.missing === true && /not found/.test(e.message));
});
