import type { ReactNode } from 'react'
import { LayersIcon } from 'lucide-react'

import type { Session } from '@/api/types'
import { useStackLabel } from '@/hooks/useStackLabels'
import { openStackSheet } from '@/hooks/useStackUi'
import { stackHome } from '@/lib/stacks'

/**
 * The adjacent members of one stack in the session list, framed together under a header (layers
 * icon, label, member count) that opens the Stack sheet. The rows inside drop their stack chip.
 */
export function StackGroup({ sessions, children }: { sessions: Session[]; children: ReactNode }) {
  const first = sessions[0]
  const home = stackHome(first)
  const id = first.stack?.id ?? ''
  const { label } = useStackLabel(home, id, first.stack?.label || id)
  return (
    <div role="group" aria-label={`Session stack ${label}`} className="flex flex-col gap-1 rounded-2xl border border-primary/25 bg-primary/[0.03] p-1">
      <button
        type="button"
        title={`Session stack: ${label} — open its StackBrief`}
        onClick={() => openStackSheet(home, id)}
        className="flex min-w-0 items-center gap-1.5 rounded-lg px-2 pt-0.5 text-left text-[0.6875rem] font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <LayersIcon className="size-3 shrink-0" />
        <span className="min-w-0 truncate">{label}</span>
        <span className="shrink-0 text-dimmer tabular-nums">· {sessions.length}</span>
      </button>
      {children}
    </div>
  )
}
