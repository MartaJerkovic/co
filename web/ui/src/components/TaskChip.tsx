import { SquareCheckBigIcon } from 'lucide-react'
import { useLocation } from 'wouter'

import type { PullRequest, Session, Task } from '@/api/types'
import { usePrTasks, useSessionTask } from '@/hooks/useTasks'
import { taskHref } from '@/lib/tasks'
import { cn } from '@/lib/utils'

const CHIP = cn(
  'relative inline-flex h-4.5 max-w-40 shrink-0 items-center gap-0.5 rounded-[5px] border border-border px-1 text-[0.6875rem] text-muted-foreground',
  'outline-none after:absolute after:-inset-1.5 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50',
)

/** One task as a small chip (`☑ #123`); a click opens it on the Tasks screen — never the row it sits in. */
export function TaskLink({ task: t, className }: { task: Task; className?: string }) {
  const [, navigate] = useLocation()
  return (
    <button
      type="button"
      title={`${t.project.name} #${t.number}: ${t.title} (${t.status.name})`}
      aria-label={`Task #${t.number}: open it`}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        navigate(taskHref(t))
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      className={cn(CHIP, className)}
    >
      <SquareCheckBigIcon className="size-3 shrink-0" />
      <span className="truncate">#{t.number}</span>
    </button>
  )
}

/** The Productive task a session works on (its first prompt or its PR links it). */
export function TaskChip({ session: s, className }: { session: Pick<Session, 'host' | 'session_id'>; className?: string }) {
  const t = useSessionTask(s)
  return t ? <TaskLink task={t} className={className} /> : null
}

/** The tasks a PR links. */
export function PrTaskChips({ pr, className }: { pr: Pick<PullRequest, 'url'>; className?: string }) {
  const tasks = usePrTasks(pr)
  if (!tasks.length) return null
  return (
    <>
      {tasks.map((t) => (
        <TaskLink key={t.id} task={t} className={className} />
      ))}
    </>
  )
}
