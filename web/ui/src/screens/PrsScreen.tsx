import { useRef, useState } from 'react'
import {
  ChevronLeftIcon,
  CircleCheckIcon,
  CircleDotDashedIcon,
  CircleXIcon,
  FolderGit2Icon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  MessageSquareIcon,
  RefreshCwIcon,
  SearchIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { useLocation } from 'wouter'

import type { PullRequest } from '@/api/types'
import { HostDot } from '@/components/HostBadge'
import { ScreenHeader } from '@/components/ScreenHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useNow } from '@/hooks/useNow'
import { usePrs } from '@/hooks/usePrs'
import { useSwipeBack } from '@/hooks/useSwipeBack'
import { relTime } from '@/lib/format'
import { CHECKS_LABEL, checksTone, groupPrs, reviewLabel, type ChecksTone, type PrGroup } from '@/lib/prs'
import { cn } from '@/lib/utils'

const CHECKS_ICON: Record<ChecksTone, React.ReactNode> = {
  ok: <CircleCheckIcon className="size-3.5 text-status-idle" />,
  bad: <CircleXIcon className="size-3.5 text-status-error" />,
  running: <CircleDotDashedIcon className="size-3.5 text-status-waiting" />,
  none: null,
}

/**
 * `#/prs`: the GitHub pull requests that need you (`fleet prs` on one host), by column —
 * waiting on you, yours in review / ready / drafts, waiting on their author. `pane` = the
 * desktop layout (a board over the whole window, like the notes explorer); `screen` = mobile
 * (the columns stacked, swipe back).
 */
export function PrsScreen({ layout = 'screen' }: { layout?: 'screen' | 'pane' }) {
  const pane = layout === 'pane'
  const [, navigate] = useLocation()
  const { hosts, host, setHost, data, error, loading, refresh, refreshing } = usePrs()
  const [q, setQ] = useState('')
  const now = useNow(30_000)
  const groups = groupPrs(data, q)

  const back = () => {
    if (!pane && window.history.length > 1) window.history.back()
    else navigate('/', { replace: !pane })
  }
  const screenRef = useRef<HTMLDivElement>(null)
  useSwipeBack(screenRef, back, !pane)

  const refreshButton = (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Refresh pull requests"
      title="Fetch from GitHub now"
      onClick={() => void refresh()}
      disabled={refreshing || !host}
      className={cn('shrink-0', pane ? 'size-9 rounded-lg' : '-my-1.5 size-11 rounded-xl')}
    >
      <RefreshCwIcon className={cn('size-5', refreshing && 'animate-spin')} />
    </Button>
  )

  const hostPicker =
    hosts.length > 1 ? (
      <div role="radiogroup" aria-label="Host" title="Whose gh login and checkouts to use" className="no-scrollbar flex gap-1 overflow-x-auto">
        {hosts.map((h) => (
          <button
            key={h}
            type="button"
            role="radio"
            aria-checked={h === host}
            onClick={() => setHost(h)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              pane ? 'h-7' : 'h-9',
              h === host ? 'border-primary/40 bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-muted/60',
            )}
          >
            <HostDot host={h} />
            {h}
          </button>
        ))}
      </div>
    ) : null

  const filter = (
    <div className="relative w-full">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Filter by title, repo#123, author, branch"
        aria-label="Filter pull requests"
        className="h-8 pl-8"
      />
    </div>
  )

  const fetched = data ? relTime(data.fetchedAt, now) : ''
  const status = (
    <p className={cn('text-xs', data?.stale || error ? 'text-status-waiting' : 'text-dimmer')}>
      {error && !data ? (
        <span className="inline-flex items-start gap-1">
          <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
          {error}
        </span>
      ) : data ? (
        <>
          {data.stale || error ? <TriangleAlertIcon className="mr-1 inline size-3.5 align-[-2px]" /> : null}
          {fetched ? `Fetched ${fetched} ago` : 'Fetched just now'} as @{data.user}
          {data.scope ? ` · ${data.scope}` : ''}
          {data.error || error ? ` — ${data.error ?? error}` : ''}
          {data.truncated ? ' · some PRs are missing (a search hit its limit)' : ''}
        </>
      ) : null}
    </p>
  )

  const skeleton = (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-2 rounded-lg border p-3">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-4 w-full" />
        </div>
      ))}
    </div>
  )
  const showSkeleton = loading && !data && !error

  if (pane) {
    return (
      <section aria-label="Pull requests" className="flex h-full min-w-0 flex-1 flex-col bg-background">
        <header
          data-tauri-drag-region="deep"
          className="titlebar titlebar-lead flex shrink-0 items-center gap-2 border-b py-1.5 pr-2 pl-2 [--titlebar-pad:0.5rem]"
        >
          <Button asChild variant="ghost" size="sm" className="shrink-0 text-muted-foreground">
            <a href="#/" title="Back to the sessions (Esc)">
              <ChevronLeftIcon /> Sessions
            </a>
          </Button>
          <h1 className="flex shrink-0 items-center gap-1.5 text-[0.9375rem] font-bold">
            <GitPullRequestIcon className="size-4 text-muted-foreground" /> Pull requests
          </h1>
          {hostPicker}
          <div className="mx-2 flex max-w-md min-w-0 flex-1">{filter}</div>
          {refreshButton}
        </header>
        <div className="shrink-0 px-4 pt-2">{status}</div>
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 pt-2 pb-4">
          {showSkeleton
            ? [0, 1, 2, 3].map((i) => (
                <div key={i} className="w-80 shrink-0">
                  {skeleton}
                </div>
              ))
            : groups.map((g) => <Column key={g.id} group={g} now={now} />)}
        </div>
      </section>
    )
  }

  return (
    <div ref={screenRef} className="flex min-h-app flex-col bg-background">
      <ScreenHeader>
        <div className="-ml-2 flex min-h-8 items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Back" onClick={back} className="-my-1.5 size-11 shrink-0 rounded-xl">
            <ChevronLeftIcon className="size-6" />
          </Button>
          <h1 className="flex-1 text-xl font-bold tracking-tight">Pull requests</h1>
          {refreshButton}
        </div>
        <div className="mt-2 space-y-2">
          {hostPicker}
          {filter}
        </div>
      </ScreenHeader>
      <div className="mx-auto w-full max-w-lg space-y-5 px-4 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:max-w-2xl">
        {status}
        {showSkeleton ? skeleton : null}
        {groups
          .filter((g) => g.prs.length)
          .map((g) => (
            <section key={g.id} aria-label={g.title}>
              <ColumnTitle group={g} />
              <div className="space-y-2">
                {g.prs.map((p) => (
                  <PrCard key={p.url} pr={p} now={now} />
                ))}
              </div>
            </section>
          ))}
        {data && !groups.some((g) => g.prs.length) ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{q ? 'No pull request matches.' : 'No open pull requests need you.'}</p>
        ) : null}
      </div>
    </div>
  )
}

function ColumnTitle({ group: g }: { group: PrGroup }) {
  return (
    <h2 className="mb-2 flex items-baseline gap-2 text-sm font-semibold">
      {g.title}
      <span className="text-xs font-normal text-dimmer tabular-nums">{g.prs.length}</span>
    </h2>
  )
}

function Column({ group: g, now }: { group: PrGroup; now: number }) {
  return (
    <section aria-label={g.title} className="flex w-80 shrink-0 flex-col">
      <ColumnTitle group={g} />
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {g.prs.map((p) => (
          <PrCard key={p.url} pr={p} now={now} />
        ))}
        {!g.prs.length ? <p className="rounded-lg border border-dashed p-3 text-center text-xs text-dimmer">Nothing here</p> : null}
      </div>
    </section>
  )
}

function PrCard({ pr: p, now }: { pr: PullRequest; now: number }) {
  const tone = checksTone(p.checks)
  const review = reviewLabel(p)
  const mine = p.column === 'draftMine' || p.column === 'reviewMine' || p.column === 'readyToMergeMine'
  const worktree = p.local?.worktree
  return (
    <a
      href={p.url}
      target="_blank"
      rel="noreferrer"
      className="block rounded-lg border bg-card p-3 text-sm outline-none hover:border-primary/40 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        {p.draft ? <GitPullRequestDraftIcon className="size-3.5 shrink-0" /> : <GitPullRequestIcon className="size-3.5 shrink-0" />}
        <span className="min-w-0 truncate font-mono">
          {p.repo}#{p.number}
        </span>
        {CHECKS_ICON[tone] ? (
          <span title={CHECKS_LABEL[tone]} aria-label={CHECKS_LABEL[tone]} className="shrink-0">
            {CHECKS_ICON[tone]}
          </span>
        ) : null}
        <span className="ml-auto shrink-0 rounded border px-1 text-[0.625rem] leading-4 font-semibold" title={`+${p.additions} −${p.deletions} in ${p.changedFiles} files`}>
          {p.size}
        </span>
        <span className="shrink-0 tabular-nums" title={`Opened ${new Date(p.createdAt).toLocaleString()}`}>
          {relTime(p.createdAt, now)}
        </span>
      </div>
      <div className="line-clamp-2 font-medium text-foreground">{p.title}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {!mine ? <span>@{p.author}</span> : null}
        {review ? <span className={cn(p.myReview?.newCommits && 'text-status-waiting')}>{review}</span> : null}
        {p.comments ? (
          <span className="inline-flex items-center gap-0.5" title={`${p.comments} comments`}>
            <MessageSquareIcon className="size-3" />
            {p.comments}
          </span>
        ) : null}
        {worktree ? (
          <span className="inline-flex min-w-0 items-center gap-0.5 text-status-busy" title={`Checked out in ${worktree}`}>
            <FolderGit2Icon className="size-3 shrink-0" />
            worktree
          </span>
        ) : null}
      </div>
    </a>
  )
}
