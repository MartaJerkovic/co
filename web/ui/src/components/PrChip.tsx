import { CircleCheckIcon, CircleDotDashedIcon, CircleXIcon, GitPullRequestIcon } from 'lucide-react'
import { Link, useLocation } from 'wouter'

import type { PullRequest, Session } from '@/api/types'
import { StatusDot } from '@/components/StatusDot'
import { useSessionPr } from '@/hooks/usePrs'
import { useSessionTitle } from '@/hooks/useTitles'
import { CHECKS_LABEL, checksTone, prHref } from '@/lib/prs'
import { sessionHref } from '@/lib/sessions'
import { cn } from '@/lib/utils'

/** The PR's combined CI state as a small icon (nothing when no checks report). */
export function ChecksIcon({ checks, className }: { checks: PullRequest['checks']; className?: string }) {
  const tone = checksTone(checks)
  const icon =
    tone === 'ok' ? (
      <CircleCheckIcon className={cn('size-3.5 text-status-idle', className)} />
    ) : tone === 'bad' ? (
      <CircleXIcon className={cn('size-3.5 text-status-error', className)} />
    ) : tone === 'running' ? (
      <CircleDotDashedIcon className={cn('size-3.5 text-status-waiting', className)} />
    ) : null
  if (!icon) return null
  return (
    <span title={CHECKS_LABEL[tone]} aria-label={CHECKS_LABEL[tone]} className="inline-flex shrink-0">
      {icon}
    </span>
  )
}

/**
 * The PR a session works on (its cwd is the PR's worktree): `#123` + CI state. A click opens
 * the PR on the Pull requests screen — never the row it sits in (a link around it).
 */
export function PrChip({ session: s, className }: { session: Pick<Session, 'host' | 'session_id'>; className?: string }) {
  const pr = useSessionPr(s)
  const [, navigate] = useLocation()
  if (!pr) return null
  return (
    <button
      type="button"
      title={`${pr.owner}/${pr.repo}#${pr.number}: ${pr.title}`}
      aria-label={`Pull request ${pr.repo}#${pr.number}: open it`}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        navigate(prHref(pr))
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      className={cn(
        'relative inline-flex h-4.5 shrink-0 items-center gap-0.5 rounded-[5px] border border-border px-1 text-[0.6875rem] text-muted-foreground',
        'outline-none after:absolute after:-inset-1.5 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50',
        className,
      )}
    >
      <GitPullRequestIcon className="size-3 shrink-0" />#{pr.number}
      <ChecksIcon checks={pr.checks} className="size-3" />
    </button>
  )
}

/** A session working on a PR: status dot + its title, linking to it. */
export function PrSessionLink({ session: s, className }: { session: Session; className?: string }) {
  const { title } = useSessionTitle(s)
  return (
    <Link
      href={sessionHref(s)}
      className={cn('inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md px-1 text-xs hover:bg-muted hover:text-foreground', className)}
    >
      <StatusDot status={s.status} className="size-2" />
      <span className="min-w-0 truncate">{title}</span>
    </Link>
  )
}
