// Voice memos: record a conversation on the phone, get a titled transcript saved as markdown.
//
// The UI records in segments (a few minutes each) and uploads every one as soon as it is cut, so a
// long conversation has no size or duration limit and stopping finishes quickly. Each segment's
// audio is stored first (`audioDir/<recording>/<n>.<ext>`), then transcribed (`<n>.txt` next to
// it) — a failed transcription keeps the audio for a retry. `finish` joins the transcripts, asks
// Claude for a title and writes `dir/<date>-<slug>.md`; calling it again updates that file.
//
// The markdown dir can be a folder in a notes repo (`web.memos.dir`); the audio never goes there.
import fsp from 'node:fs/promises';
import path from 'node:path';

import { HttpError } from './http.mjs';
import { MEMO_PROMPT, TRANSCRIBE_MAX_BYTES, audioExt, audioType, buildPrompt, readAudio } from './transcribe.mjs';

export const RECORDING_ID_RE = /^[a-z0-9][a-z0-9-]{7,63}$/;
export const MEMO_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
const MAX_SEGMENTS = 500;
const TITLE_MAX = 100;
const PREVIEW_CHARS = 160;
// The transcript fed to the title model.
const TITLE_INPUT_CHARS = 12000;
// The vocabulary appended to the transcription prompt (web.memos.vocabulary).
const VOCABULARY_MAX = 1500;
// The previous segment's tail, as context for the next one (words cut at the boundary).
const CONTEXT_CHARS = 200;

export function validRecordingId(id) {
  return typeof id === 'string' && RECORDING_ID_RE.test(id);
}

export function validMemoId(id) {
  return typeof id === 'string' && MEMO_ID_RE.test(id) && !id.includes('..');
}

/** `Kickoff s Markom: API v2!` → `kickoff-s-markom-api-v2` (ASCII, ≤ 60 chars). */
export function slugify(title) {
  const ascii = String(title ?? '')
    .replace(/[đĐ]/g, 'd')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
  return ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

/** Local `YYYY-MM-DD`, `HH:MM` and an ISO string with the offset. */
export function localStamp(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const time = `${p(d.getHours())}:${p(d.getMinutes())}`;
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const iso = `${date}T${time}:${p(d.getSeconds())}${sign}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
  return { date, time, iso };
}

/** `m:ss` / `h:mm:ss` */
export function clock(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** The model's answer → one clean title line, or ''. */
export function cleanTitle(raw) {
  const line = String(raw ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return '';
  return line
    .replace(/^(title|naslov)\s*:\s*/i, '')
    .replace(/^#+\s*/, '')
    .replace(/^["'„“”*_`]+|["'„“”*_`.]+$/g, '')
    .trim()
    .slice(0, TITLE_MAX);
}

/** The transcription prompt's base: MEMO_PROMPT + `Pojmovi: a, b, c.` (capped). */
export function memoPrompt(vocabulary = []) {
  const terms = [];
  let len = 0;
  for (const t of vocabulary) {
    const term = String(t ?? '').replace(/\s+/g, ' ').trim();
    if (!term || len + term.length + 2 > VOCABULARY_MAX) continue;
    terms.push(term);
    len += term.length + 2;
  }
  return terms.length ? `${MEMO_PROMPT} Pojmovi: ${terms.join(', ')}.` : MEMO_PROMPT;
}

export function titlePrompt(transcript) {
  return [
    'Below is the transcript of a recorded conversation (a voice memo).',
    'Write a short, specific title for it: at most 8 words, in the language the conversation is mostly in, naming what it is about (people, project, decision).',
    'Reply with the title only — no quotes, no punctuation at the end.',
    '',
    '<transcript>',
    transcript.slice(0, TITLE_INPUT_CHARS),
    '</transcript>',
  ].join('\n');
}

/** Frontmatter (our flat `key: value` lines; `title` is a JSON string, valid YAML) + body. */
export function parseMemo(text) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if (value.startsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        value = value.replace(/^"|"$/g, '');
      }
    }
    meta[key] = value;
  }
  return { meta, body: text.slice(m[0].length) };
}

export function formatMemo({ title, created, durationSec, recording, status }, body) {
  return [
    '---',
    `title: ${JSON.stringify(title)}`,
    `created: ${created}`,
    `duration: "${clock(durationSec)}"`,
    `recording: ${recording}`,
    `status: ${status}`,
    '---',
    '',
    body.trim(),
    '',
  ].join('\n');
}

/** Rewrite one frontmatter key, keeping the rest of the file (the body may have been edited). */
export function setMetaLine(text, key, rawValue) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!m) return text;
  const lines = m[1].split('\n');
  const i = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (i >= 0) lines[i] = `${key}: ${rawValue}`;
  else lines.push(`${key}: ${rawValue}`);
  return `---\n${lines.join('\n')}\n---${text.slice(m[0].length)}`;
}

const durationOf = (meta) => {
  const parts = String(meta.duration ?? '').split(':').map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
};

function summarize(id, meta, body) {
  const text = body.replace(/^> ⚠.*$/gm, '').replace(/\s+/g, ' ').trim();
  return {
    id,
    title: String(meta.title || id),
    created: meta.created ?? null,
    durationSec: durationOf(meta),
    recording: meta.recording ?? null,
    status: meta.status === 'partial' ? 'partial' : 'done',
    words: text ? text.split(' ').length : 0,
    preview: text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS).replace(/\s+\S*$/, '')}…` : text,
  };
}

async function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, file);
}

const readOr = (file, fallback = null) => fsp.readFile(file, 'utf8').catch(() => fallback);

/**
 * @param {object} opts
 *   dir          markdown dir (created on first save)
 *   audioDir     segment audio + per-segment transcripts
 *   transcriber  lib/transcribe.mjs createTranscriber (transcribeAudio)
 *   ask          ({ prompt, model }) => Promise<string> — briefs.mjs createClaudeAsk; absent → a date title
 *   model        title model
 *   vocabulary   names and terms the transcriber should expect (people, projects, tools)
 */
export function createMemos({ dir, audioDir, transcriber, ask = null, model = 'haiku', vocabulary = [], now = Date.now, log = () => {} }) {
  if (!dir || !audioDir) throw new TypeError('dir and audioDir are required');
  const basePrompt = memoPrompt(vocabulary);
  // One finish/retry per recording at a time.
  const locks = new Map();
  const locked = (key, fn) => {
    const prev = locks.get(key) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    locks.set(key, next);
    next.finally(() => locks.get(key) === next && locks.delete(key)).catch(() => {});
    return next;
  };

  const recDir = (rec) => path.join(audioDir, rec);
  const memoFile = (id) => path.join(dir, `${id}.md`);

  async function readMeta(rec) {
    const raw = await readOr(path.join(recDir(rec), 'meta.json'));
    try {
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }
  const writeMeta = (rec, meta) => writeAtomic(path.join(recDir(rec), 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);

  /** Segment index → audio file name, for the segments stored so far. */
  async function segmentFiles(rec) {
    const names = await fsp.readdir(recDir(rec)).catch(() => []);
    const out = new Map();
    for (const name of names) {
      const m = /^(\d{3})\.(webm|ogg|m4a|mp3|wav)$/.exec(name);
      if (m) out.set(Number(m[1]), name);
    }
    return out;
  }

  const TYPE_OF = { webm: 'audio/webm', ogg: 'audio/ogg', m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav' };

  async function transcribeSegment(rec, n, file, context = '') {
    const audio = await fsp.readFile(path.join(recDir(rec), file));
    const ext = path.extname(file).slice(1);
    const { text } = await transcriber.transcribeAudio(audio, TYPE_OF[ext], buildPrompt(context, basePrompt));
    await writeAtomic(path.join(recDir(rec), `${pad(n)}.txt`), `${text}\n`);
    return text;
  }

  /** PUT …/recordings/:rec/segments/:n — store the audio, then try to transcribe it. */
  async function putSegment(rec, n, req) {
    if (!validRecordingId(rec)) throw new HttpError('invalid recording id', 400);
    if (!Number.isInteger(n) || n < 0 || n >= MAX_SEGMENTS) throw new HttpError('invalid segment number', 400);
    const type = audioType(req.headers?.['content-type']);
    if (!type) throw new HttpError('expected an audio body (webm, ogg, mp4, mp3 or wav)', 415);
    const audio = await readAudio(req, TRANSCRIBE_MAX_BYTES);
    if (!audio.length) throw new HttpError('empty segment', 400);
    await fsp.mkdir(recDir(rec), { recursive: true });
    for (const [i, old] of await segmentFiles(rec)) if (i === n) await fsp.rm(path.join(recDir(rec), old), { force: true });
    const file = `${pad(n)}.${audioExt(type)}`;
    await writeAtomic(path.join(recDir(rec), file), audio);
    await fsp.rm(path.join(recDir(rec), `${pad(n)}.txt`), { force: true });
    const meta = await readMeta(rec);
    if (!meta.firstSegmentAt) await writeMeta(rec, { ...meta, firstSegmentAt: now() });
    const prev = n > 0 ? await readOr(path.join(recDir(rec), `${pad(n - 1)}.txt`), '') : '';
    try {
      const text = await transcribeSegment(rec, n, file, prev.trim().slice(-CONTEXT_CHARS));
      return { stored: true, transcribed: true, chars: text.length };
    } catch (err) {
      log(`memos: ${rec} segment ${n}: ${err?.message ?? err}`);
      return { stored: true, transcribed: false, error: String(err?.message ?? err) };
    }
  }

  /** Transcribe what is missing, join → { body, failed }. */
  async function assemble(rec, count) {
    const files = await segmentFiles(rec);
    const parts = [];
    let failed = 0;
    let prev = '';
    for (let n = 0; n < count; n++) {
      const file = files.get(n);
      if (!file) throw new HttpError(`segment ${n} was never uploaded`, 409);
      let text = await readOr(path.join(recDir(rec), `${pad(n)}.txt`));
      if (text == null) {
        try {
          text = await transcribeSegment(rec, n, file, prev.slice(-CONTEXT_CHARS));
        } catch (err) {
          log(`memos: ${rec} segment ${n}: ${err?.message ?? err}`);
          failed++;
          parts.push(`> ⚠ Segment ${n + 1} of ${count} is not transcribed yet: ${String(err?.message ?? err).split('\n')[0]}`);
          prev = '';
          continue;
        }
      }
      text = text.trim();
      if (text) parts.push(text);
      prev = text;
    }
    return { body: parts.join('\n\n'), failed };
  }

  async function makeTitle(body, created) {
    const fallback = `Memo ${created.date} ${created.time}`;
    const transcript = body.replace(/^> ⚠.*$/gm, '').trim();
    if (!ask || !transcript) return { title: fallback, generated: false };
    try {
      const title = cleanTitle(await ask({ prompt: titlePrompt(transcript), model }));
      return title ? { title, generated: true } : { title: fallback, generated: false };
    } catch (err) {
      log(`memos: title: ${err?.message ?? err}`);
      return { title: fallback, generated: false };
    }
  }

  async function uniqueId(base) {
    for (let i = 1; ; i++) {
      const id = i === 1 ? base : `${base}-${i}`;
      try {
        await fsp.access(memoFile(id));
      } catch {
        return id;
      }
    }
  }

  /** POST …/recordings/:rec/finish { segments, startedAt, durationMs } → the memo. */
  function finish(rec, { segments, startedAt, durationMs } = {}) {
    if (!validRecordingId(rec)) throw new HttpError('invalid recording id', 400);
    if (!Number.isInteger(segments) || segments < 1 || segments > MAX_SEGMENTS) throw new HttpError('segments must be a positive integer', 400);
    return locked(rec, async () => {
      const meta = await readMeta(rec);
      const { body, failed } = await assemble(rec, segments);
      const startMs = Number.isFinite(startedAt) ? startedAt : (meta.firstSegmentAt ?? now());
      const created = localStamp(startMs);
      const durationSec = Number.isFinite(durationMs) && durationMs > 0 ? durationMs / 1000 : 0;
      const status = failed ? 'partial' : 'done';
      await fsp.mkdir(dir, { recursive: true });

      // Finished before (a retried request, or a retry): update that file, keep its title unless generated now.
      const existing = meta.memo && validMemoId(meta.memo) ? await readOr(memoFile(meta.memo)) : null;
      let id = meta.memo;
      let title;
      if (existing != null) {
        const prev = parseMemo(existing).meta;
        title = prev.title;
        if (meta.titleGenerated === false && !failed) {
          const t = await makeTitle(body, created);
          if (t.generated) {
            title = t.title;
            meta.titleGenerated = true;
          }
        }
      } else {
        const t = await makeTitle(body, created);
        title = t.title;
        meta.titleGenerated = t.generated;
        id = await uniqueId(`${created.date}-${slugify(t.generated ? title : `memo-${created.time}`) || 'memo'}`);
      }
      await writeAtomic(memoFile(id), formatMemo({ title, created: created.iso, durationSec, recording: rec, status }, body));
      await writeMeta(rec, { ...meta, memo: id, segments, startedAt: startMs, durationMs: durationMs ?? null });
      log(`memos: saved ${id} (${segments} segment${segments === 1 ? '' : 's'}${failed ? `, ${failed} not transcribed` : ''})`);
      return get(id);
    });
  }

  async function list() {
    const names = await fsp.readdir(dir).catch(() => []);
    const memos = [];
    for (const name of names) {
      if (!name.endsWith('.md')) continue;
      const id = name.slice(0, -3);
      if (!validMemoId(id)) continue;
      const text = await readOr(path.join(dir, name));
      if (text == null) continue;
      const { meta, body } = parseMemo(text);
      if (!meta.recording) continue; // not one of ours
      memos.push(summarize(id, meta, body));
    }
    memos.sort((a, b) => String(b.created ?? '').localeCompare(String(a.created ?? '')) || b.id.localeCompare(a.id));
    return { dir, memos };
  }

  async function read(id) {
    if (!validMemoId(id)) throw new HttpError('invalid memo id', 400);
    const text = await readOr(memoFile(id));
    if (text == null) throw new HttpError('memo not found', 404);
    return text;
  }

  async function get(id) {
    const { meta, body } = parseMemo(await read(id));
    if (!meta.recording) throw new HttpError('memo not found', 404);
    return { ...summarize(id, meta, body), transcript: body.trim(), path: memoFile(id) };
  }

  async function rename(id, title) {
    const t = String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
    if (!t) throw new HttpError('title is required', 400);
    const text = await read(id);
    await writeAtomic(memoFile(id), setMetaLine(text, 'title', JSON.stringify(t)));
    const rec = parseMemo(text).meta.recording;
    if (validRecordingId(rec)) {
      const meta = await readMeta(rec);
      if (meta.memo === id) await writeMeta(rec, { ...meta, titleGenerated: true });
    }
    return get(id);
  }

  async function remove(id) {
    const text = await read(id);
    const rec = parseMemo(text).meta.recording;
    await fsp.rm(memoFile(id), { force: true });
    if (validRecordingId(rec)) await fsp.rm(recDir(rec), { recursive: true, force: true });
    return { deleted: id };
  }

  /** Transcribe the segments that failed and rewrite the memo. */
  async function retry(id) {
    const { meta } = parseMemo(await read(id));
    const rec = meta.recording;
    if (!validRecordingId(rec)) throw new HttpError('this memo has no recording to retry', 409);
    const rmeta = await readMeta(rec);
    if (!rmeta.segments) throw new HttpError('the recording of this memo is gone', 409);
    return finish(rec, { segments: rmeta.segments, startedAt: rmeta.startedAt, durationMs: rmeta.durationMs ?? undefined });
  }

  return { dir, audioDir, putSegment, finish, list, get, rename, remove, retry };
}

const pad = (n) => String(n).padStart(3, '0');
