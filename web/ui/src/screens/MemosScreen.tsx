import { useEffect, useRef, useState } from 'react'
import { BotIcon, ChevronLeftIcon, CloudUploadIcon, CopyIcon, FolderIcon, Loader2Icon, MicIcon, RefreshCwIcon, SquareIcon, Trash2Icon, TriangleAlertIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Link, useLocation } from 'wouter'

import type { Memo, MemoSummary } from '@/api/types'
import { api } from '@/api/client'
import { InlineEdit } from '@/components/InlineEdit'
import { Markdown } from '@/components/Markdown'
import { NewSessionDialog, NewSessionDrawer } from '@/components/NewSessionDrawer'
import { ScreenHeader } from '@/components/ScreenHeader'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { useMemoDetail, useMemoList, useMemoRecorder } from '@/hooks/useMemos'
import { useNow } from '@/hooks/useNow'
import { useSettings } from '@/hooks/useSettings'
import { useSwipeBack } from '@/hooks/useSwipeBack'
import { copyWithToast } from '@/lib/clipboard'
import { discardPending, drain, inputLevel, startRecording, stopRecording } from '@/lib/memoRecorder'
import type { PendingRecording } from '@/lib/memoStore'
import { formatDuration, memoHref, memoSessionPrompt, memoWhen, parseMemosLocation } from '@/lib/memos'
import { cn } from '@/lib/utils'

/**
 * `#/memos`: record a conversation (one big button), see it saved as a titled transcript, and the
 * list of memos; `#/memos/<id>`: one memo. `screen` = the mobile page, `pane` = the desktop pane.
 */
export function MemosScreen({ layout = 'screen' }: { layout?: 'screen' | 'pane' }) {
  const pane = layout === 'pane'
  const [location, navigate] = useLocation()
  const id = parseMemosLocation(location)?.id ?? null

  const back = () => {
    if (id) return navigate('/memos', { replace: !pane })
    if (!pane && window.history.length > 1) window.history.back()
    else navigate('/', { replace: !pane })
  }
  const screenRef = useRef<HTMLDivElement>(null)
  useSwipeBack(screenRef, back, !pane)

  const body = id ? <MemoDetail key={id} id={id} onDeleted={() => navigate('/memos', { replace: true })} /> : <MemosHome />
  const title = id ? 'Memo' : 'Voice memos'

  if (pane) {
    return (
      <section aria-label="Voice memos" className="flex h-full min-w-0 flex-1 flex-col bg-background">
        <header data-tauri-drag-region="deep" className="titlebar titlebar-lead flex shrink-0 items-center gap-1 border-b py-1.5 pr-2 pl-4 [--titlebar-pad:1rem]">
          {id ? (
            <Button variant="ghost" size="icon" aria-label="All memos" title="All memos" onClick={back} className="-ml-2 size-11 shrink-0 rounded-xl">
              <ChevronLeftIcon className="size-5" />
            </Button>
          ) : null}
          <h1 className="flex min-w-0 flex-1 items-center gap-1.5 text-[0.9375rem] leading-tight font-bold">
            {id ? null : <MicIcon className="size-4 text-muted-foreground" />} {title}
          </h1>
          <Button variant="ghost" size="icon" aria-label="Close memos" title="Close (Esc)" onClick={() => navigate('/')} className="size-11 shrink-0 rounded-xl">
            <XIcon className="size-5" />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
      </section>
    )
  }

  return (
    <div ref={screenRef} className="flex min-h-app flex-col bg-background">
      <ScreenHeader>
        <div className="-ml-2 flex min-h-8 items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Back" onClick={back} className="-my-1.5 size-11 shrink-0 rounded-xl">
            <ChevronLeftIcon className="size-6" />
          </Button>
          <h1 className="flex-1 text-xl font-bold tracking-tight">{title}</h1>
        </div>
      </ScreenHeader>
      {body}
    </div>
  )
}

const wrap = 'mx-auto w-full max-w-lg px-4 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:max-w-2xl'

function MemosHome() {
  const { memos, dir, error, reload } = useMemoList()
  const { pending, recId } = useMemoRecorder()
  const settings = useSettings()
  const now = useNow(60_000)
  const waiting = pending.filter((p) => p.recId !== recId)

  return (
    <div className={cn(wrap, 'space-y-4')}>
      {settings.loaded && !settings.memos ? (
        <p className="rounded-xl border border-status-waiting/40 p-3 text-sm text-muted-foreground">
          This server has no transcription key, so memos are off. Set <span className="font-mono">OPENAI_SPEECH_TO_TEXT_API_KEY</span> there (env or Keychain).
        </p>
      ) : (
        <RecorderCard />
      )}

      {waiting.length ? (
        <ul className="space-y-2" aria-label="Saving">
          {waiting.map((p) => (
            <PendingRow key={p.recId} rec={p} />
          ))}
        </ul>
      ) : null}

      {error ? (
        <p className="flex items-center gap-2 text-sm text-destructive">
          {error}
          <Button variant="ghost" size="icon-sm" aria-label="Retry" onClick={reload}>
            <RefreshCwIcon />
          </Button>
        </p>
      ) : null}

      {memos == null && !error ? (
        <div className="space-y-2 rounded-xl border p-4">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-full" />
        </div>
      ) : null}

      {memos?.length ? (
        <ul className="space-y-2">
          {memos.map((m) => (
            <MemoRow key={m.id} memo={m} now={now} />
          ))}
        </ul>
      ) : memos && !waiting.length ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No memos yet. Tap record when a conversation is worth keeping.</p>
      ) : null}

      {dir ? (
        <p className="text-xs break-all text-dimmer">
          Saved as markdown in <span className="font-mono">{dir}</span>
        </p>
      ) : null}
    </div>
  )
}

/** The big record / stop button with the elapsed time and an input meter. */
function RecorderCard() {
  const { phase, startedAt } = useMemoRecorder()
  const now = useNow(phase === 'recording' ? 500 : 60_000)
  const recording = phase === 'recording'

  const toggle = async () => {
    if (recording) return void stopRecording()
    try {
      await startRecording()
    } catch (err) {
      toast.error((err as Error)?.message || 'Could not start recording')
    }
  }

  return (
    <div className={cn('flex flex-col items-center gap-3 rounded-2xl border p-5 transition-colors', recording && 'border-destructive/40 bg-destructive/5')}>
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={phase === 'starting'}
        aria-label={recording ? 'Stop and save' : 'Record a memo'}
        className={cn(
          'grid size-20 place-items-center rounded-full shadow-lg transition-transform active:scale-95 disabled:opacity-60',
          recording ? 'bg-foreground text-background' : 'bg-destructive text-white',
        )}
      >
        {phase === 'starting' ? <Loader2Icon className="size-8 animate-spin" /> : recording ? <SquareIcon className="size-7 fill-current" /> : <span className="size-7 rounded-full bg-white" />}
      </button>
      {recording && startedAt ? (
        <>
          <div className="flex items-center gap-2 text-2xl font-semibold tabular-nums">
            <span className="size-2.5 animate-pulse rounded-full bg-destructive" />
            {formatDuration((now - startedAt) / 1000)}
          </div>
          <LevelMeter />
          <p className="text-center text-xs text-muted-foreground">Uploaded as you go. Keep the app open — tap stop to save.</p>
        </>
      ) : (
        <p className="text-center text-sm text-muted-foreground">{phase === 'starting' ? 'Starting the mic…' : 'Record a conversation — it is transcribed, titled and saved.'}</p>
      )}
    </div>
  )
}

function LevelMeter() {
  const bar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let id = 0
    let smooth = 0
    const tick = () => {
      smooth = Math.max(inputLevel(), smooth * 0.85)
      if (bar.current) bar.current.style.transform = `scaleX(${Math.max(0.02, smooth)})`
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [])
  return (
    <div className="h-1.5 w-40 overflow-hidden rounded-full bg-muted" aria-hidden>
      <div ref={bar} className="h-full origin-left rounded-full bg-destructive transition-transform duration-75" />
    </div>
  )
}

function PendingRow({ rec }: { rec: PendingRecording }) {
  const [confirm, setConfirm] = useState(false)
  const stopped = rec.stoppedAt != null
  const dur = formatDuration(((rec.stoppedAt ?? rec.heartbeat) - rec.startedAt) / 1000)
  return (
    <li className="flex items-center gap-3 rounded-xl border border-dashed p-3">
      {rec.error ? <TriangleAlertIcon className="size-4 shrink-0 text-status-waiting" /> : <CloudUploadIcon className="size-4 shrink-0 animate-pulse text-muted-foreground" />}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">
          {rec.error ? 'Not saved yet' : stopped ? 'Saving…' : 'Recording interrupted — saving'} · {dur}
        </div>
        <div className="truncate text-xs text-muted-foreground">{rec.error ? `${rec.error} — kept on this device, retrying` : 'Transcribing and naming it'}</div>
      </div>
      {rec.error ? (
        <>
          <Button variant="ghost" size="icon-sm" aria-label="Retry now" title="Retry now" onClick={() => void drain(rec.recId)}>
            <RefreshCwIcon />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Discard" title="Discard" onClick={() => setConfirm(true)}>
            <Trash2Icon />
          </Button>
        </>
      ) : null}
      {confirm ? (
        <Dialog open onOpenChange={(o) => !o && setConfirm(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Discard this recording?</DialogTitle>
              <DialogDescription>Its audio is only on this device ({dur}); it will be gone for good.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirm(false)}>
                Keep
              </Button>
              <Button variant="destructive" onClick={() => void discardPending(rec.recId).then(() => setConfirm(false))}>
                Discard
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </li>
  )
}

function MemoRow({ memo: m, now }: { memo: MemoSummary; now: number }) {
  const meta = [memoWhen(m.created, now), formatDuration(m.durationSec), m.words ? `${m.words} words` : null].filter(Boolean).join(' · ')
  return (
    <li>
      <Link href={memoHref(m.id).slice(1)} className="block rounded-xl border p-3 transition-colors hover:bg-muted/50 active:bg-muted">
        <div className="flex items-start gap-2">
          <h2 className="min-w-0 flex-1 text-[0.9375rem] leading-snug font-semibold">{m.title}</h2>
          {m.status === 'partial' ? <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-status-waiting" aria-label="Not fully transcribed" /> : null}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">{meta}</div>
        {m.preview ? <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{m.preview}</p> : null}
      </Link>
    </li>
  )
}

function MemoDetail({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const { memo, error, setMemo } = useMemoDetail(id)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState<'retry' | 'delete' | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [spawnOpen, setSpawnOpen] = useState(false)
  const { self } = useSettings()
  const desktop = useIsDesktop()
  const [, navigate] = useLocation()

  if (error) return <p className={cn(wrap, 'text-sm text-destructive')}>{error}</p>
  if (!memo) {
    return (
      <div className={cn(wrap, 'space-y-2')}>
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="mt-4 h-24 w-full" />
      </div>
    )
  }

  const rename = async (title: string) => {
    setEditing(false)
    const t = title.trim()
    if (!t || t === memo.title) return
    const before = memo
    setMemo({ ...memo, title: t })
    try {
      setMemo(await api.renameMemo(memo.id, t))
    } catch (err) {
      setMemo(before)
      toast.error('Could not rename', { description: (err as Error)?.message })
    }
  }
  const retry = async () => {
    setBusy('retry')
    try {
      const m: Memo = await api.retryMemo(memo.id)
      setMemo(m)
      if (m.status === 'partial') toast.error('Still not fully transcribed')
      else toast.success('Transcribed')
    } catch (err) {
      toast.error('Retry failed', { description: (err as Error)?.message })
    } finally {
      setBusy(null)
    }
  }
  const remove = async () => {
    setBusy('delete')
    try {
      await api.deleteMemo(memo.id)
      toast.success('Memo deleted')
      onDeleted()
    } catch (err) {
      toast.error('Could not delete', { description: (err as Error)?.message })
      setBusy(null)
    }
  }

  // The memo is a file on this server: start there, next to it (the form can change both).
  const SpawnForm = desktop ? NewSessionDialog : NewSessionDrawer
  const meta = [memoWhen(memo.created), formatDuration(memo.durationSec), memo.words ? `${memo.words} words` : null].filter(Boolean).join(' · ')
  return (
    <article className={cn(wrap, 'space-y-3')}>
      <InlineEdit
        value={memo.title}
        editing={editing}
        onEdit={() => setEditing(true)}
        onCommit={(t) => void rename(t)}
        onCancel={() => setEditing(false)}
        label="Memo title"
        maxLength={100}
        className="text-lg leading-snug font-bold"
      />
      <div className="text-xs text-muted-foreground tabular-nums">{meta}</div>
      <div className="flex flex-wrap gap-1.5">
        {self ? (
          <Button size="sm" onClick={() => setSpawnOpen(true)}>
            <BotIcon /> Start session
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={() => void copyWithToast(memo.transcript)}>
          <CopyIcon /> Copy text
        </Button>
        <Button variant="outline" size="sm" title={memo.path} onClick={() => void copyWithToast(memo.path)}>
          <FolderIcon /> Copy path
        </Button>
        {memo.status === 'partial' ? (
          <Button variant="outline" size="sm" disabled={busy != null} onClick={() => void retry()}>
            {busy === 'retry' ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />} Retry transcription
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" className="text-destructive" disabled={busy != null} onClick={() => setConfirm(true)}>
          <Trash2Icon /> Delete
        </Button>
      </div>
      <div className="border-t pt-3">
        {memo.transcript ? <Markdown text={memo.transcript} /> : <p className="text-sm text-muted-foreground">No speech was recognized.</p>}
      </div>
      {self ? <SpawnForm open={spawnOpen} onOpenChange={setSpawnOpen} onOpenSession={(href) => navigate(href)} prefill={{ host: self, dir: memo.path.replace(/\/[^/]*$/, '') || null, prompt: memoSessionPrompt(memo) }} /> : null}
      {confirm ? (
        <Dialog open onOpenChange={(o) => (o || busy ? null : setConfirm(false))}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete “{memo.title}”?</DialogTitle>
              <DialogDescription>The transcript and its recording are removed from the server.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirm(false)} disabled={busy != null}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => void remove()} disabled={busy != null}>
                {busy === 'delete' ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />} Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </article>
  )
}
