import type { ContextUsage } from '@/api/types'
import { ctxLevel, ctxSummary } from '@/lib/format'
import { CTX_FILL, CTX_TEXT } from '@/lib/styles'
import { cn } from '@/lib/utils'

/** Tiny context-window meter: how much context is left (as Claude Code's own status shows it), coloured by how full it is. */
export function ContextMeter({ context: c, className }: { context?: ContextUsage | null; className?: string }) {
  if (!c || !Number.isFinite(c.pct)) return null
  const pct = Math.max(0, Math.round(c.pct))
  const level = ctxLevel(pct)
  const left = Math.max(0, 100 - pct)
  const title = [`${left}% context left (${ctxSummary(c)} used)`, c.model].filter(Boolean).join(' · ')
  return (
    <span
      className={cn('inline-flex shrink-0 items-center gap-1 tabular-nums', CTX_TEXT[level], className)}
      title={title}
      aria-label={title}
    >
      <span className="relative h-1.5 w-5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span className={cn('absolute inset-y-0 left-0 rounded-full', CTX_FILL[level])} style={{ width: `${left}%` }} />
      </span>
      {left}%
    </span>
  )
}
