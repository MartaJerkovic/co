// Focus mode: the `focus` CLI on this machine (Do Not Disturb + quitting distracting apps for a
// while). It prints text only, so its status lines are parsed here:
//   No active focus session.
//   Focus active: 42m 7s remaining (ends at 14:30:00).
//   Focus session expired (watchdog should fire momentarily).
//   Warning: session state exists but watchdog (pid 123) is not running.

const ACTIVE_RE = /Focus active:\s*(\d+)m\s+(\d+)s remaining/;
const APPS_RE = /^Apps quit for this session:\s*(.+)$/m;

/** `focus status` output → `{ active, remainingMs, endsAt, apps, stale }`. */
export function parseFocusStatus(stdout, now = Date.now()) {
  const text = String(stdout ?? '');
  const m = ACTIVE_RE.exec(text);
  if (!m) return { active: false, remainingMs: 0, endsAt: null, apps: [], stale: /watchdog .* is not running/.test(text) };
  const remainingMs = (Number(m[1]) * 60 + Number(m[2])) * 1000;
  const apps = (APPS_RE.exec(text)?.[1] ?? '').split(',').map((a) => a.trim()).filter(Boolean);
  return { active: true, remainingMs, endsAt: now + remainingMs, apps, stale: false };
}

/**
 * `run` is lib/run.mjs#run. Every call resolves to the status after it; a missing binary is an
 * error with `.missing`, a failed start/stop one with focus's own message.
 */
export function createFocus({ run, bin = 'focus', timeoutMs = 30 * 1000 } = {}) {
  async function exec(args) {
    try {
      return (await run(bin, args, { timeout: timeoutMs, env: { ...process.env, NO_COLOR: '1' } })).stdout;
    } catch (err) {
      const e = new Error(err?.code === 'ENOENT' ? `${bin} not found on this host` : String(err?.stderr || err?.message || err).trim());
      e.missing = err?.code === 'ENOENT';
      e.timedOut = Boolean(err?.killed);
      throw e;
    }
  }

  const status = async () => parseFocusStatus(await exec(['status']));

  /** Start a session (`minutes` absent: focus's own default); already on → just the status. */
  async function start(minutes = null) {
    const now = await status();
    if (now.active) return now;
    await exec(minutes == null ? ['start'] : ['start', String(minutes)]);
    return status();
  }

  async function stop() {
    const now = await status();
    if (!now.active && !now.stale) return now;
    await exec(['stop']);
    return status();
  }

  return { status, start, stop };
}
