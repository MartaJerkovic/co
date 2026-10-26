import { useState } from 'react'

import { api, isAbortError } from '@/api/client'
import type { Preview } from '@/api/types'
import { useFleet } from '@/hooks/useFleet'
import { usePoller } from '@/hooks/usePoller'
import { useSettings } from '@/hooks/useSettings'
import { spaceDir, spaceOf } from '@/lib/spaces'

const POLL_MS = 5000

/**
 * The servers a session started (`…/previews`), looked up every few seconds, in a space that offers
 * them (`previews: true`); [] for any other session, and for one on another host (its localhost is not this machine's).
 */
export function usePreviews(host: string, id: string, cwd: string | null | undefined): Preview[] {
  const { fleet } = useFleet()
  const space = spaceOf(useSettings().spaces, fleet, host, cwd)
  const enabled = host === fleet?.self && !!space?.previews
  // A session at the space's root shares that directory with the others: only its own processes count.
  const treeOnly = !!cwd && cwd.replace(/\/+$/, '') === spaceDir(fleet, host, space ?? undefined)?.replace(/\/+$/, '')
  const [previews, setPreviews] = useState<Preview[]>([])
  usePoller(
    async (signal) => {
      try {
        const data = await api.previews(host, id, treeOnly, { signal })
        const next = Array.isArray(data.previews) ? data.previews : []
        setPreviews((prev) => (prev.map((p) => p.port).join() === next.map((p) => p.port).join() ? prev : next))
      } catch (err) {
        if (isAbortError(err)) throw err
        setPreviews([])
      }
    },
    POLL_MS,
    { enabled },
  )
  return enabled ? previews : []
}
