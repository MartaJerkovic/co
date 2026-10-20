import { ShrinkIcon } from 'lucide-react'

import type { ContextUsage } from '@/api/types'
import { ctxLevel } from '@/lib/format'
import { CTX_TEXT } from '@/lib/styles'
import { cn } from '@/lib/utils'

/** Context use (%) from which the chat offers a one-tap `/compact`. */
export const COMPACT_HINT_PCT = 30

/** Floating "Compact · 42%" pill (bottom-left; "Latest" sits bottom-right) once the context passes
 *  COMPACT_HINT_PCT. A tap sends `/compact` through the outbox, so the undo window still applies. */
export function CompactHint({ context: c, onCompact }: { context?: ContextUsage | null; onCompact: () => void }) {
  if (!c || !Number.isFinite(c.pct) || c.pct < COMPACT_HINT_PCT) return null
  const pct = Math.round(c.pct)
  return (
    <button
      type="button"
      onClick={onCompact}
      title={`Context ${pct}% full — send /compact to summarise the conversation`}
      className="absolute bottom-3 left-3 z-10 flex h-10 items-center gap-1.5 rounded-full border bg-popover/95 px-3.5 text-[0.8125rem] font-medium text-foreground shadow-lg backdrop-blur-sm transition-colors hover:bg-accent"
    >
      <ShrinkIcon className="size-4" />
      Compact
      <span className={cn('tabular-nums', CTX_TEXT[ctxLevel(pct)])}>{pct}%</span>
    </button>
  )
}
