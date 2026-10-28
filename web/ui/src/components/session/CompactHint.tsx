import { ShrinkIcon } from 'lucide-react'

import type { ContextUsage } from '@/api/types'
import { ctxLevel } from '@/lib/format'
import { CTX_TEXT } from '@/lib/styles'
import { cn } from '@/lib/utils'

/** Context use (%) from which the chat offers a one-tap `/compact`. */
export const COMPACT_HINT_PCT = 30

/** "Compact": a tap sends `/compact` through the outbox, so the undo window still applies.
 *  `inline`: a chip in the session header, beside the context meter, always shown; otherwise the
 *  floating pill once the context passes COMPACT_HINT_PCT (bottom-left, "Latest" sits bottom-right). */
export function CompactHint({ context: c, onCompact, inline = false }: { context?: ContextUsage | null; onCompact: () => void; inline?: boolean }) {
  const pct = c && Number.isFinite(c.pct) ? Math.round(c.pct) : null
  if (inline) {
    return (
      <button
        type="button"
        onClick={onCompact}
        title={pct === null ? 'Send /compact to summarise the conversation' : `${100 - pct}% context left — send /compact to summarise the conversation`}
        className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 text-[0.6875rem] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <ShrinkIcon className="size-3" />
        Compact
      </button>
    )
  }
  if (pct === null || pct < COMPACT_HINT_PCT) return null
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
