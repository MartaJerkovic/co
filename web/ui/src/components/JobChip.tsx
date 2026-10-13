import { CalendarClockIcon } from 'lucide-react'

import type { Session } from '@/api/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * A session started by a scheduled job (`origin`): clock icon + the job name, the run id in a
 * tooltip. Nothing for a session started by hand. Not a link — rows and cards are links already.
 */
export function JobChip({ session: s, className }: { session: Pick<Session, 'origin'>; className?: string }) {
  const o = s.origin
  if (!o?.job) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={`Started by job ${o.job}, run ${o.run}`}
          className={cn(
            'inline-flex h-4.5 max-w-[40%] min-w-0 shrink items-center gap-1 rounded-[5px] border border-border px-1 text-[0.6875rem] text-muted-foreground',
            className,
          )}
        >
          <CalendarClockIcon className="size-3 shrink-0" />
          <span className="min-w-0 truncate">{o.job}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        Job {o.job} · run {o.run}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * "Scheduled (n)": shows / hides the sessions scheduled jobs started (waiting ones always show).
 * `count` = the job sessions the toggle applies to. Nothing when there are none and they are hidden.
 */
export function ScheduledToggle({
  show,
  onChange,
  count,
  size = 'sm',
  className,
}: {
  show: boolean
  onChange: (v: boolean) => void
  count: number
  size?: 'sm' | 'lg'
  className?: string
}) {
  if (!count && !show) return null
  return (
    <button
      type="button"
      aria-pressed={show}
      onClick={() => onChange(!show)}
      title={show ? 'Hide sessions started by scheduled jobs' : 'Show sessions started by scheduled jobs (ones that need you always show)'}
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        size === 'lg' ? 'h-9' : 'h-7',
        show ? 'border-primary/40 bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-muted/60',
        className,
      )}
    >
      <CalendarClockIcon className="size-3.5" />
      Scheduled
      <span className="text-dimmer tabular-nums">{count}</span>
    </button>
  )
}
