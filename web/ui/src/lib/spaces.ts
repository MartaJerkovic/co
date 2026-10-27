import type { DormantView, FleetResponse, Session, Space } from '@/api/types'

/**
 * Spaces (config `web.spaces`): places kept apart from the work sessions. A space is the Start
 * directory with its label; a session started from a space (`space`, the pane's `@fleet_space`) belongs
 * to it, and every other session and bot whose directory is in it (or beneath it) does too.
 */

const home = (p: string) => p.replace(/^\/(?:Users|home)\/[^/]+/, '~').replace(/\/+$/, '')

/** `#/space/<id>`. */
export const spaceHref = (id: string) => `#/space/${id}`

/** The host's directory for `space` (absolute), null when its Start directories have none. */
export function spaceDir(fleet: FleetResponse | null | undefined, host: string | null | undefined, space: Space | undefined): string | null {
  if (!space) return null
  return fleet?.hosts?.find((h) => h.name === host)?.spawnDirs?.find((d) => d.label === space.label)?.path ?? null
}

/** The space a directory on `host` belongs to (a session's cwd, a bot's dir), null for none. */
export function spaceOf(spaces: Space[], fleet: FleetResponse | null | undefined, host: string | null | undefined, dir: string | null | undefined): Space | null {
  if (!dir) return null
  const d = home(dir)
  for (const s of spaces) {
    const root = spaceDir(fleet, host, s)
    if (root && (d === home(root) || d.startsWith(`${home(root)}/`))) return s
  }
  return null
}

/** The space a session belongs to: the one it was started from, else the one its directory is in. */
export function sessionSpace(spaces: Space[], fleet: FleetResponse | null | undefined, s: Pick<Session, 'host' | 'cwd' | 'space'>): Space | null {
  return spaces.find((x) => x.id === s.space) ?? spaceOf(spaces, fleet, s.host, s.cwd)
}

/** Where a closed (or dormant) entry on `host` is listed: like its live sessions, its space first, then Bots for a bot run. */
export function closedPlace(spaces: Space[], fleet: FleetResponse | null | undefined, host: string, v: Pick<DormantView, 'sessions'>): 'bots' | Space | null {
  const sessions = v.sessions ?? []
  for (const s of sessions) {
    const space = sessionSpace(spaces, fleet, { host, cwd: s.cwd, space: s.space })
    if (space) return space
  }
  return sessions.some((s) => s.job) ? 'bots' : null
}
