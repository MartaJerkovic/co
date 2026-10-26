import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { tailLines, sleep as defaultSleep } from './util.mjs';

/** Error with an HTTP status attached. */
// Largest piece of text one `send-keys -l` types. Claude Code takes a burst of more than ~800
// bytes as a paste (collapsed into `[Pasted text]`), and from one write of more than ~1 KB it keeps
// only what follows the first 1 KB.
export const TYPE_CHUNK = 512;

// Claude Code turns an image path into `[Image #N]` in place only when the path arrives as a paste
// of its own; inside a longer paste it moves every image to the front of the message.
const IMAGE_PATH_RE = /((?<!\S)"\/(?:[^"\\]|\\.)*\.(?:png|jpe?g|gif|webp)"|(?<!\S)\/\S+\.(?:png|jpe?g|gif|webp)(?!\S))/i;
// Pause between those pastes, so each lands before the next one starts.
const IMAGE_PASTE_GAP_MS = 400;

/** `text` cut around image paths: text, path, text, … (empty pieces dropped). */
export function imageSegments(text) {
  return text.split(new RegExp(IMAGE_PATH_RE.source, 'gi')).filter((part) => part !== '');
}

/** Split `text` into pieces of at most `max` UTF-8 bytes, never inside a character. */
export function typeChunks(text, max = TYPE_CHUNK) {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of text) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > max && cur) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  if (cur) out.push(cur);
  return out;
}

export class BackendError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'BackendError';
    this.status = status;
  }
}

export const ITERM_SCRIPT = `on findSession(theId)
  tell application "iTerm2"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          if (id of s) is theId then return s
        end repeat
      end repeat
    end repeat
  end tell
  return missing value
end findSession

on run argv
  set theMode to item 1 of argv
  set theId to item 2 of argv
  set theSession to findSession(theId)
  if theSession is missing value then
    error "iterm session not found: " & theId number 1001
  end if
  if theMode is "peek" then
    tell application "iTerm2"
      return text of theSession
    end tell
  else if theMode is "send" then
    tell application "iTerm2"
      tell theSession to write text (item 3 of argv) without newline
    end tell
    delay 0.2
    tell application "iTerm2"
      tell theSession to write text ""
    end tell
    return "ok"
  else if theMode is "type" then
    tell application "iTerm2"
      tell theSession to write text (item 3 of argv) without newline
    end tell
    return "ok"
  else if theMode is "enter" then
    tell application "iTerm2"
      tell theSession to write text ""
    end tell
    return "ok"
  else if theMode is "escape" then
    tell application "iTerm2"
      tell theSession to write text (ASCII character 27) without newline
    end tell
    return "ok"
  else if theMode is "up" then
    tell application "iTerm2"
      tell theSession to write text ((ASCII character 27) & "[A") without newline
    end tell
    return "ok"
  else if theMode is "down" then
    tell application "iTerm2"
      tell theSession to write text ((ASCII character 27) & "[B") without newline
    end tell
    return "ok"
  else if theMode is "close" then
    tell application "iTerm2"
      tell theSession to close
    end tell
    return "ok"
  end if
  error "unknown mode: " & theMode number 1002
end run
`;

/**
 * Write the AppleScript helper once per process and reuse the path.
 */
export function createScriptProvider({ tmpdir = os.tmpdir(), fsImpl = fs } = {}) {
  let cached = null;
  return () => {
    if (cached && fsImpl.existsSync(cached)) return cached;
    const file = path.join(tmpdir, `fleet-web-iterm-${process.pid}.applescript`);
    fsImpl.writeFileSync(file, ITERM_SCRIPT, 'utf8');
    cached = file;
    return file;
  };
}

/**
 * Backend driver. `run(file, args, opts)` is injected so the logic stays testable.
 */
export function createBackend({
  run,
  tmux = 'tmux',
  osascript = '/usr/bin/osascript',
  scriptPath = createScriptProvider(),
  sleep = defaultSleep,
  enterDelayMs = 150,
} = {}) {
  if (typeof run !== 'function') throw new TypeError('run must be a function');
  let pasteSeq = 0;

  function requireHandle(session) {
    const handle = session?.handle;
    if (typeof handle !== 'string' || handle === '') {
      throw new BackendError('session has no usable handle', 409);
    }
    return handle;
  }

  function backendOf(session) {
    const b = String(session?.backend ?? 'unknown').toLowerCase();
    if (b !== 'tmux' && b !== 'iterm') {
      throw new BackendError(`backend "${session?.backend ?? 'unknown'}" cannot be controlled`, 409);
    }
    return b;
  }

  /** Type `text` literally, a TYPE_CHUNK at a time, so a long line reaches the TUI whole. */
  async function typeText(handle, text) {
    const chunks = typeChunks(text);
    for (const [i, chunk] of chunks.entries()) {
      if (i > 0) await sleep(20);
      await run(tmux, ['send-keys', '-t', handle, '-l', '--', chunk], { timeout: 8000 });
    }
  }

  /** One bracketed paste of `text` (the TUI keeps its newlines). */
  async function pasteText(handle, text) {
    const buf = `fleet-send-${process.pid}-${++pasteSeq}`;
    await run(tmux, ['load-buffer', '-b', buf, '-'], { input: text, timeout: 8000 });
    await run(tmux, ['paste-buffer', '-p', '-r', '-d', '-b', buf, '-t', handle], { timeout: 8000 });
  }

  /** The last `lines` of the screen; `ansi` keeps the colours (tmux SGR escapes) for the terminal view. */
  async function peek(session, lines, { ansi = false } = {}) {
    const backend = backendOf(session);
    const handle = requireHandle(session);
    if (backend === 'tmux') {
      const { stdout } = await run(tmux, ['capture-pane', '-p', '-J', ...(ansi ? ['-e'] : []), '-t', handle, '-S', `-${lines}`], {
        timeout: 8000,
      });
      return tailLines(stdout, lines);
    }
    const { stdout } = await run(osascript, [scriptPath(), 'peek', handle], { timeout: 15000 });
    return tailLines(stdout, lines);
  }

  /**
   * Where the terminal cursor is (tmux): column `x`, and `below` = lines of the capture under the
   * cursor's line; `alternate`: the app draws a full screen of its own (Claude Code's fullscreen
   * TUI), so its history scrolls with PageUp / PageDown, not the terminal's. null when not tmux.
   */
  async function cursor(session) {
    if (backendOf(session) !== 'tmux') return null;
    const handle = requireHandle(session);
    const { stdout } = await run(tmux, ['display-message', '-p', '-t', handle, '#{cursor_x} #{cursor_y} #{pane_height} #{cursor_flag} #{alternate_on}'], { timeout: 8000 });
    const [x, y, height, shown, alt] = stdout.trim().split(' ').map(Number);
    if (![x, y, height].every(Number.isFinite)) return null;
    const alternate = alt === 1;
    if (!shown) return { x: null, below: 0, alternate };
    if (y + 1 > height - 1) return { x, below: 0, alternate };
    // Captured the same way as the ansi peek (`-e`), so blank lines are trimmed alike.
    const rows = await run(tmux, ['capture-pane', '-p', '-J', '-e', '-t', handle, '-S', String(y + 1), '-E', String(height - 1)], { timeout: 8000 });
    const under = tailLines(rows.stdout, 0);
    return { x, below: under ? under.split('\n').length : 0, alternate };
  }

  async function send(session, text) {
    const backend = backendOf(session);
    const handle = requireHandle(session);
    if (backend === 'tmux') {
      const parts = imageSegments(text);
      if (parts.length > 1) {
        for (const [i, part] of parts.entries()) {
          if (i > 0) await sleep(IMAGE_PASTE_GAP_MS);
          await pasteText(handle, part);
        }
      } else if (/[\r\n]/.test(text)) {
        // tmux (3.6) drops newlines typed by `send-keys -l`, so a multi-line message would reach
        // Claude as one line. Paste it as a bracketed paste instead: the TUI keeps the newlines.
        await pasteText(handle, text);
      } else {
        await typeText(handle, text);
      }
      await sleep(enterDelayMs);
      await run(tmux, ['send-keys', '-t', handle, 'Enter'], { timeout: 8000 });
      return;
    }
    await run(osascript, [scriptPath(), 'send', handle, text], { timeout: 15000 });
  }

  async function keys(session, key) {
    const backend = backendOf(session);
    const handle = requireHandle(session);
    if (backend === 'tmux') {
      await run(tmux, ['send-keys', '-t', handle, key], { timeout: 8000 });
      return;
    }
    const mode = { Escape: 'escape', Enter: 'enter', Up: 'up', Down: 'down' }[key];
    if (!mode) throw new BackendError(`iTerm sessions take only Enter, Escape, Up and Down`, 409);
    await run(osascript, [scriptPath(), mode, handle], { timeout: 15000 });
  }

  /** Type `text` without submitting it (no Enter). */
  async function type(session, text) {
    const backend = backendOf(session);
    const handle = requireHandle(session);
    if (backend === 'tmux') {
      // tmux drops newlines typed by `send-keys -l`: multi-line text goes in as a bracketed paste.
      if (/[\r\n]/.test(text)) await pasteText(handle, text);
      else await typeText(handle, text);
      return;
    }
    await run(osascript, [scriptPath(), 'type', handle, text], { timeout: 15000 });
  }

  /** Close the iTerm tab/pane hosting the session (best effort; the process should be dead already). */
  async function closeIterm(session) {
    const handle = requireHandle(session);
    await run(osascript, [scriptPath(), 'close', handle], { timeout: 15000 });
  }

  return { peek, cursor, send, keys, type, closeIterm };
}

