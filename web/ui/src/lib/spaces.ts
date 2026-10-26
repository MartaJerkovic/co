import type { FleetResponse, Space } from '@/api/types'

/**
 * Spaces (config `web.spaces`): places kept apart from the work sessions. A space is the Start
 * directory with its label; every session and bot whose directory is in it (or beneath it) belongs to it.
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
