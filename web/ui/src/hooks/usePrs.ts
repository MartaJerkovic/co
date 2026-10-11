import { useCallback, useMemo, useReducer, useState } from 'react'

import { ApiError, api, isAbortError } from '@/api/client'
import type { PrsResponse } from '@/api/types'
import { useFleet } from '@/hooks/useFleet'
import { usePersistentState } from '@/hooks/usePersistentState'
import { usePoller } from '@/hooks/usePoller'

// The CLI refetches once its cache is older than `prs.refresh` (5m); polling reads the cache.
const POLL_MS = 60_000

// Last answer per host, kept across remounts so reopening the page paints at once.
const last = new Map<string, PrsResponse>()

/**
 * The PRs that need you, as one host's `gh` sees them (its login, its checkouts for
 * `local`). Default host: the one this UI is served from; the choice is remembered.
 */
export function usePrs() {
  const { fleet } = useFleet()
  const hosts = useMemo(() => (fleet?.hosts ?? []).filter((h) => h.ok).map((h) => h.name), [fleet])
  const [picked, setHost] = usePersistentState<string>('fleet.prsHost', '')
  const host = hosts.includes(picked) ? picked : (fleet?.self ?? hosts[0] ?? null)

  // Answers live in `last` (per host); `errors` holds each host's last failure (null = ok).
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  const data = host ? (last.get(host) ?? null) : null
  const error = host ? (errors[host] ?? null) : null
  const loading = !!host && !data && !(host in errors)

  const load = useCallback(
    async (signal: AbortSignal, refresh = false) => {
      if (!host) return
      try {
        const r = await api.prs(host, { signal, refresh })
        last.set(host, r)
        bump()
        setErrors((e) => ({ ...e, [host]: null }))
      } catch (err) {
        if (isAbortError(err)) throw err
        // 404/501: that host's server or CLI predates `fleet prs`.
        const old = err instanceof ApiError && (err.status === 404 || err.status === 501)
        const msg = old ? `${host} runs an older fleet — update it to see pull requests` : (err as Error)?.message || 'could not load pull requests'
        setErrors((e) => ({ ...e, [host]: msg }))
      }
    },
    [host],
  )

  const poll = usePoller((signal) => load(signal).catch(() => {}), POLL_MS, { enabled: !!host })
  const [refreshing, setRefreshing] = useState(false)
  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await load(new AbortController().signal, true)
    } catch {
      poll()
    } finally {
      setRefreshing(false)
    }
  }, [load, poll])

  // `reload`: read again now (the CLI's cache — cheap; re-joins the local worktrees).
  return { hosts, host, setHost, data, error, loading, refresh, refreshing, reload: poll }
}
