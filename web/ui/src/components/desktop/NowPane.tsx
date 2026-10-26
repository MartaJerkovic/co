import type { ReactNode } from 'react'
import { AtSignIcon, GitPullRequestIcon, HandIcon, SquareCheckBigIcon } from 'lucide-react'

import type { PullRequest, Session, Task } from '@/api/types'
import { usePrs } from '@/hooks/usePrs'
import { useTasks } from '@/hooks/useTasks'
import { prHref } from '@/lib/prs'
import { statusLabel } from '@/lib/sessions'
import { sessionKey } from '@/lib/shortcuts'
import { taskHref } from '@/lib/tasks'
import { sessionTitle } from '@/lib/title'

/** How many things the pane shows; the rest wait behind the Inbox link. */
const NOW_LIMIT = 5

const isBot = (author: string | null | undefined) => !!author && (/\[bot\]$/i.test(author) || /^renovate/i.test(author) || /^dependabot/i.test(author))

interface Item {
  key: string
  icon: ReactNode
  title: string
  note: string
  href?: string
  onOpen?: () => void
}

/** The things waiting on you, most urgent first: sessions, @mentions, reviews (oldest first, no bots), overdue tasks. */
function nowItems(waiting: Session[], prs: PullRequest[], tasks: Task[], onOpen: (s: Session) => void): Item[] {
  const sessions: Item[] = waiting.map((s) => ({
    key: `s:${sessionKey(s)}`,
    icon: <HandIcon className="size-4 text-status-waiting" />,
    title: sessionTitle(s),
    note: statusLabel(s),
    onOpen: () => onOpen(s),
  }))
  const human = prs.filter((p) => !isBot(p.author))
  const mentions: Item[] = human
    .filter((p) => p.column === 'unseenMentions')
    .map((p) => ({ key: `m:${p.url}`, icon: <AtSignIcon className="size-4" />, title: p.title, note: `${p.repo}#${p.number} · @${p.mention?.author ?? p.author}`, href: `#${prHref(p)}` }))
  const reviews: Item[] = human
    .filter((p) => p.column === 'waitingOnMe')
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((p) => ({ key: `r:${p.url}`, icon: <GitPullRequestIcon className="size-4" />, title: p.title, note: `review · ${p.repo}#${p.number} · @${p.author}`, href: `#${prHref(p)}` }))
  const due: Item[] = tasks
    .filter((t) => t.column === 'due')
    .map((t) => ({ key: `t:${t.id}`, icon: <SquareCheckBigIcon className="size-4" />, title: t.title, note: `task · ${t.dueDate ?? ''}`, href: `#${taskHref(t)}` }))
  return [...sessions, ...mentions, ...reviews, ...due]
}

/** The desktop's home pane (no session open): only what needs you now, at most NOW_LIMIT things. */
export function NowPane({ waitingSessions, onOpen }: { waitingSessions: Session[]; onOpen: (s: Session) => void }) {
  const prs = usePrs().data?.prs ?? []
  const tasks = useTasks().data?.tasks ?? []
  const items = nowItems(waitingSessions, prs, tasks, onOpen)
  const [first, ...others] = items
  const later = others.slice(0, NOW_LIMIT - 1)
  const rest = others.length - later.length
  const open = (it: Item, cls: string, body: ReactNode) =>
    it.href ? (
      <a href={it.href} className={cls}>
        {body}
      </a>
    ) : (
      <button type="button" onClick={it.onOpen} className={cls}>
        {body}
      </button>
    )
  return (
    <div data-tauri-drag-region className="flex flex-1 flex-col items-center justify-center p-8">
      <section aria-label="Now" className="w-full max-w-lg">
        {first ? (
          <>
            <h2 className="pb-3 text-sm font-medium text-dimmer">Now</h2>
            {open(
              first,
              'flex w-full items-start gap-3 rounded-xl border border-border bg-card px-5 py-4 text-left outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50',
              <>
                <span className="mt-1 shrink-0 text-muted-foreground">{first.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-lg leading-snug font-semibold [overflow-wrap:anywhere]">{first.title}</span>
                  <span className="mt-1 block truncate text-sm text-dimmer">{first.note}</span>
                </span>
              </>,
            )}
            {later.length ? (
              <>
                <h3 className="pt-8 pb-2 text-xs font-medium text-dimmer">Later</h3>
                <ul className="flex flex-col">
                  {later.map((it) => (
                    <li key={it.key}>
                      {open(
                        it,
                        'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
                        <>
                          <span className="shrink-0 text-dimmer [&_svg]:size-3.5">{it.icon}</span>
                          <span className="min-w-0 flex-1 truncate">{it.title}</span>
                        </>,
                      )}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {rest > 0 ? (
              <a href="#/inbox" className="mt-2 inline-block px-2 text-xs text-dimmer hover:text-foreground">
                +{rest} more in Inbox
              </a>
            ) : null}
          </>
        ) : (
          <p className="text-center text-sm text-muted-foreground">Nothing needs you right now.</p>
        )}
      </section>
    </div>
  )
}
