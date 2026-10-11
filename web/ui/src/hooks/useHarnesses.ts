import { useEffect, useState } from 'react'

import { api } from '@/api/client'
import type { HarnessInfo } from '@/api/types'

// One answer per host per page load (the server caches its own for 10 minutes): the list only
// changes when a harness is installed, and `pi --list-models` behind it is slow.
const cache = new Map<string, Promise<HarnessInfo[] | null>>()

function load(host: string): Promise<HarnessInfo[] | null> {
  let p = cache.get(host)
  if (!p) {
    // An older server (404) or a host that can't answer: Claude alone, from the caller's fallback.
    p = api.harnesses(host).then(
      (r) => (Array.isArray(r.harnesses) ? r.harnesses : null),
      () => {
        cache.delete(host)
        return null
      },
    )
    cache.set(host, p)
  }
  return p
}

/** What `host` can spawn (GET /api/hosts/:host/harnesses); null while loading or unknown. */
export function useHarnesses(host: string | null | undefined): HarnessInfo[] | null {
  const [state, setState] = useState<{ host: string; rows: HarnessInfo[] | null } | null>(null)
  useEffect(() => {
    if (!host) return
    let live = true
    void load(host).then((rows) => {
      if (live) setState({ host, rows })
    })
    return () => {
      live = false
    }
  }, [host])
  return state && state.host === host ? state.rows : null
}
