// Voice prompts: the composer records audio, this server sends it to OpenAI's transcription
// endpoint and answers with the text, which the UI appends to the prompt. The key comes from
// $OPENAI_SPEECH_TO_TEXT_API_KEY, else (macOS) the Keychain item of that name — never from
// the config file. No key → the feature is off (/api/settings says so, the mic is hidden).
import { HttpError } from './http.mjs';

export const KEY_NAME = 'OPENAI_SPEECH_TO_TEXT_API_KEY';
export const DEFAULT_TRANSCRIBE_MODEL = 'gpt-4o-transcribe';
const ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';
// OpenAI's limit for one file.
export const TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024;
const HINT_MAX = 400;
// A missing key is looked up again after this long (the user may add it to the Keychain).
const MISS_TTL_MS = 60 * 1000;

// Steers the model: Latin script for Croatian (it otherwise drifts to Cyrillic), and the
// vocabulary of a coding session. The UI adds the session's own words (name, repo).
const BASE_PROMPT = 'Glasovna poruka za AI coding agenta, hrvatski ili engleski, latinica. Pojmovi: Claude, fleet, tmux, commit, PR, branch.';

const EXT = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav' };

/** `audio/webm;codecs=opus` → `audio/webm`; null for anything that is not audio we know. */
export function audioType(contentType) {
  const base = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  return EXT[base] ? base : null;
}

/** The transcription prompt: the base vocabulary + the UI's hint (trimmed, one line, capped). */
export function buildPrompt(hint) {
  const extra = String(hint ?? '').replace(/\s+/g, ' ').trim().slice(0, HINT_MAX);
  return extra ? `${BASE_PROMPT} ${extra}` : BASE_PROMPT;
}

/** The request body as a Buffer, refusing more than `limit` bytes. */
function readAudio(req, limit) {
  const declared = Number(req.headers?.['content-length']);
  if (Number.isFinite(declared) && declared > limit) return Promise.reject(tooLarge(limit));
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        done = true;
        chunks.length = 0;
        reject(tooLarge(limit));
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', (err) => {
      if (done) return;
      done = true;
      reject(new HttpError(err.message, 400));
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks));
    });
  });
}

const tooLarge = (limit) => new HttpError(`recording too large (max ${Math.round(limit / 1024 / 1024)} MB)`, 413);

/**
 * The API key: the env var, else `security find-generic-password -s <KEY_NAME> -w` on macOS.
 * A hit is cached for good, a miss for a minute.
 */
export function createKeySource({ env = process.env, platform = process.platform, run, now = Date.now } = {}) {
  let key = null;
  let missedAt = -Infinity;
  return async function getKey() {
    if (key) return key;
    const fromEnv = env[KEY_NAME]?.trim();
    if (fromEnv) return (key = fromEnv);
    if (platform !== 'darwin' || !run || now() - missedAt < MISS_TTL_MS) return null;
    try {
      const { stdout } = await run('security', ['find-generic-password', '-s', KEY_NAME, '-w'], { timeout: 5000 });
      if (stdout.trim()) return (key = stdout.trim());
    } catch {
      /* not in the Keychain, or it is locked */
    }
    missedAt = now();
    return null;
  };
}

/**
 * @param {object} opts
 *   getKey    async () => key | null (createKeySource)
 *   model     OpenAI transcription model
 *   fetch     injectable for tests
 * @returns {{ enabled(): Promise<boolean>, transcribe(req, hint): Promise<{ text, model }> }}
 */
export function createTranscriber({ getKey, model = DEFAULT_TRANSCRIBE_MODEL, maxBytes = TRANSCRIBE_MAX_BYTES, fetch = globalThis.fetch, timeoutMs = 60 * 1000, log = () => {} }) {
  async function enabled() {
    return Boolean(await getKey());
  }

  async function transcribe(req, hint) {
    const key = await getKey();
    if (!key) throw new HttpError(`voice input is off: no ${KEY_NAME} on this server`, 501);
    const type = audioType(req.headers?.['content-type']);
    if (!type) throw new HttpError('expected an audio body (webm, ogg, mp4, mp3 or wav)', 415);
    const audio = await readAudio(req, maxBytes);
    if (!audio.length) throw new HttpError('empty recording', 400);

    const form = new FormData();
    form.append('model', model);
    form.append('prompt', buildPrompt(hint));
    form.append('response_format', 'json');
    form.append('file', new Blob([audio], { type }), `voice.${EXT[type]}`);

    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}` },
        body: form,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const timedOut = err?.name === 'TimeoutError';
      throw new HttpError(timedOut ? 'transcription timed out' : `transcription service unreachable: ${err?.message ?? err}`, timedOut ? 504 : 502);
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data?.error?.message || `HTTP ${res.status}`;
      log(`transcribe: OpenAI ${res.status}: ${msg}`);
      // The key's problems are this server's, not the caller's: 502, never a 401 the UI would misread.
      throw new HttpError(`transcription failed: ${msg}`, res.status === 429 ? 429 : 502);
    }
    return { text: String(data?.text ?? '').trim(), model };
  }

  return { enabled, transcribe };
}
