import { CopyIcon } from 'lucide-react'

import { copyWithToast } from '@/lib/clipboard'

/** A chip in the session header: the session id's first block; a tap copies the whole id. */
export function CopyIdChip({ sessionId }: { sessionId: string }) {
  return (
    <button
      type="button"
      onClick={() => void copyWithToast(sessionId)}
      title={`Copy session id ${sessionId}`}
      className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 font-mono text-[0.6875rem] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <CopyIcon className="size-3" />
      {sessionId.split('-')[0]}
    </button>
  )
}
