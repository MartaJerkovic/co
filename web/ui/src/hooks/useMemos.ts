import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

import { api } from '@/api/client'
import type { Memo, MemoSummary } from '@/api/types'
import { memoRecorder } from '@/lib/memoRecorder'

/** The app-wide memo recorder's state (lib/memoRecorder.ts). */
export const useMemoRecorder = () => useSyncExternalStore(memoRecorder.subscribe, memoRecorder.snapshot, memoRecorder.snapshot)

/** GET /api/memos, reloaded whenever a recording is saved. */
export function useMemoList() {
  const { savedTick } = useMemoRecorder()
  const [memos, setMemos] = useState<MemoSummary[] | null>(null)
  const [dir, setDir] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [epoch, setEpoch] = useState(0)

  useEffect(() => {
    const ctl = new AbortController()
    api
      .memos({ signal: ctl.signal })
      .then((r) => {
        setMemos(r.memos)
        setDir(r.dir)
        setError(null)
      })
      .catch((err) => {
        if (!ctl.signal.aborted) setError((err as Error)?.message || 'could not load memos')
      })
    return () => ctl.abort()
  }, [savedTick, epoch])

  const reload = useCallback(() => setEpoch((n) => n + 1), [])
  return { memos, dir, error, reload, setMemos }
}

/** GET /api/memos/:id (null while loading); key the caller by id. */
export function useMemoDetail(id: string) {
  const [memo, setMemo] = useState<Memo | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const ctl = new AbortController()
    api
      .memo(id, { signal: ctl.signal })
      .then(setMemo)
      .catch((err) => {
        if (!ctl.signal.aborted) setError((err as Error)?.message || 'could not load the memo')
      })
    return () => ctl.abort()
  }, [id])
  return { memo, error, setMemo }
}
