// The servers a session started: listening TCP ports owned by the session's process tree or run
// from inside its directory, so the UI can open them (`…/previews`).

/** `lsof -F pcn` output → one entry per process: pid, command, listening ports. */
export function parseListeners(stdout) {
  const out = new Map();
  let cur = null;
  for (const line of String(stdout).split('\n')) {
    const tag = line[0];
    const val = line.slice(1);
    if (tag === 'p') {
      cur = { pid: Number(val), command: '', ports: new Set() };
      out.set(cur.pid, cur);
    } else if (tag === 'c' && cur) cur.command = val;
    else if (tag === 'n' && cur) {
      const port = Number(val.slice(val.lastIndexOf(':') + 1));
      if (Number.isInteger(port) && port > 0) cur.ports.add(port);
    }
  }
  return [...out.values()];
}

/** Every process under `root`, from `ps -o pid=,ppid=` output. */
export function descendants(psOut, root) {
  const children = new Map();
  for (const line of String(psOut).split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!pid) continue;
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push(pid);
  }
  const seen = new Set();
  const stack = [root];
  while (stack.length) {
    for (const c of children.get(stack.pop()) ?? []) {
      if (!seen.has(c)) {
        seen.add(c);
        stack.push(c);
      }
    }
  }
  return seen;
}

/** `lsof -d cwd -F pn` output → pid → working directory. */
export function parseCwds(stdout) {
  const out = new Map();
  let pid = null;
  for (const line of String(stdout).split('\n')) {
    if (line[0] === 'p') pid = Number(line.slice(1));
    else if (line[0] === 'n' && pid != null) out.set(pid, line.slice(1));
  }
  return out;
}

const within = (dir, root) => !!dir && !!root && (dir === root || dir.startsWith(`${root.replace(/\/+$/, '')}/`));

/**
 * @param {object} deps
 *   run           (file, args, opts) → { stdout } (lib/run.mjs)
 *   excludePorts  ports never offered (the web server's own)
 */
export function createPreviews({ run, excludePorts = [] }) {
  const quiet = async (file, args) => {
    try {
      return (await run(file, args, { timeout: 5000 })).stdout;
    } catch (err) {
      // lsof exits 1 when nothing matches.
      return err?.stdout ?? '';
    }
  };

  /**
   * [{ port, command }] for `session` (needs its `pid` and `cwd`), lowest port first. `treeOnly`:
   * only its own processes — for a session in a directory other sessions share.
   */
  async function list(session, { treeOnly = false } = {}) {
    const listeners = parseListeners(await quiet('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pcn'])).filter(
      (l) => [...l.ports].some((p) => !excludePorts.includes(p)),
    );
    if (!listeners.length) return [];
    const tree = session.pid ? descendants(await quiet('ps', ['-A', '-o', 'pid=,ppid=']), Number(session.pid)) : new Set();
    const rest = listeners.filter((l) => !tree.has(l.pid)).map((l) => l.pid);
    const cwds = rest.length && session.cwd && !treeOnly ? parseCwds(await quiet('lsof', ['-a', '-d', 'cwd', '-F', 'pn', '-p', rest.join(',')])) : new Map();
    const ports = new Map();
    for (const l of listeners) {
      if (!tree.has(l.pid) && !within(cwds.get(l.pid), session.cwd)) continue;
      for (const port of l.ports) if (!excludePorts.includes(port) && !ports.has(port)) ports.set(port, l.command);
    }
    return [...ports].sort((a, b) => a[0] - b[0]).map(([port, command]) => ({ port, command }));
  }

  return { list };
}
