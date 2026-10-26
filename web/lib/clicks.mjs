// Usage log: which buttons and shortcuts get used, one JSON line per event, kept on this machine
// only — the input for redesigning the UI around what is actually used.
import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from './http.mjs';

const MAX_BATCH = 500;
const KINDS = new Set(['click', 'key']);
const clip = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');

/** A batch from the UI → clean events; drops anything malformed rather than failing the batch. */
export function cleanEvents(body) {
  const list = Array.isArray(body?.events) ? body.events : null;
  if (!list) throw new HttpError('events must be an array', 400);
  if (list.length > MAX_BATCH) throw new HttpError(`at most ${MAX_BATCH} events per batch`, 400);
  return list
    .filter((e) => e && KINDS.has(e.kind) && Number.isFinite(e.t) && clip(e.label, 80))
    .map((e) => ({ t: Math.round(e.t), kind: e.kind, label: clip(e.label, 80), area: clip(e.area, 40), screen: clip(e.screen, 40) }));
}

/** Events → counts per `kind · area · label`, most used first, with the first and last day seen. */
export function summarize(events) {
  const counts = new Map();
  for (const e of events) {
    const key = `${e.kind} · ${e.area || '-'} · ${e.label}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const days = (t) => (t ? new Date(t).toISOString().slice(0, 10) : null);
  return {
    total: events.length,
    from: days(events[0]?.t),
    to: days(events.at(-1)?.t),
    top: [...counts].sort((a, b) => b[1] - a[1]).map(([what, count]) => ({ what, count })),
  };
}

export function createClickLog({ file }) {
  return {
    async append(body) {
      const events = cleanEvents(body);
      if (events.length) {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.appendFile(file, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
      }
      return { saved: events.length };
    },
    async summary() {
      const raw = await fs.readFile(file, 'utf8').catch((err) => (err.code === 'ENOENT' ? '' : Promise.reject(err)));
      const events = raw.split('\n').flatMap((l) => {
        try {
          return l ? [JSON.parse(l)] : [];
        } catch {
          return [];
        }
      });
      return summarize(events);
    },
  };
}
