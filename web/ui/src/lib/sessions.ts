// Session list logic: status metadata, filtering, search, sorting — pure, unit-tested.
import type { FleetResponse, Session, SessionStatus } from '@/api/types'
import { stripAnsi } from '@/lib/ansi'

export type StatusKey = SessionStatus
export interface StatusMeta {
  key: StatusKey
  /** Human label. */
  label: string
}

const STATUS_META: Record<StatusKey, StatusMeta> = {
  waiting: { key: 'waiting', label: 'needs you' },
  busy: { key: 'busy', label: 'working' },
  idle: { key: 'idle', label: 'idle' },
  unknown: { key: 'unknown', label: 'unknown' },
}

export function statusMeta(status: string | null | undefined): StatusMeta {
  const k = String(status || '').toLowerCase() as StatusKey
  return STATUS_META[k] ?? STATUS_META.unknown
}

/** "needs you · permission" for a waiting session with a reason, else the plain label. */
export function statusLabel(s: Pick<Session, 'status' | 'waiting_for'>): string {
  const meta = statusMeta(s.status)
  const why = typeof s.waiting_for === 'string' ? s.waiting_for.trim() : ''
  return meta.key === 'waiting' && why ? `${meta.label} · ${why}` : meta.label
}

export type StatusFilterId = 'all' | 'waiting' | 'busy' | 'idle' | 'scheduled' | 'embedded'
export interface StatusFilter {
  id: StatusFilterId
  label: string
  match: (s: Session) => boolean
  /** The chip's tooltip. */
  title?: string
}

/** The filters for sessions set aside from the rest (bots, app panels): a chip only when there are some. */
const SET_ASIDE: StatusFilterId[] = ['scheduled', 'embedded']

export const STATUS_FILTERS: StatusFilter[] = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'waiting', label: 'Needs you', match: (s) => statusMeta(s.status).key === 'waiting' },
  { id: 'busy', label: 'Busy', match: (s) => statusMeta(s.status).key === 'busy' },
  { id: 'idle', label: 'Idle', match: (s) => statusMeta(s.status).key === 'idle' },
  // Only the sessions bots started / an app's embedded panel started (every other filter leaves
  // them out unless waiting).
  { id: 'scheduled', label: 'Bots', match: (s) => isJobSession(s), title: 'Sessions started by bots' },
  { id: 'embedded', label: 'Apps', match: (s) => isEmbedSession(s), title: "Sessions started from an app's Fleet panel (embed view)" },
]

/** The filters worth a chip: Bots / Apps only when there are such sessions, or it is the one picked. */
export function visibleStatusFilters(counts: Record<StatusFilterId, number> | null, current: StatusFilterId): StatusFilter[] {
  return STATUS_FILTERS.filter((f) => !SET_ASIDE.includes(f.id) || current === f.id || (counts?.[f.id] ?? 0) > 0)
}

export function findStatusFilter(id: string | null | undefined): StatusFilter {
  return STATUS_FILTERS.find((f) => f.id === id) ?? STATUS_FILTERS[0]
}

/** Every session across hosts (unreachable hosts contribute none), voice operators left out (they live in #/operator). */
export function allSessions(fleet: FleetResponse | null | undefined): Session[] {
  const out: Session[] = []
  for (const host of fleet?.hosts ?? []) for (const s of host.sessions ?? []) if (!s.operator) out.push({ ...s, host: s.host ?? host.name })
  return out
}

export function matchesSearch(s: Session, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [s.display_title, s.name, s.gen_title, s.title, s.cwd, s.tmux_session, s.host]
    .filter((v): v is string => typeof v === 'string')
    .join('\n')
    .toLowerCase()
    .includes(q)
}

/** Most recent activity first (a flat list across hosts). */
export function byLastActivity(a: Session, b: Session): number {
  return (b.updated_at || 0) - (a.updated_at || 0)
}

export interface ListView {
  /** Sessions to show: search + host + status filter applied, sorted by last activity. */
  sessions: Session[]
  /** Per status-filter counts, after search + host scoping (what the chips show). */
  counts: Record<StatusFilterId, number>
}

/** A session a bot started (`origin`, docs/cli.md → Bots). */
export function isJobSession(s: Pick<Session, 'origin'>): boolean {
  return Boolean(s.origin?.job)
}

/** A session an app's embedded Fleet panel started (`embed`, docs/architecture.md → Embed view). */
export function isEmbedSession(s: Pick<Session, 'embed'>): boolean {
  return Boolean(s.embed)
}

/**
 * Job and embed sessions stay out of every filter but their own (Bots / Apps) — except one
 * waiting on you, which always shows (and always counts).
 */
export function setAside(s: Session): boolean {
  return (isJobSession(s) || isEmbedSession(s)) && statusMeta(s.status).key !== 'waiting'
}

/**
 * `host` null = every host. Bots / Apps show only job / embed sessions; the other filters show
 * the rest, plus those waiting on you.
 */
export function listView(
  fleet: FleetResponse | null | undefined,
  { query = '', host = null, status = 'all' }: { query?: string; host?: string | null; status?: StatusFilterId },
): ListView {
  const matched = allSessions(fleet).filter((s) => (host == null || s.host === host) && matchesSearch(s, query))
  const visible = matched.filter((s) => !setAside(s))
  const scope = (f: StatusFilter) => (SET_ASIDE.includes(f.id) ? matched : visible).filter(f.match)
  const counts = Object.fromEntries(STATUS_FILTERS.map((f) => [f.id, scope(f).length])) as Record<StatusFilterId, number>
  return { sessions: clusterByStack(scope(findStatusFilter(status)).sort(byLastActivity)), counts }
}

/** Every session by status, job sessions included — the header's counters. */
export function statusSummary(fleet: FleetResponse | null | undefined): Record<'waiting' | 'busy' | 'idle', number> {
  const out = { waiting: 0, busy: 0, idle: 0 }
  for (const s of allSessions(fleet)) {
    const k = statusMeta(s.status).key
    if (k === 'waiting' || k === 'busy' || k === 'idle') out[k] += 1
  }
  return out
}

/**
 * Keep the sessions of one stack adjacent: every stack moves up to the position of its first
 * member (members keep their relative order), everything else stays where it was. Stable, pure;
 * rows without `stack` (older servers) come back unchanged.
 */
/** A stack's identity across hosts: its home host + id; null when the session is in none. */
function stackKey(s: Session): string | null {
  return s.stack?.id ? `${s.stack.host || s.host}/${s.stack.id}` : null
}

export function clusterByStack(sessions: Session[]): Session[] {
  // Keyed by the stack's home host: members on other hosts cluster with it.
  const key = stackKey
  const members = new Map<string, Session[]>()
  for (const s of sessions) {
    const k = key(s)
    if (!k) continue
    const list = members.get(k)
    if (list) list.push(s)
    else members.set(k, [s])
  }
  if (![...members.values()].some((l) => l.length > 1)) return sessions
  const out: Session[] = []
  const done = new Set<string>()
  for (const s of sessions) {
    const k = key(s)
    if (!k) out.push(s)
    else if (!done.has(k)) {
      done.add(k)
      out.push(...(members.get(k) ?? [s]))
    }
  }
  return out
}

export function findSession(fleet: FleetResponse | null | undefined, host: string, id: string): Session | null {
  const entry = fleet?.hosts?.find((h) => h.name === host)
  return entry?.sessions?.find((s) => s.session_id === id) ?? null
}

/** Hash route of a session's detail screen: `#/s/<host>/<session_id>`. */
export function sessionHref(s: Pick<Session, 'host' | 'session_id'>): string {
  return `/s/${encodeURIComponent(s.host)}/${encodeURIComponent(s.session_id)}`
}

/** Hosts a session can be spawned on: reachable ones, with the directories each advertises. */
export function spawnTargets(fleet: FleetResponse | null | undefined): { name: string; dirs: { label: string; path: string }[] }[] {
  return (fleet?.hosts ?? [])
    .filter((h) => h.ok !== false)
    .map((h) => ({ name: h.name, dirs: Array.isArray(h.spawnDirs) ? h.spawnDirs : [] }))
}

/** The freshly spawned session, once Claude registered it: its tmux session (or name) matches. */
export function findSpawned(
  fleet: FleetResponse | null | undefined,
  host: string,
  spawned: { tmuxSession?: string; name?: string },
): Session | null {
  const entry = fleet?.hosts?.find((h) => h.name === host)
  const tmux = spawned.tmuxSession || spawned.name
  return (
    entry?.sessions?.find((s) => (tmux && s.tmux_session === tmux) || (spawned.name && s.name === spawned.name)) ?? null
  )
}

/** The fleet minus one session (optimistic update after closing it). */
export function withoutSession(fleet: FleetResponse, host: string, id: string): FleetResponse {
  return {
    ...fleet,
    hosts: fleet.hosts.map((h) => (h.name === host ? { ...h, sessions: h.sessions.filter((s) => s.session_id !== id) } : h)),
  }
}

/** The key `withoutClosed` matches on: host + session id. */
export const closedKey = (host: string, id: string) => `${host}\u0000${id}`

/** The fleet minus the sessions closed recently (`closed`: closedKey → hide-until ms); same object when nothing matches. */
export function withoutClosed(fleet: FleetResponse, closed: ReadonlyMap<string, number>, now = Date.now()): FleetResponse {
  const hidden = (h: string, id: string) => (closed.get(closedKey(h, id)) ?? 0) > now
  if (!fleet.hosts.some((h) => h.sessions.some((s) => hidden(h.name, s.session_id)))) return fleet
  return { ...fleet, hosts: fleet.hosts.map((h) => ({ ...h, sessions: h.sessions.filter((s) => !hidden(h.name, s.session_id)) })) }
}

/** A list entry: one session, or the adjacent members of one stack (2 or more) shown as a group. */
export type ListEntry = { kind: 'session'; session: Session } | { kind: 'stack'; key: string; sessions: Session[] }

/**
 * Split a (clustered) list into entries: each run of 2+ adjacent members of one stack becomes a
 * `stack` entry, a lone member stays a plain `session`. Order is kept as given.
 */
export function stackRuns(sessions: Session[]): ListEntry[] {
  const out: ListEntry[] = []
  for (let i = 0; i < sessions.length; ) {
    const k = stackKey(sessions[i])
    let j = i + 1
    while (k && j < sessions.length && stackKey(sessions[j]) === k) j += 1
    if (k && j - i > 1) out.push({ kind: 'stack', key: k, sessions: sessions.slice(i, j) })
    else out.push({ kind: 'session', session: sessions[i] })
    i = j
  }
  return out
}

/**
 * The text Claude Code pre-fills in its prompt (the grey suggestion you accept with Tab), read from a
 * terminal capture: the last `❯ …` line inside the input box (a rule right below it). null when empty.
 */
export function promptSuggestion(capture: string | null | undefined): string | null {
  if (!capture) return null
  const lines = capture.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^\s*❯\s?(.*)$/.exec(lines[i])
    if (!m) continue
    const below = lines.slice(i + 1, i + 3).some((l) => /^[─━]{10,}/.test(l.trim()))
    const text = m[1].trim()
    return below && text ? text : null
  }
  return null
}

const RULE_START_RE = /^[▔─━]{20,}/
const RULE_RE = /^[▔─━]{20,}$/
const TAIL_WINDOW = 60
/** The key hints at the bottom of every Claude Code prompt and dialog. */
const PROMPT_FOOTER_RE = /Esc to (?:cancel|go back|exit)|Enter to (?:select|confirm|continue)|to navigate/i
/** The cursor on a numbered choice: the Submit step of a multi-question prompt has no key hints. */
const PROMPT_CHOICE_RE = /^\s*❯ \d+\. /m

/**
 * What Claude Code shows at the bottom of the terminal while it waits there (a question, a permission
 * prompt, a dialog): from the first full-width rule of the last screenful down, colours kept. null
 * when the screen shows no prompt (no key hints, no choice cursor), e.g. right after it was answered.
 */
export function screenTail(capture: string | null | undefined): string | null {
  if (!capture) return null
  const lines = capture.trimEnd().split('\n').slice(-TAIL_WINDOW)
  const plain = lines.map((l) => stripAnsi(l).trim())
  let end = lines.length
  while (end > 0 && (!plain[end - 1] || RULE_START_RE.test(plain[end - 1]))) end--
  const rule = plain.slice(0, end).findIndex((l) => RULE_RE.test(l))
  const start = rule >= 0 ? rule + 1 : Math.max(0, end - 16)
  const tail = lines.slice(start, end).join('\n').replace(/^(\s*\n)+/, '')
  const plainTail = stripAnsi(tail)
  return PROMPT_FOOTER_RE.test(plainTail) || PROMPT_CHOICE_RE.test(plainTail) ? tail : null
}

export interface WorkingInfo {
  /** Claude Code's spinner word, e.g. `Perambulating…`. */
  verb: string
  /** What the spinner shows in brackets: elapsed time, tokens (no "esc to interrupt"). */
  meta: string | null
  /** The step it is on: the last `⏺ …` line above the spinner (a tool call or a sentence). */
  step: string | null
  /** Its to-do list, when one is shown: done / total and the item in progress. */
  todos: { done: number; total: number; current: string | null } | null
}

const SPINNER_RE = /^[✳✻✶✢✽*·] (\S[^(]*…)\s*(?:\((.*)\))?\s*$/
const TODO_RE = /^\s*(?:⎿\s+)?([☐☒◼□■✔])\s+(.+)$/

/** What a busy session is doing, read from a terminal capture; null when no spinner is on screen. */
export function workingInfo(capture: string | null | undefined): WorkingInfo | null {
  if (!capture) return null
  const lines = capture.split('\n')
  const at = lines.findLastIndex((l) => SPINNER_RE.test(l))
  if (at < 0) return null
  const [, verb, rawMeta] = SPINNER_RE.exec(lines[at])!
  const meta = rawMeta?.split('·').map((p) => p.trim()).filter((p) => p && !/interrupt/i.test(p)).join(' · ') || null
  const stepLine = lines.slice(0, at).findLast((l) => /^⏺ \S/.test(l))
  const step = stepLine ? stepLine.slice(2).trim().slice(0, 140) : null
  const items = lines.slice(at + 1).flatMap((l) => {
    const m = TODO_RE.exec(l)
    return m ? [{ mark: m[1], text: m[2].trim() }] : []
  })
  const todos = items.length
    ? {
        done: items.filter((t) => t.mark === '☒' || t.mark === '✔').length,
        total: items.length,
        current: items.find((t) => t.mark === '◼' || t.mark === '■')?.text ?? null,
      }
    : null
  return { verb: verb.trim(), meta, step, todos }
}
