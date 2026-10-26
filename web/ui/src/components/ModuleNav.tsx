import type { ReactNode } from 'react'
import { useLocation } from 'wouter'
import { AudioLinesIcon, InboxIcon, BotIcon, CircleDotIcon, GaugeIcon, GitPullRequestIcon, NotebookPenIcon, SquareCheckBigIcon, NotebookTextIcon, Settings2Icon } from 'lucide-react'

import { SpaceIcon } from '@/components/SpaceIcon'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useNotesHosts } from '@/hooks/useNotes'
import { useSettings } from '@/hooks/useSettings'
import { scratchpad } from '@/lib/scratchpad'
import { spaceHref } from '@/lib/spaces'
import { withHint, type ShortcutAction } from '@/lib/shortcuts'
import { cn } from '@/lib/utils'

/** A space's module is `space:<id>` (config `web.spaces`). */
export type ModuleId = 'inbox' | 'scratchpad' | 'memos' | 'operator' | 'prs' | 'tasks' | 'notes' | 'jobs' | 'usage' | 'settings' | `space:${string}`

export interface Module {
  id: ModuleId
  label: string
  icon: ReactNode
  /** A screen (`#/…`), or an action (the scratchpad panel). */
  href?: string
  run?: () => void
  hint?: ShortcutAction
  /** `sessions`: the session lists kept apart (Bots, the spaces); `work`: the modules you work in; `utility`: the helper screens (usage, settings). */
  group: 'sessions' | 'work' | 'utility'
}

/**
 * The app's modules — the screens and panels next to the session list — in one order, for every
 * place that lists them: the desktop sidebar's module row, the collapsed rail, the mobile ⋯ menu.
 * Modules this server doesn't offer (no notes, no operator) are left out.
 */
function useModules(): Module[] {
  const notesHosts = useNotesHosts()
  const settings = useSettings()
  const all: (Module | null)[] = [
    { id: 'inbox', label: 'Inbox', icon: <InboxIcon />, href: '#/inbox', hint: 'inbox', group: 'work' },
    settings.operator ? { id: 'operator', label: 'Operator', icon: <AudioLinesIcon />, href: '#/operator', hint: 'operator', group: 'work' } : null,
    { id: 'prs', label: 'Pull requests', icon: <GitPullRequestIcon />, href: '#/prs', hint: 'prs', group: 'work' },
    { id: 'tasks', label: 'Tasks', icon: <SquareCheckBigIcon />, href: '#/tasks', hint: 'tasks', group: 'work' },
    settings.memos ? { id: 'memos', label: 'Voice memos', icon: <CircleDotIcon />, href: '#/memos', hint: 'memos', group: 'work' } : null,
    { id: 'scratchpad', label: 'Scratchpad', icon: <NotebookPenIcon />, run: () => (scratchpad.isOpen() ? scratchpad.hide() : scratchpad.show()), hint: 'scratchpad', group: 'work' },
    notesHosts.length ? { id: 'notes', label: 'Notes', icon: <NotebookTextIcon />, href: '#/notes', hint: 'notes', group: 'work' } : null,
    { id: 'jobs', label: 'Bots', icon: <BotIcon />, href: '#/bots', hint: 'jobs', group: 'sessions' },
    ...settings.spaces.map((s): Module => ({ id: `space:${s.id}`, label: s.label, icon: <SpaceIcon icon={s.icon} />, href: spaceHref(s.id), group: 'sessions' })),
    { id: 'usage', label: 'Usage limits', icon: <GaugeIcon />, href: '#/usage', hint: 'usage', group: 'utility' },
    { id: 'settings', label: 'Settings', icon: <Settings2Icon />, href: '#/settings', hint: 'settings', group: 'utility' },
  ]
  return all.filter((m): m is Module => m !== null)
}

/** One icon button per module (the sidebar row, the rail). The scratchpad has none there: ⌘K or its shortcut. */
export function ModuleButtons({
  size = 'icon',
  className,
  exclude = [],
  group,
  badges = {},
  current,
}: {
  size?: 'icon' | 'icon-sm'
  className?: string
  exclude?: ModuleId[]
  /** Only this group (absent: all). */
  group?: Module['group']
  /** A count on a module's icon (e.g. bot runs waiting for you). */
  badges?: Partial<Record<ModuleId, number>>
  /** The module the open screen belongs to, when its URL doesn't say (a bot run opened from Bots). */
  current?: ModuleId
}) {
  const modules = useModules().filter((m) => m.id !== 'scratchpad' && !exclude.includes(m.id) && (!group || m.group === group))
  const [location] = useLocation()
  return (
    <>
      {modules.map((m) => {
        const title = m.hint ? withHint(m.label, m.hint) : m.label
        const active = m.id === current || (!!m.href && (location === m.href.slice(1) || location.startsWith(`${m.href.slice(1)}/`)))
        const cls = cn('relative text-dimmer hover:text-foreground', active && 'bg-accent text-foreground', className)
        const badge = badges[m.id] ?? 0
        return m.href ? (
          <Button key={m.id} asChild variant="ghost" size={size} className={cls}>
            <a href={m.href} aria-label={m.label} title={title} aria-current={active ? 'page' : undefined}>
              {m.icon}
              {badge > 0 ? (
                <span className="absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full bg-status-waiting px-1 text-[0.625rem] font-semibold text-background tabular-nums">
                  {badge}
                </span>
              ) : null}
            </a>
          </Button>
        ) : (
          <Button key={m.id} variant="ghost" size={size} aria-label={m.label} title={title} onClick={m.run} className={cls}>
            {m.icon}
          </Button>
        )
      })}
    </>
  )
}

/** The modules as dropdown items (the mobile ⋯ menu). */
export function ModuleMenuItems({ exclude = [] }: { exclude?: ModuleId[] }) {
  const modules = useModules().filter((m) => !exclude.includes(m.id))
  return (
    <>
      {modules.map((m) =>
        m.href ? (
          <DropdownMenuItem key={m.id} asChild>
            <a href={m.href}>
              {m.icon}
              {m.label}
            </a>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem key={m.id} onSelect={m.run}>
            {m.icon}
            {m.label}
          </DropdownMenuItem>
        ),
      )}
    </>
  )
}
