import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useLocation } from 'wouter'

import { useMemoRecorder } from '@/hooks/useMemos'
import { useNow } from '@/hooks/useNow'
import { useSettings } from '@/hooks/useSettings'
import { initMemoRecorder, startRecording } from '@/lib/memoRecorder'
import { formatDuration, memoHref } from '@/lib/memos'
import { cn } from '@/lib/utils'

/** Mounted once: recovers unsaved recordings from an earlier run and announces each saved memo. */
export function MemoRecorderHost() {
  const { memos } = useSettings()
  const { savedTick, lastSaved } = useMemoRecorder()
  const [, navigate] = useLocation()
  const seen = useRef(savedTick)

  useEffect(() => {
    if (memos) initMemoRecorder()
  }, [memos])

  useEffect(() => {
    if (savedTick === seen.current || !lastSaved) return
    seen.current = savedTick
    toast.success(`Saved: ${lastSaved.title}`, {
      description: lastSaved.status === 'partial' ? 'Part of it is not transcribed yet — open it to retry.' : undefined,
      action: { label: 'Open', onClick: () => navigate(memoHref(lastSaved.id).slice(1)) },
    })
  }, [savedTick, lastSaved, navigate])

  return null
}

/**
 * The mobile list's record button (above the operator's mic): one tap starts recording and opens
 * the memos screen; while recording it is a red pill with the time, back to that screen.
 */
export function MemoRecordFab({ raised }: { raised: boolean }) {
  const { memos } = useSettings()
  const { phase, startedAt } = useMemoRecorder()
  const [, navigate] = useLocation()
  const now = useNow(phase === 'recording' ? 1000 : 60_000)
  if (!memos) return null

  const pos = cn(
    'fixed right-[max(1rem,env(safe-area-inset-right))] z-30 shadow-lg transition-transform active:scale-95',
    raised ? 'bottom-[max(5.75rem,calc(env(safe-area-inset-bottom)+5rem))]' : 'bottom-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.5rem))]',
  )

  if (phase === 'recording' && startedAt) {
    return (
      <a href="#/memos" aria-label="Recording — open memos" className={cn(pos, 'flex h-14 items-center gap-2 rounded-full bg-destructive px-5 font-semibold text-white tabular-nums')}>
        <span className="size-2.5 animate-pulse rounded-full bg-white" />
        {formatDuration((now - startedAt) / 1000)}
      </a>
    )
  }

  const start = async () => {
    navigate('/memos')
    try {
      await startRecording()
    } catch (err) {
      toast.error((err as Error)?.message || 'Could not start recording')
    }
  }
  return (
    <button
      type="button"
      aria-label="Record a memo"
      title="Record a memo"
      disabled={phase === 'starting'}
      onClick={() => void start()}
      className={cn(pos, 'grid size-14 place-items-center rounded-full border bg-background disabled:opacity-60')}
    >
      <span className="size-5 rounded-full bg-destructive" />
    </button>
  )
}
