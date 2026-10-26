import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cleanEvents, createClickLog, summarize } from '../lib/clicks.mjs';

test('cleanEvents keeps well-formed events and clips their fields', () => {
  const out = cleanEvents({
    events: [
      { t: 1.4, kind: 'click', label: '  Review \n PR ', area: 'header', screen: 'session', extra: 1 },
      { t: 2, kind: 'scroll', label: 'x' },
      { t: 'now', kind: 'key', label: 'new' },
      { t: 3, kind: 'key', label: '' },
    ],
  });
  assert.deepEqual(out, [{ t: 1, kind: 'click', label: 'Review PR', area: 'header', screen: 'session' }]);
  assert.throws(() => cleanEvents({}), /events must be an array/);
  assert.throws(() => cleanEvents({ events: new Array(501).fill({}) }), /at most 500/);
});

test('summarize counts per kind, area and label, most used first', () => {
  const day = Date.UTC(2026, 9, 25);
  const s = summarize([
    { t: day, kind: 'click', area: 'rail', label: 'Usage' },
    { t: day, kind: 'key', area: '', label: 'new' },
    { t: day + 86400000, kind: 'key', area: '', label: 'new' },
  ]);
  assert.deepEqual(s, { total: 3, from: '2026-10-25', to: '2026-10-26', top: [{ what: 'key · - · new', count: 2 }, { what: 'click · rail · Usage', count: 1 }] });
});

test('createClickLog appends JSON lines and summarises them', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fleet-clicks-'));
  const log = createClickLog({ file: path.join(dir, 'state', 'clicks.jsonl') });
  assert.deepEqual(await log.summary(), { total: 0, from: null, to: null, top: [] });
  assert.deepEqual(await log.append({ events: [{ t: 1, kind: 'click', label: 'Stop' }] }), { saved: 1 });
  assert.deepEqual(await log.append({ events: [] }), { saved: 0 });
  assert.equal((await log.summary()).top[0].what, 'click · - · Stop');
  await fs.rm(dir, { recursive: true });
});
