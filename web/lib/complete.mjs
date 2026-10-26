// Composer autocomplete: what a message to a session can reference, listed on the session's host.
//   skills  `/name` — Claude Code's built-in commands, user / project skills and commands, and the
//           skills of enabled plugins (`plugin:name`), with their descriptions
//   files   `@path` — the .md / .plain files under the session cwd (git ls-files; a walk outside git)
//   brain   `brain:ref` — the markdown notes under `brain_root:` from ~/.brainrc (the `brain` CLI's
//           notes dir); ref = the note's file name when unique, else its path, without `.md`
// Lists are whole (the UI filters as you type), capped, and cached briefly per cwd.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export const MAX_ITEMS = 5000;
const MAX_DEPTH = 12;
const TTL_MS = 10 * 1000;
const SNIFF_BYTES = 4096;
const MAX_DESCRIPTION = 240;
const FILE_EXT = ['.md', '.plain'];
const SKIP_DIRS = new Set(['node_modules', '__pycache__', 'target', 'dist', 'build', 'vendor']);

/** Claude Code's own commands (the common ones; skills and plugins come from disk). */
export const BUILTIN_COMMANDS = [
  ['add-dir', 'Add a working directory'],
  ['agents', 'Manage subagents'],
  ['clear', 'Clear the conversation history'],
  ['compact', 'Compact the conversation, keeping a summary'],
  ['config', 'Open settings'],
  ['context', 'Show context usage'],
  ['cost', 'Show token usage and cost'],
  ['doctor', 'Check the installation'],
  ['export', 'Export the conversation'],
  ['help', 'Show help'],
  ['hooks', 'Manage hooks'],
  ['init', 'Create a CLAUDE.md for this codebase'],
  ['mcp', 'Manage MCP servers'],
  ['memory', 'Edit memory files'],
  ['model', 'Switch the model'],
  ['permissions', 'Manage tool permissions'],
  ['plugin', 'Manage plugins'],
  ['rename', 'Rename the session'],
  ['resume', 'Resume a conversation'],
  ['rewind', 'Rewind the conversation or code'],
  ['status', 'Show status'],
  ['usage', 'Show plan usage limits'],
].map(([name, description]) => ({ name, description, source: 'builtin' }));

/**
 * The frontmatter fields we show (`name`, `description`, `argument-hint`) — a lenient reader:
 * single-line values (quotes stripped) and `>` / `|` block scalars. No frontmatter → {}.
 */
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const out = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let value = kv[2].trim();
    if (/^[>|][+-]?$/.test(value)) {
      const block = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) block.push(lines[++i].trim());
      value = block.filter(Boolean).join(' ');
    } else if (/^(["']).*\1$/.test(value)) {
      value = value.slice(1, -1);
    }
    out[kv[1]] = value;
  }
  return out;
}

/** The first prose line after any frontmatter (a command file without a description). */
function firstLine(text) {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  for (const line of body.split(/\r?\n/)) {
    const t = line.replace(/^#+\s*/, '').trim();
    if (t && !t.startsWith('```')) return t;
  }
  return '';
}

function clip(s) {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > MAX_DESCRIPTION ? `${t.slice(0, MAX_DESCRIPTION - 1)}…` : t;
}

async function head(file) {
  let fh;
  try {
    fh = await fsp.open(file, 'r');
    const buf = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await fh.read(buf, 0, SNIFF_BYTES, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } catch {
    return null;
  } finally {
    await fh?.close().catch(() => {});
  }
}

async function readJson(file) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function dirents(dir) {
  try {
    return await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** `<dir>/<name>/SKILL.md` → skills named `prefix + name` (frontmatter `name` wins). */
async function skillsIn(dir, source, prefix = '') {
  const out = [];
  for (const e of await dirents(dir)) {
    if (e.name.startsWith('.')) continue;
    const text = await head(path.join(dir, e.name, 'SKILL.md'));
    if (text == null) continue;
    const fm = parseFrontmatter(text);
    const name = /^[\w.:-]+$/.test(fm.name ?? '') ? fm.name : e.name;
    out.push(skill(`${prefix}${name.replace(/^.*:/, '')}`, fm, text, source));
  }
  return out;
}

/** The .md files under `dir` → commands (`sub/x.md` → `sub:x`). */
async function commandsIn(dir, source, prefix = '', sub = '', depth = 0) {
  const out = [];
  if (depth > 3) return out;
  for (const e of await dirents(dir)) {
    if (e.name.startsWith('.')) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await commandsIn(abs, source, prefix, `${sub}${e.name}:`, depth + 1)));
    else if (e.name.endsWith('.md')) {
      const text = await head(abs);
      if (text != null) out.push(skill(`${prefix}${sub}${e.name.slice(0, -3)}`, parseFrontmatter(text), text, source));
    }
  }
  return out;
}

function skill(name, fm, text, source) {
  const s = { name, description: clip(fm.description || firstLine(text)), source };
  if (fm['argument-hint']) s.argumentHint = clip(fm['argument-hint']);
  return s;
}

/** cwd and its ancestors, up to (and including) $HOME or the filesystem root. */
function ancestors(cwd, home) {
  const out = [];
  let d = path.resolve(cwd);
  for (;;) {
    out.push(d);
    if (d === home) break;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return out;
}

/** `brain_root:` from a ~/.brainrc (`key: value` lines), `~` expanded. */
export function parseBrainrc(text, home) {
  const m = /^brain_root:\s*(.+?)\s*$/m.exec(text ?? '');
  if (!m) return null;
  const v = m[1].replace(/^(["'])(.*)\1$/, '$2');
  const root = v === '~' || v.startsWith('~/') ? path.join(home, v.slice(1)) : v;
  return path.isAbsolute(root) ? root : null;
}

/** Notes → `{ ref, path, title? }`: the bare file name as ref unless two notes share it. */
export function brainRefs(notes) {
  const count = new Map();
  for (const n of notes) {
    const base = path.basename(n.path, '.md');
    count.set(base, (count.get(base) ?? 0) + 1);
  }
  return notes.map((n) => {
    const base = path.basename(n.path, '.md');
    const ref = count.get(base) > 1 ? n.path.slice(0, -3) : base;
    return { ref, path: n.path, ...(n.title ? { title: n.title } : {}) };
  });
}

/**
 * @param {object} deps
 *   home   $HOME
 *   run    lib/run.mjs (git ls-files)
 *   now    clock, for the caches
 */
/**
 * `/model <id>` for each configured model: switches straight away, without Claude Code's picker,
 * which needs arrow keys a Terminal.app session can't receive.
 */
export function modelCommands(models = []) {
  return models.filter((m) => m?.id).map((m) => ({ name: `model ${m.id}`, description: `Switch to ${m.label || m.id}`, source: 'builtin' }));
}

export function createCompleter({ home, run, models = [], now = Date.now } = {}) {
  const cache = new Map(); // `${kind}\0${cwd}` → { at, value }
  const titles = new Map(); // abs → { mtimeMs, title }

  async function cached(key, build) {
    const hit = cache.get(key);
    if (hit && now() - hit.at < TTL_MS) return hit.value;
    const value = await build();
    cache.set(key, { at: now(), value });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return value;
  }

  async function skills(cwd) {
    const claude = path.join(home, '.claude');
    const out = [...BUILTIN_COMMANDS, ...modelCommands(models)];
    out.push(...(await skillsIn(path.join(claude, 'skills'), 'user')));
    out.push(...(await commandsIn(path.join(claude, 'commands'), 'user')));
    const projectDirs = cwd ? ancestors(cwd, home).filter((d) => d !== home) : [];
    for (const d of projectDirs) {
      out.push(...(await skillsIn(path.join(d, '.claude', 'skills'), 'project')));
      out.push(...(await commandsIn(path.join(d, '.claude', 'commands'), 'project')));
    }
    out.push(...(await pluginSkills(claude, projectDirs)));
    // First one wins (built-in, user, project, plugin), like Claude Code's own precedence.
    const seen = new Set();
    return out.filter((s) => (seen.has(s.name) ? false : seen.add(s.name))).slice(0, MAX_ITEMS);
  }

  /** Skills + commands of the plugins enabled in user / project settings. */
  async function pluginSkills(claude, projectDirs) {
    const enabled = {};
    const settingsFiles = [path.join(claude, 'settings.json')];
    for (const d of [...projectDirs].reverse()) settingsFiles.push(path.join(d, '.claude', 'settings.json'), path.join(d, '.claude', 'settings.local.json'));
    for (const f of settingsFiles) Object.assign(enabled, (await readJson(f))?.enabledPlugins ?? {});
    const installed = (await readJson(path.join(claude, 'plugins', 'installed_plugins.json')))?.plugins ?? {};
    const out = [];
    for (const [key, entries] of Object.entries(installed)) {
      if (enabled[key] !== true || !Array.isArray(entries)) continue;
      const entry = entries.find((e) => e?.scope === 'user') ?? entries.find((e) => e?.projectPath && projectDirs.includes(e.projectPath));
      const [plugin, market] = key.split('@');
      const dir = await pluginDir(claude, entry?.installPath, plugin, market);
      if (!dir) continue;
      out.push(...(await skillsIn(path.join(dir, 'skills'), 'plugin', `${plugin}:`)));
      out.push(...(await commandsIn(path.join(dir, 'commands'), 'plugin', `${plugin}:`)));
    }
    return out;
  }

  /** The plugin's files: its cache dir, or (a directory marketplace, no cache) the marketplace's copy. */
  async function pluginDir(claude, installPath, plugin, market) {
    if (typeof installPath === 'string' && fs.existsSync(installPath)) return installPath;
    const loc = (await readJson(path.join(claude, 'plugins', 'known_marketplaces.json')))?.[market]?.installLocation;
    if (typeof loc !== 'string') return null;
    const listed = (await readJson(path.join(loc, '.claude-plugin', 'marketplace.json')))?.plugins;
    const src = Array.isArray(listed) ? listed.find((p) => p?.name === plugin)?.source : null;
    if (typeof src !== 'string') return null;
    const dir = path.resolve(loc, src);
    return fs.existsSync(dir) ? dir : null;
  }

  /** Paths (relative to `root`) of files with `exts`, skipping hidden and build dirs. */
  async function walk(root, exts) {
    const out = [];
    async function visit(dir, rel, depth) {
      if (depth > MAX_DEPTH || out.length >= MAX_ITEMS) return;
      const entries = (await dirents(dir)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const e of entries) {
        if (out.length >= MAX_ITEMS) return;
        if (e.name.startsWith('.')) continue;
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name)) await visit(path.join(dir, e.name), r, depth + 1);
        } else if (e.isFile() && exts.some((x) => e.name.endsWith(x))) out.push(r);
      }
    }
    await visit(root, '', 0);
    return out.sort(); // bytewise, like git ls-files
  }

  async function files(cwd) {
    if (!cwd) return { files: [], truncated: false };
    let list;
    try {
      const { stdout } = await run(
        'git',
        ['-C', cwd, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...FILE_EXT.map((x) => `*${x}`)],
        { timeout: 5000 },
      );
      list = [...new Set(stdout.split('\0').filter(Boolean))].sort();
    } catch {
      // Not a repo (or no git): the cwd's files, minus hidden and build dirs. Never $HOME itself.
      list = path.resolve(cwd) === home ? [] : await walk(cwd, FILE_EXT);
    }
    return { files: list.slice(0, MAX_ITEMS), truncated: list.length > MAX_ITEMS };
  }

  async function titleOf(abs) {
    const st = await fsp.stat(abs).catch(() => null);
    if (!st) return null;
    const hit = titles.get(abs);
    if (hit && hit.mtimeMs === st.mtimeMs) return hit.title;
    const text = (await head(abs)) ?? '';
    const title = clip(parseFrontmatter(text).title ?? /^#\s+(.+)$/m.exec(text)?.[1] ?? '') || null;
    titles.set(abs, { mtimeMs: st.mtimeMs, title });
    return title;
  }

  async function brain() {
    const root = parseBrainrc(await fsp.readFile(path.join(home, '.brainrc'), 'utf8').catch(() => null), home);
    if (!root || !fs.existsSync(root)) return { available: false, notes: [] };
    const rels = await walk(root, ['.md']);
    const notes = [];
    for (const rel of rels) notes.push({ path: rel, title: await titleOf(path.join(root, rel)) });
    return { available: true, notes: brainRefs(notes), truncated: rels.length >= MAX_ITEMS };
  }

  /** kind: skills | files | brain; cwd: the session's (null → user-level only / nothing). */
  return {
    async list(kind, cwd) {
      if (kind === 'skills') return { skills: await cached(`skills\0${cwd}`, () => skills(cwd)) };
      if (kind === 'files') return cached(`files\0${cwd}`, () => files(cwd));
      if (kind === 'brain') return cached('brain', brain);
      throw Object.assign(new Error('kind must be "skills", "files" or "brain"'), { status: 400 });
    },
  };
}
