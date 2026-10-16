import { useCallback, useRef, useState } from 'react'

import { ApiError, api, sessionErrorMessage } from '@/api/client'
import type { DiffResponse } from '@/api/types'
import { usePoller } from '@/hooks/usePoller'

/** The diff follows the session live: a poll is one `git add` into a throwaway index, and an unchanged tree answers in a few bytes. */
export const DIFF_POLL_MS = 2_000

function diffError(err: unknown): string {
  if (err instanceof ApiError && err.status === 404 && err.message === 'not found') return 'This host’s fleet web server predates the diff reviewer — update and restart it'
  if (err instanceof ApiError && err.status === 409) return err.message === 'not a git repository' ? 'The session’s folder is not a git checkout' : err.message
  return sessionErrorMessage(err)
}

/**
 * A session's diff, polled with `since=<fingerprint>` so nothing re-renders while nothing moved.
 * `changedAt`: when the files last changed (for the "updated" hint).
 */
export function useDiff(host: string, id: string, { base = null }: { base?: string | null } = {}) {
  const [data, setData] = useState<{ key: string; diff: DiffResponse } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [changedAt, setChangedAt] = useState<number | null>(null)
  const last = useRef<{ key: string; fingerprint: string } | null>(null)
  const key = `${host}/${id}/${base ?? ''}`

  const poll = useCallback(
    async (signal: AbortSignal) => {
      const since = last.current?.key === key ? last.current.fingerprint : null
      try {
        const r = await api.diff(host, id, { base, since }, { signal })
        setError(null)
        if (r.unchanged && since) return
        last.current = { key, fingerprint: r.fingerprint }
        setData({ key, diff: r })
        setChangedAt(Date.now())
      } catch (err) {
        if (signal.aborted) throw err
        setError(diffError(err))
      }
    },
    [host, id, base, key],
  )
  const refresh = usePoller(poll, DIFF_POLL_MS)
  return { data: data?.key === key ? data.diff : null, error, changedAt, refresh }
}
