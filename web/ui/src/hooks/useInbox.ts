import { useCallback, useState } from 'react'

import { api, isAbortError } from '@/api/client'
import type { InboxResponse } from '@/api/types'
import { usePoller } from '@/hooks/usePoller'

const POLL_MS = 30_000
// While a Slack & email scan runs, look again sooner to pick up its result.
const SCAN_POLL_MS = 10_000

// Last answer, kept across remounts so reopening the screen paints at once.
let last: InboxResponse | null = null

/** The live inbox (GET /api/inbox), polled while shown. `refresh` = Scan now, `dismiss` = done. */
export function useInbox() {
  const [data, setData] = useState<InboxResponse | null>(last)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(last == null)
  const [refreshing, setRefreshing] = useState(false)

  const take = useCallback((d: InboxResponse) => {
    last = d
    setData(d)
    setError(null)
  }, [])

  const scanning = Boolean(data?.sources.comms?.running)
  const reload = usePoller(
    async (signal) => {
      try {
        take(await api.inbox({ signal }))
      } catch (err) {
        if (isAbortError(err)) throw err
        setError((err as Error)?.message || 'could not load the inbox')
      } finally {
        setLoading(false)
      }
    },
    scanning ? SCAN_POLL_MS : POLL_MS,
  )

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      take(await api.refreshInbox())
    } catch (err) {
      setError((err as Error)?.message || 'refresh failed')
    } finally {
      setRefreshing(false)
    }
  }, [take])

  // Done: gone from the list at once; the server's answer (or the next poll) settles it.
  const dismiss = useCallback(
    async (id: string) => {
      if (last) take({ ...last, items: last.items.filter((i) => i.id !== id) })
      try {
        take(await api.dismissInbox(id))
      } catch (err) {
        setError((err as Error)?.message || 'could not mark it done')
        reload()
      }
    },
    [take, reload],
  )

  return { data, error, loading, refresh, refreshing, reload, dismiss }
}
