// The diff reviewer's source: what a session's worktree changed against a base, as structured
// files → hunks → lines. The working tree (tracked edits and untracked files alike) is captured
// as a git tree object through a throwaway index — a copy of the real one, so `git add -A` only
// rehashes what changed — and diffed against the merge-base of HEAD with the base branch.
// The tree id doubles as the fingerprint: identical content ⇔ identical id, so a poller sends
// `since=<tree>` and gets `{ unchanged: true }` back while nothing moved. Nothing in the repo
// changes: no refs, no real index; only loose blobs for changed files (git gc reclaims them).
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** git's empty tree: the base of a repo without commits. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
/** A file whose hunks run past this many lines is cut there (`truncated: true`). */
export const MAX_FILE_LINES = 5000;
/** The whole answer stops taking hunks past this many lines; later files come without them. */
export const MAX_TOTAL_LINES = 50000;
const GIT_TIMEOUT_MS = 20000;
const MAX_BUFFER = 64 * 1024 * 1024;
/** `?base=`: a branch, tag or sha; never an option. */
const REF_RE = /^(?!-)[A-Za-z0-9._/@{}~^-]{1,200}$/;
const TREE_RE = /^[0-9a-f]{40,64}$/;

export class DiffError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function validRef(ref) {
  return typeof ref === 'string' && REF_RE.test(ref) && !ref.includes('..');
}

export function validTree(sha) {
  return typeof sha === 'string' && TREE_RE.test(sha);
}

const STATUS = { A: 'added', D: 'deleted', M: 'modified', R: 'renamed', C: 'copied', T: 'modified' };

/** `git diff --name-status -z` → [{ status, path, oldPath }] in diff order. */
export function parseNameStatus(out) {
  const parts = out.split('\0');
  const files = [];
  for (let i = 0; i < parts.length; ) {
    const code = parts[i++];
    if (!code) continue;
    const kind = STATUS[code[0]] ?? 'modified';
    if (code[0] === 'R' || code[0] === 'C') {
      const oldPath = parts[i++];
      const newPath = parts[i++];
      files.push({ status: kind, path: newPath, oldPath });
    } else {
      const p = parts[i++];
      files.push({ status: kind, path: p, oldPath: kind === 'added' ? null : p });
    }
  }
  return files;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

/**
 * A unified diff (`git diff -p`) → per file, in order: { binary, hunks: [{ header, oldStart,
 * oldLines, newStart, newLines, section, lines: [{ t: ' '|'+'|'-', o, n, text }] }] }, where
 * `o` / `n` are the old / new line numbers (null on the side a line is not on) and a
 * "\ No newline at end of file" marks the line before it `noEol: true`. Paths come from
 * `--name-status -z` (unambiguous), so the headers here only split the files.
 */
export function parsePatch(text) {
  const files = [];
  let file = null;
  let hunk = null;
  let o = 0;
  let n = 0;
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  for (const line of lines) {
    if (line.startsWith('diff --git ') || line.startsWith('diff --cc ')) {
      file = { binary: false, hunks: [] };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;
    if (!hunk) {
      if (line.startsWith('Binary files ') || line === 'GIT binary patch') file.binary = true;
      const m = HUNK_RE.exec(line);
      if (!m) continue; // index / mode / rename / ---/+++ headers
    }
    const m = line.startsWith('@@') ? HUNK_RE.exec(line) : null;
    if (m) {
      hunk = {
        header: line,
        oldStart: Number(m[1]),
        oldLines: m[2] == null ? 1 : Number(m[2]),
        newStart: Number(m[3]),
        newLines: m[4] == null ? 1 : Number(m[4]),
        section: m[5] || '',
        lines: [],
      };
      file.hunks.push(hunk);
      o = hunk.oldStart;
      n = hunk.newStart;
      continue;
    }
    const t = line[0];
    if (t === ' ') hunk.lines.push({ t, o: o++, n: n++, text: line.slice(1) });
    else if (t === '-') hunk.lines.push({ t, o: o++, n: null, text: line.slice(1) });
    else if (t === '+') hunk.lines.push({ t, o: null, n: n++, text: line.slice(1) });
    else if (t === '\\') {
      const last = hunk.lines.at(-1);
      if (last) last.noEol = true;
    } else if (line === '') hunk.lines.push({ t: ' ', o: o++, n: n++, text: '' }); // a context line some tools strip
  }
  return files;
}

/**
 * @param {object} deps
 *   run      lib/run.mjs#run (git)
 *   tmpDir   where throwaway index files go (default os.tmpdir())
 */
export function createDiffer({ run, tmpDir = os.tmpdir() }) {
  const git = (cwd, args, opts = {}) =>
    run('git', ['-C', cwd, '-c', 'core.quotePath=false', ...args], { timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_BUFFER, ...opts });

  async function revParse(cwd, args) {
    try {
      return (await git(cwd, ['rev-parse', ...args])).stdout.trim();
    } catch {
      return null;
    }
  }

  /** The repo's default branch: origin/HEAD, else a local main / master; null when none. */
  async function defaultBase(root) {
    const sym = await git(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']).then(
      (r) => r.stdout.trim(),
      () => '',
    );
    if (sym) return sym;
    for (const b of ['main', 'master']) if (await revParse(root, ['--verify', '--quiet', `refs/heads/${b}^{commit}`])) return b;
    return null;
  }

  /** The working tree as a tree object: copy the index, `add -A` into the copy, write it. */
  async function worktreeTree(root) {
    const indexPath = path.resolve(root, (await revParse(root, ['--git-path', 'index'])) ?? '.git/index');
    const tmp = path.join(tmpDir, `fleet-diff-${process.pid}-${Math.random().toString(16).slice(2)}.index`);
    try {
      await fsp.copyFile(indexPath, tmp).catch((err) => {
        if (err?.code !== 'ENOENT') throw err; // a repo without an index yet: start empty
      });
      const env = { ...process.env, GIT_INDEX_FILE: tmp };
      await git(root, ['add', '-A', '--', '.'], { env });
      return (await git(root, ['write-tree'], { env })).stdout.trim();
    } finally {
      await fsp.rm(tmp, { force: true });
      await fsp.rm(`${tmp}.lock`, { force: true });
    }
  }

  /**
   * The diff for a directory inside a checkout.
   *   cwd     the session's working directory
   *   base    a ref to diff against (default: the repo's default branch); the diff starts at
   *           the merge-base of HEAD with it, so commits on the branch count as changes
   *   since   a tree id from an earlier answer: unchanged → { unchanged: true, tree } only
   * → { root, branch, head, base: { ref, sha }, tree, unchanged, files, stats, truncated }
   */
  async function diff(cwd, { base = null, since = null } = {}) {
    if (base != null && !validRef(base)) throw new DiffError('invalid base ref', 400);
    const root = await revParse(cwd, ['--show-toplevel']);
    if (!root) throw new DiffError('not a git repository', 409);
    const tree = await worktreeTree(root);
    const head = await revParse(root, ['--verify', '--quiet', 'HEAD^{commit}']);
    const branchName = await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']).then((r) => r.stdout.trim() || null, () => null);
    const baseRef = base ?? (await defaultBase(root));
    let baseSha = EMPTY_TREE;
    if (head) {
      baseSha = head;
      if (baseRef) {
        const mb = await git(root, ['merge-base', 'HEAD', baseRef]).then((r) => r.stdout.trim(), () => null);
        if (mb) baseSha = mb;
        else if (base != null) throw new DiffError(`no merge-base with ${base}`, 400);
      }
    }
    const meta = { root, branch: branchName, head, base: { ref: head ? baseRef : null, sha: baseSha }, tree };
    // The base can move too (a commit, a rebase): the fingerprint is both ids.
    const fingerprint = `${baseSha}:${tree}`;
    if (since && since === fingerprint) return { ...meta, fingerprint, unchanged: true };

    const opts = ['--no-color', '--no-ext-diff', '-M', '--no-relative'];
    const [{ stdout: ns }, { stdout: patch }] = await Promise.all([
      git(root, ['diff', ...opts, '--name-status', '-z', baseSha, tree]),
      git(root, ['diff', ...opts, '-p', '-U3', baseSha, tree]),
    ]);
    const names = parseNameStatus(ns);
    const parsed = parsePatch(patch);
    let total = 0;
    let truncated = false;
    const stats = { files: names.length, additions: 0, deletions: 0 };
    const files = names.map((f, i) => {
      const p = parsed[i] ?? { binary: false, hunks: [] };
      let additions = 0;
      let deletions = 0;
      for (const h of p.hunks) for (const l of h.lines) l.t === '+' ? additions++ : l.t === '-' && deletions++;
      stats.additions += additions;
      stats.deletions += deletions;
      const size = p.hunks.reduce((s, h) => s + h.lines.length, 0);
      let hunks = p.hunks;
      let cut = false;
      if (total + size > MAX_TOTAL_LINES) {
        hunks = [];
        cut = true;
        truncated = true;
      } else if (size > MAX_FILE_LINES) {
        hunks = cutHunks(p.hunks, MAX_FILE_LINES);
        cut = true;
      }
      total += hunks.reduce((s, h) => s + h.lines.length, 0);
      return { ...f, binary: p.binary, additions, deletions, truncated: cut, hunks };
    });
    return { ...meta, fingerprint, unchanged: false, files, stats, truncated };
  }

  return { diff };
}

function cutHunks(hunks, max) {
  const out = [];
  let left = max;
  for (const h of hunks) {
    if (left <= 0) break;
    out.push(h.lines.length <= left ? h : { ...h, lines: h.lines.slice(0, left) });
    left -= h.lines.length;
  }
  return out;
}
