import { useState } from 'react'

import type { Session } from '@/api/types'
import { isJobSession } from '@/lib/sessions'
import { sessionKey } from '@/lib/shortcuts'
import { storage } from '@/lib/storage'

const SEEN_KEY = 'fleet.seenTurns'
const TURN_SINCE_KEY = 'fleet.turnSince'
const OPENED_KEY = 'fleet.botsOpened'
const SINCE_KEY = 'fleet.botsSince'
/** Bot runs that finished this long before the first launch with this list count as read. */
const BOTS_BACKLOG_MS = 2 * 60 * 60 * 1000
/** Opened bot runs remembered (newest kept); runs are closed after a day, so this is plenty. */
const OPENED_MAX = 500
/** Sessions whose last seen turn is remembered (newest kept). */
const SEEN_MAX = 500

function load(key: string): Set<string> {
  try {
    const raw = storage.get(key)
    const v = raw ? (JSON.parse(raw) as unknown) : null
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

function loadSeen(): Map<string, number> {
  try {
    const raw = storage.get(SEEN_KEY)
    const v = raw ? (JSON.parse(raw) as unknown) : null
    return new Map(v && typeof v === 'object' ? Object.entries(v).filter((e): e is [string, number] => typeof e[1] === 'number') : [])
  } catch {
    return new Map()
  }
}

/** The first launch with this list: turns that finished before it count as seen. */
function firstLaunch(key: string, backlogMs = 0): number {
  const stored = Number(storage.get(key))
  if (stored > 0) return stored
  const since = Date.now() - backlogMs
  storage.set(key, String(since))
  return since
}

/**
 * Sessions whose turn is yours: Claude is asking you something, or it finished a turn after the
 * last one you saw. A finish is the session's `turn_ended_at` (from its transcript, so it survives
 * a reload or a server restart); a session without one (another harness) counts a busy → idle
 * seen here. The open session's turn is seen only while Fleet is in front.
 * A bot run is one result to read, so a finished run you haven't opened is yours even when it
 * finished while Fleet was closed.
 */
export function useSeen(sessions: Session[], selectedKey: string | null) {
  // Derived while rendering (React's "adjust state when a prop changes"): no effect, no extra pass.
  const [track, setTrack] = useState<{ sessions: Session[] | null; selected: string | null; status: Map<string, string>; observed: Map<string, number>; seen: Map<string, number> }>(() => ({
    sessions: null,
    selected: null,
    status: new Map(),
    observed: new Map(),
    seen: loadSeen(),
  }))
  const [since] = useState(() => firstLaunch(TURN_SINCE_KEY))
  const [bots] = useState(() => ({ opened: load(OPENED_KEY), since: firstLaunch(SINCE_KEY, BOTS_BACKLOG_MS) }))
  if (track.sessions !== sessions || track.selected !== selectedKey) {
    const status = new Map<string, string>()
    const observed = new Map(track.observed)
    let seen = track.seen
    for (const s of sessions) {
      const k = sessionKey(s)
      const now = String(s.status ?? '')
      if (track.status.get(k) === 'busy' && now === 'idle') observed.set(k, s.updated_at ?? 0)
      status.set(k, now)
      const looking = k === selectedKey && typeof document !== 'undefined' && document.hasFocus()
      if (!looking) continue
      const ended = s.turn_ended_at ?? observed.get(k) ?? 0
      if (ended > (seen.get(k) ?? 0)) {
        seen = new Map(seen)
        seen.delete(k)
        seen.set(k, ended)
        storage.set(SEEN_KEY, JSON.stringify(Object.fromEntries([...seen].slice(-SEEN_MAX))))
      }
      if (isJobSession(s) && !bots.opened.has(k)) {
        bots.opened.add(k)
        storage.set(OPENED_KEY, JSON.stringify([...bots.opened].slice(-OPENED_MAX)))
      }
    }
    setTrack({ sessions, selected: selectedKey, status, observed, seen })
  }
  const finishedUnseen = (s: Session) => {
    const k = sessionKey(s)
    return (s.turn_ended_at ?? track.observed.get(k) ?? 0) > Math.max(since, track.seen.get(k) ?? 0)
  }
  const unreadRun = (s: Session) => isJobSession(s) && (s.updated_at ?? 0) > bots.since && !bots.opened.has(sessionKey(s))
  const yourTurn = (s: Session) => s.status === 'waiting' || (s.status === 'idle' && (finishedUnseen(s) || unreadRun(s)))
  return { yourTurn }
}
