import { statusMeta } from '@/lib/sessions'
import { STATUS_DOT } from '@/lib/styles'
import { cn } from '@/lib/utils'

export function StatusDot({ status, title, className }: { status: string | null | undefined; title?: string; className?: string }) {
  const meta = statusMeta(status)
  return (
    <span
      role="img"
      aria-label={title ?? meta.label}
      title={title}
      className={cn('inline-block size-2.5 shrink-0 rounded-full', STATUS_DOT[meta.key], meta.key === 'busy' && 'animate-breathe motion-reduce:animate-none', className)}
    />
  )
}
