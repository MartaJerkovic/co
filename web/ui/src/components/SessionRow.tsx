import { useEffect, useState, type MouseEvent } from 'react'
import { XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Link } from 'wouter'

import { api, sessionErrorMessage } from '@/api/client'

import type { Session } from '@/api/types'
import { ContextMeter } from '@/components/ContextMeter'
import { EditableTitle } from '@/components/EditableTitle'
import { GhIdentityChip } from '@/components/GhIdentityChip'
import { HostBadge } from '@/components/HostBadge'
import { EmbedChip, JobChip } from '@/components/JobChip'
import { PrChip } from '@/components/PrChip'
import { TaskChip } from '@/components/TaskChip'
import { StackChip } from '@/components/stack/StackChip'
import { StatusDot } from '@/components/StatusDot'
import { useLongPress } from '@/hooks/useLongPress'
import { useSettings } from '@/hooks/useSettings'
import { openTitleEditor, useSessionTitle } from '@/hooks/useTitles'
import { relTime, sessionSubtitle } from '@/lib/format'
import { harnessLabel, sessionHarness } from '@/lib/harness'
import { sessionHref, statusLabel, statusMeta } from '@/lib/sessions'
import { sessionKey } from '@/lib/shortcuts'
import { echoesTitle, sessionTitle } from '@/lib/title'
import { cn } from '@/lib/utils'

/** Context used (%) from which the row shows its meter: only when it is running low. */
const LOW_CONTEXT_PCT = 70

const chip = 'inline-flex h-4.5 shrink-0 items-center rounded-[5px] border px-1 text-[0.6875rem] whitespace-nowrap'

export interface SessionRowProps {
  session: Session
  now: number
  /** Desktop sidebar: this row is the session open in the detail pane. */
  selected?: boolean
  /** Desktop sidebar: the keyboard cursor (↑/↓) is on this row. */
  cursor?: boolean
  /** Shown inside its stack's group (StackGroup): no stack chip of its own. */
  inStack?: boolean
  /** Your turn (asking you, or finished and not opened): yellow like waiting, and a red badge on the corner. */
  turn?: boolean
}

/**
 * One session in the list: status dot (its label / waiting_for on hover), title, host, first prompt,
 * stack chip (opens the Stack sheet), job chip (started by a scheduled job), cwd, backend, context, age. The title is editable in place: the pencil on hover
 * (desktop), ⌘E / F2 on the cursor row, or a long press (touch). Clicking the row opens it.
 */
export function SessionRow({ session: s, now, selected, cursor, inStack, turn }: SessionRowProps) {
  const meta = statusMeta(s.status)
  const { title } = useSessionTitle(s)
  const prompt = sessionSubtitle(s)
  // The first prompt, unless the title is just its slug (no generated title yet).
  const subtitle = echoesTitle(title, prompt) ? '' : prompt
  const multiHost = useSettings().hosts.length > 1
  const harness = sessionHarness(s)
  // A finished reply you haven't opened looks the same as a question: both are your turn.
  const waiting = meta.key === 'waiting' || !!turn
  const longPress = useLongPress(() => openTitleEditor('row', sessionKey(s)))

  return (
    <Link
      href={sessionHref(s)}
      {...longPress}
      aria-current={selected ? 'page' : undefined}
      data-session-key={selected || cursor ? `${s.host}/${s.session_id}` : undefined}
      className={cn(
        'group/row relative block min-h-16 rounded-xl border bg-card px-3.5 py-3 text-card-foreground transition-colors [-webkit-touch-callout:none]',
        'outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 active:bg-muted',
        waiting ? 'border-status-waiting/35' : 'border-border/70',
        selected && 'border-primary/60 bg-accent/60 hover:bg-accent/70',
        cursor && 'border-primary/40 ring-2 ring-primary/40',
      )}
    >
      {turn ? <span aria-label="Your turn" className="absolute -top-1 -right-1 size-3.5 rounded-full border-2 border-background bg-destructive" /> : null}
      <div className="flex min-w-0 items-center gap-2">
        <StatusDot status={waiting ? 'waiting' : s.status} title={statusLabel(s)} />
        <EditableTitle session={s} scope="row" className="text-[0.9375rem] font-bold" />
        {multiHost ? <HostBadge host={s.host} /> : null}
        <CloseButton session={s} />
      </div>
      {subtitle ? <p className="mt-1 line-clamp-2 text-[0.8125rem] break-words text-muted-foreground">{subtitle}</p> : null}
      <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[0.6875rem] text-dimmer">
        {inStack ? null : <StackChip session={s} />}
        <JobChip session={s} />
        <EmbedChip session={s} />
        <GhIdentityChip session={s} />
        <PrChip session={s} />
        <TaskChip session={s} />
        {harness !== 'claude' ? (
          <span className={cn(chip, 'border-primary/40 text-primary')} title={s.model ?? undefined}>
            {harnessLabel(harness)}
          </span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {(s.context?.pct ?? 0) >= LOW_CONTEXT_PCT ? <ContextMeter context={s.context} /> : null}
          <span className="tabular-nums">{relTime(s.updated_at, now)}</span>
        </span>
      </div>
    </Link>
  )
}

/**
 * The row's ✕ (on hover): the first click arms it ("Close?", 3 s), the second closes Claude and
 * its terminal — the same confirm-by-repeating as ⌘⌫ and the Details panel.
 */
function CloseButton({ session: s }: { session: Session }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])
  if (!s.session_id) return null
  const onClick = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!armed) return setArmed(true)
    setArmed(false)
    const name = sessionTitle(s)
    const pending = toast.loading(`Closing “${name}”…`)
    api
      .kill(s.host, s.session_id!)
      .then((res) => toast.success(`Closed ${res.name || name}`, { id: pending }))
      .catch((err) => toast.error('Close failed', { id: pending, description: sessionErrorMessage(err) }))
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={armed ? 'Click again to close the session' : 'Close session'}
      className={cn(
        'inline-flex h-5 shrink-0 items-center justify-center rounded-md text-dimmer transition-opacity hover:bg-muted hover:text-foreground',
        armed ? 'gap-1 px-1.5 text-[0.6875rem] font-medium text-destructive opacity-100' : 'w-5 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100',
      )}
    >
      <XIcon className="size-3.5" />
      {armed ? 'Close?' : null}
    </button>
  )
}
