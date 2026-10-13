import { useEffect, useState } from 'react'

import { api } from '@/api/client'
import type { CompleteKind, CompleteResponse } from '@/api/types'

// One list per session + kind, reused while it is fresh: the popup filters it as you type.
const TTL_MS = 30 * 1000
const cache = new Map<string, { at: number; p: Promise<CompleteResponse> }>()

function load(host: string, id: string, kind: CompleteKind): Promise<CompleteResponse> {
  const key = `${host}\u0000${id}\u0000${kind}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.p
  const p = api.complete(host, id, kind)
  p.catch(() => cache.delete(key))
  cache.set(key, { at: Date.now(), p })
  return p
}

export interface Completions {
  data: CompleteResponse | null
  loading: boolean
  error: string | null
}

/** The `kind` list for a session (GET …/sessions/:id/complete); idle while `kind` is null. */
export function useCompletions(host: string, id: string | undefined, kind: CompleteKind | null): Completions {
  const [state, setState] = useState<{ key: string; data: CompleteResponse | null; error: string | null } | null>(null)
  const key = id && kind ? `${host}\u0000${id}\u0000${kind}` : null
  useEffect(() => {
    if (!id || !kind || !key) return
    let live = true
    load(host, id, kind).then(
      (data) => live && setState({ key, data, error: null }),
      (err: unknown) => live && setState({ key, data: null, error: err instanceof Error ? err.message : String(err) }),
    )
    return () => {
      live = false
    }
  }, [host, id, kind, key])
  if (!key) return { data: null, loading: false, error: null }
  if (state?.key !== key) return { data: null, loading: true, error: null }
  return { data: state.data, loading: false, error: state.error }
}
