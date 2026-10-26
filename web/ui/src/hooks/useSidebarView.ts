import type { Session } from '@/api/types'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useSeen } from '@/hooks/useSeen'
import { sessionKey } from '@/lib/shortcuts'

/** Idle with no activity for this long: folded away so the list keeps only recent work. */
const STALE_MS = 24 * 60 * 60 * 1000

export const isStale = (s: Session, now: number) => s.status === 'idle' && !!s.updated_at && now - s.updated_at > STALE_MS

const parseFlag = (r: string) => (r === '1' || r === '0' ? r : undefined)

/**
 * What the desktop sidebar lists, shared with the shell so j/k walk exactly the rows on screen:
 * All / Your turn, recent sessions first and the long-idle ones in a fold below.
 */
export function useSidebarView(sessions: Session[], selectedKey: string | null, now: number, query: string, pool: Session[] = sessions) {
  const [idleRaw, setIdleOpen] = usePersistentState<string>('fleet.idleOpen', '0', parseFlag)
  const [turnRaw, setTurn] = usePersistentState<string>('fleet.yourTurn', '0', parseFlag)
  const idleOpen = idleRaw === '1'
  const turnOnly = turnRaw === '1'
  // Seen-tracking covers every session (bots too), so their counts survive switching lists.
  const { yourTurn } = useSeen(pool, selectedKey)
  // Your turn: asking you, or a finished reply you haven't opened — not sessions quiet for a day.
  const isTurn = (x: Session) => yourTurn(x) && !isStale(x, now)
  const turnCount = sessions.filter((x) => isTurn(x) && sessionKey(x) !== selectedKey).length
  // In "Your turn", the open session stays listed even once seen, so it does not vanish under you.
  const shown = turnOnly ? sessions.filter((x) => isTurn(x) || sessionKey(x) === selectedKey) : sessions
  const fresh = shown.filter((x) => !isStale(x, now))
  const stale = shown.filter((x) => isStale(x, now))
  const staleOpen = idleOpen || !!query || stale.some((x) => sessionKey(x) === selectedKey)
  return {
    turnOnly,
    turnCount,
    isTurn,
    setTurnOnly: (v: boolean) => setTurn(v ? '1' : '0'),
    idleOpen,
    toggleIdle: () => setIdleOpen(idleOpen ? '0' : '1'),
    shown,
    fresh,
    stale,
    staleOpen,
    /** The rows on screen, in order. */
    visible: staleOpen ? [...fresh, ...stale] : fresh,
  }
}

export type SidebarView = ReturnType<typeof useSidebarView>
