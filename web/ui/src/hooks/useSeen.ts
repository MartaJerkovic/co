import { useState } from 'react'

import type { Session } from '@/api/types'
import { isJobSession } from '@/lib/sessions'
import { sessionKey } from '@/lib/shortcuts'
import { storage } from '@/lib/storage'

const KEY = 'fleet.turn'
const OPENED_KEY = 'fleet.botsOpened'
const SINCE_KEY = 'fleet.botsSince'
/** Bot runs that finished this long before the first launch with this list count as read. */
const BOTS_BACKLOG_MS = 2 * 60 * 60 * 1000
/** Opened bot runs remembered (newest kept); runs are closed after a day, so this is plenty. */
const OPENED_MAX = 500

function load(key = KEY): Set<string> {
  try {
    const raw = storage.get(key)
    const v = raw ? (JSON.parse(raw) as unknown) : null
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

function botsSince(): number {
  const stored = Number(storage.get(SINCE_KEY))
  if (stored > 0) return stored
  const since = Date.now() - BOTS_BACKLOG_MS
  storage.set(SINCE_KEY, String(since))
  return since
}

/**
 * Sessions whose turn is yours: Claude is asking you something, or it finished working (busy → idle,
 * seen here) and you haven't opened it since. Watching the finish rather than a timestamp keeps a
 * session out when Claude Code only touches its file (an idle compaction, a status write).
 * A bot run is one result to read, so a finished run you haven't opened is yours even when it
 * finished while Fleet was closed.
 */
export function useSeen(sessions: Session[], selectedKey: string | null) {
  // Derived while rendering (React's "adjust state when a prop changes"): no effect, no extra pass.
  const [track, setTrack] = useState<{ sessions: Session[] | null; selected: string | null; status: Map<string, string>; pending: Set<string> }>(() => ({
    sessions: null,
    selected: null,
    status: new Map(),
    pending: load(),
  }))
  const [bots] = useState(() => ({ opened: load(OPENED_KEY), since: botsSince() }))
  if (track.sessions !== sessions || track.selected !== selectedKey) {
    const pending = new Set(track.pending)
    const status = new Map<string, string>()
    for (const s of sessions) {
      const k = sessionKey(s)
      const now = String(s.status ?? '')
      // The open session counts as seen only while Fleet is in front; one that finishes while you
      // are in another app is still your turn.
      const looking = k === selectedKey && typeof document !== 'undefined' && document.hasFocus()
      if (looking) {
        pending.delete(k)
        if (isJobSession(s) && !bots.opened.has(k)) {
          bots.opened.add(k)
          storage.set(OPENED_KEY, JSON.stringify([...bots.opened].slice(-OPENED_MAX)))
        }
      } else if (track.status.get(k) === 'busy' && now === 'idle') pending.add(k)
      status.set(k, now)
    }
    const changed = pending.size !== track.pending.size || [...pending].some((k) => !track.pending.has(k))
    if (changed) storage.set(KEY, JSON.stringify([...pending]))
    setTrack({ sessions, selected: selectedKey, status, pending: changed ? pending : track.pending })
  }
  const pending = track.pending
  const unreadRun = (s: Session) => isJobSession(s) && (s.updated_at ?? 0) > bots.since && !bots.opened.has(sessionKey(s))
  const yourTurn = (s: Session) => s.status === 'waiting' || (s.status === 'idle' && (pending.has(sessionKey(s)) || unreadRun(s)))
  return { yourTurn }
}
