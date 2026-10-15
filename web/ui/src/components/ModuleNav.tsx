import type { ReactNode } from 'react'
import { AudioLinesIcon, CalendarClockIcon, GaugeIcon, GitPullRequestIcon, NotebookPenIcon, NotebookTextIcon, Settings2Icon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useNotesHosts } from '@/hooks/useNotes'
import { useScratchpadOpen } from '@/hooks/useScratchpad'
import { useSettings } from '@/hooks/useSettings'
import { scratchpad } from '@/lib/scratchpad'
import { withHint, type ShortcutAction } from '@/lib/shortcuts'
import { cn } from '@/lib/utils'

export type ModuleId = 'scratchpad' | 'operator' | 'prs' | 'notes' | 'jobs' | 'usage' | 'settings'

export interface Module {
  id: ModuleId
  label: string
  icon: ReactNode
  /** A screen (`#/…`), or an action (the scratchpad panel). */
  href?: string
  run?: () => void
  hint?: ShortcutAction
  /** `work`: the modules you work in; `utility`: the helper screens (usage, settings). */
  group: 'work' | 'utility'
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
    settings.operator ? { id: 'operator', label: 'Operator', icon: <AudioLinesIcon />, href: '#/operator', group: 'work' } : null,
    { id: 'prs', label: 'Pull requests', icon: <GitPullRequestIcon />, href: '#/prs', group: 'work' },
    { id: 'scratchpad', label: 'Scratchpad', icon: <NotebookPenIcon />, run: () => (scratchpad.isOpen() ? scratchpad.hide() : scratchpad.show()), hint: 'scratchpad', group: 'work' },
    notesHosts.length ? { id: 'notes', label: 'Notes', icon: <NotebookTextIcon />, href: '#/notes', hint: 'notes', group: 'work' } : null,
    { id: 'jobs', label: 'Scheduled jobs', icon: <CalendarClockIcon />, href: '#/jobs', group: 'work' },
    { id: 'usage', label: 'Usage limits', icon: <GaugeIcon />, href: '#/usage', group: 'utility' },
    { id: 'settings', label: 'Settings', icon: <Settings2Icon />, href: '#/settings', group: 'utility' },
  ]
  return all.filter((m): m is Module => m !== null)
}

/** One icon button per module (the sidebar row, the rail). */
export function ModuleButtons({
  size = 'icon',
  className,
  exclude = [],
  group,
}: {
  size?: 'icon' | 'icon-sm'
  className?: string
  exclude?: ModuleId[]
  /** Only this group (absent: all). */
  group?: Module['group']
}) {
  const modules = useModules().filter((m) => !exclude.includes(m.id) && (!group || m.group === group))
  const scratchOpen = useScratchpadOpen()
  return (
    <>
      {modules.map((m) => {
        const title = m.hint ? withHint(m.label, m.hint) : m.label
        const cls = cn('text-dimmer hover:text-foreground', m.id === 'scratchpad' && scratchOpen && 'text-foreground', className)
        return m.href ? (
          <Button key={m.id} asChild variant="ghost" size={size} className={cls}>
            <a href={m.href} aria-label={m.label} title={title}>
              {m.icon}
            </a>
          </Button>
        ) : (
          <Button key={m.id} variant="ghost" size={size} aria-label={m.label} title={title} aria-pressed={m.id === 'scratchpad' ? scratchOpen : undefined} onClick={m.run} className={cls}>
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
