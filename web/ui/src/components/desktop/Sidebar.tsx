import { useEffect, useRef, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import { ChevronRightIcon, LightbulbIcon, MessagesSquareIcon, NotebookTextIcon, PanelLeftCloseIcon, PlusIcon, SearchIcon, XIcon } from 'lucide-react'

import { ClosedSection } from '@/components/ClosedSection'
import { DormantSection } from '@/components/DormantSection'
import { FocusToggle } from '@/components/FocusToggle'
import { HostDot } from '@/components/HostBadge'
import { SessionListSkeleton } from '@/components/SessionListSkeleton'
import type { Session, Space } from '@/api/types'
import { SessionRow } from '@/components/SessionRow'
import { StackGroup } from '@/components/stack/StackGroup'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ModuleButtons, type ModuleId } from '@/components/ModuleNav'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ViewToggle } from '@/components/ViewToggle'
import { useNotesHosts } from '@/hooks/useNotes'
import type { SidebarView } from '@/hooks/useSidebarView'
import { ALL_HOSTS, type SessionListState } from '@/hooks/useSessionList'
import { APP_NAME } from '@/lib/app'
import type { ViewMode } from '@/lib/groups'
import { allSessions, stackRuns } from '@/lib/sessions'
import { ariaShortcut, sessionKey, shortcutHint, withHint } from '@/lib/shortcuts'
import { openPark } from '@/lib/park'
import { cn } from '@/lib/utils'

const chip = cn(
  'h-7 shrink-0 gap-1 rounded-full border border-border bg-card px-2.5 text-xs text-muted-foreground',
  'data-[state=on]:border-primary/50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground',
)

export interface SidebarProps {
  list: SessionListState
  /** What the list shows (All / Your turn, the long-idle fold); shared with the shell's j/k. */
  sidebarView: SidebarView
  /** A list kept apart from the work sessions (Bots, a space): only its own sessions, no closed ones. */
  space?: 'bots' | Space | null
  now: number
  cursorKey: string | null
  selectedKey: string | null
  searchRef: Ref<HTMLInputElement>
  /** ↑ / ↓ / Enter inside the search field drive the list cursor. */
  onSearchNav: (action: 'next' | 'prev' | 'open') => void
  onCollapse: () => void
  /** List | Board toggle (omitted → no toggle). */
  viewMode?: ViewMode
  onViewMode?: (v: ViewMode) => void
}

/** Desktop left column: header + summary, search, status/host filters, the session list. */
export function Sidebar({ list, sidebarView, space = null, now, cursorKey, selectedKey, searchRef, onSearchNav, onCollapse, viewMode, onViewMode }: SidebarProps) {
  const { fleet, error, query, setQuery, setHostFilter, hosts, hostNames, host, hostCounts, unreachable, note } = list
  const { turnOnly, turnCount, isTurn, setTurnOnly, toggleIdle, shown, fresh, stale, staleOpen } = sidebarView
  const listRef = useRef<HTMLDivElement>(null)

  // Keep the cursor row visible (j/k past the edge).
  useEffect(() => {
    if (!cursorKey) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-session-key="${CSS.escape(cursorKey)}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursorKey])

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      onSearchNav(e.key === 'ArrowDown' ? 'next' : 'prev')
    } else if (e.key === 'Enter') {
      e.preventDefault()
      onSearchNav('open')
    } else if (e.key === 'Escape' && query) {
      // First Esc clears, the second leaves the field (window handler).
      e.preventDefault()
      e.stopPropagation()
      setQuery('')
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div data-tauri-drag-region className="shrink-0 space-y-2 border-b px-3 pt-3 pb-2.5">
        {/* The desktop app's traffic lights sit over this row (see index.css → Desktop app). */}
        <div data-tauri-drag-region="deep" className="titlebar-lead flex min-h-8 items-center gap-2 [--titlebar-offset:calc(3rem+0.75rem)]">
          <h1 className="text-lg font-bold tracking-tight">{APP_NAME}</h1>
          <span
            className={cn('ml-auto truncate text-right text-[0.6875rem] tabular-nums', note.error ? 'text-destructive' : 'text-dimmer')}
            aria-live="polite"
          >
            {note.error ? note.text : null}
          </span>
          <Button variant="ghost" size="icon" aria-label="Collapse sidebar" title={withHint('Collapse sidebar', 'sidebar')} onClick={onCollapse} className="shrink-0">
            <PanelLeftCloseIcon />
          </Button>
        </div>

        <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-dimmer" />
          <Input
            ref={searchRef}
            type="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="Search name, title, cwd…"
            aria-label="Search sessions"
            aria-keyshortcuts={ariaShortcut('search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            className="h-9 rounded-lg bg-card pr-9 pl-8 [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery('')}
              className="absolute inset-y-0 right-0 grid w-9 place-items-center rounded-r-lg text-dimmer outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <XIcon className="size-4" />
            </button>
          ) : (
            <Kbd className="absolute top-1/2 right-2 -translate-y-1/2">{shortcutHint('search')}</Kbd>
          )}
        </div>
          {viewMode && onViewMode ? <ViewToggle value={viewMode} onChange={onViewMode} labels={false} className="p-px" /> : null}
        </div>

        <ToggleGroup type="single" value={turnOnly ? 'turn' : 'all'} onValueChange={(v) => v && setTurnOnly(v === 'turn')} aria-label="Show" className="justify-start">
          <ToggleGroupItem value="all" className={chip}>
            All
          </ToggleGroupItem>
          <ToggleGroupItem value="turn" className={chip} title="Claude asked you something, or finished a reply you haven't opened">
            Your turn
            {turnCount ? <span className="ml-0.5 min-w-4 rounded-full bg-status-waiting px-1 text-[0.625rem] font-semibold text-background tabular-nums">{turnCount}</span> : null}
          </ToggleGroupItem>
        </ToggleGroup>


        {hostNames.length > 1 ? (
          <ToggleGroup
            type="single"
            value={host ?? ALL_HOSTS}
            onValueChange={(v) => v && setHostFilter(v)}
            aria-label="Filter by host"
            className="no-scrollbar w-full flex-nowrap overflow-x-auto"
          >
            <ToggleGroupItem value={ALL_HOSTS} className={chip}>
              All
            </ToggleGroupItem>
            {hosts.map((h) => (
              <ToggleGroupItem key={h.name} value={h.name} className={chip}>
                <HostDot host={h.name} />
                <span className={cn(h.ok === false && 'text-destructive')}>{h.name}</span>
                <span className="text-[0.6875rem] text-dimmer tabular-nums">{h.ok === false ? '!' : (hostCounts.get(h.name) ?? 0)}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : null}
      </div>

      <div ref={listRef} data-session-list className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
        {error ? (
          <Alert variant="destructive" className="mb-2">
            <AlertDescription>
              {fleet ? `Refresh failed: ${error} — showing last known data` : `Could not reach fleet web: ${error}`}
            </AlertDescription>
          </Alert>
        ) : null}
        {unreachable.map((h) => (
          <Alert key={h.name} variant="destructive" className="mb-2">
            <AlertDescription className="break-words">
              {h.name} unreachable: {h.error || 'no response'}
            </AlertDescription>
          </Alert>
        ))}
        {!fleet ? (
          <SessionListSkeleton />
        ) : turnOnly && shown.length === 0 && !query ? (
          <div className="px-4 py-10 text-center text-sm text-dimmer">Nothing is waiting for you.</div>
        ) : shown.length > 0 ? (
          <nav aria-label="Sessions" className="flex flex-col gap-1.5">
            {stackRuns(fresh).map((e) => {
              const row = (s: Session, inStack?: boolean) => {
                const key = sessionKey(s)
                return <SessionRow key={key} session={s} now={now} selected={key === selectedKey} cursor={key === cursorKey && key !== selectedKey} inStack={inStack} turn={isTurn(s)} />
              }
              return e.kind === 'stack' ? (
                <StackGroup
                  key={e.key}
                  stackKey={e.key}
                  sessions={e.sessions}
                  renderRow={(s) => row(s, true)}
                  forceOpen={e.sessions.slice(1).some((s) => [selectedKey, cursorKey].includes(sessionKey(s)))}
                />
              ) : (
                row(e.session)
              )
            })}
            <IdleGroup
              label="Older than a day"
              sessions={stale}
              open={staleOpen || stale.some((x) => sessionKey(x) === cursorKey)}
              onToggle={toggleIdle}
              renderRow={(x) => <SessionRow key={sessionKey(x)} session={x} now={now} selected={sessionKey(x) === selectedKey} cursor={sessionKey(x) === cursorKey && sessionKey(x) !== selectedKey} turn={isTurn(x)} />}
            />
          </nav>
        ) : unreachable.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-dimmer">
            {space === 'bots' ? 'No bot is running right now.' : space ? space.empty : allSessions(fleet).length > 0 ? 'Nothing matches.' : 'No Claude sessions running.'}
          </div>
        ) : null}
        {fleet && !space ? <DormantSection now={now} host={host} query={query} desktop className="mt-4" /> : null}
        {fleet && !space ? <ClosedSection now={now} host={host} query={query} desktop className="mt-3" /> : null}
      </div>

    </div>
  )
}

/**
 * The app rail: always on the left, on every screen. Sessions (the list beside it) first, then
 * new / jump, the modules, and the helper screens at the bottom — one place to switch from.
 */
export function SidebarRail({
  waiting,
  spaceTurn,
  spaceActive,
  sessionsActive,
  onSessions,
  onNew,
  onPalette,
}: {
  waiting: number
  /** Sessions waiting for you in the lists kept apart (badges on the Bots and space icons). */
  spaceTurn?: Partial<Record<ModuleId, number>>
  /** A bot run or a space's session is open: its icon is the current place, not Sessions. */
  spaceActive?: ModuleId
  /** The sessions screen is showing (with or without its list). */
  sessionsActive: boolean
  onSessions: () => void
  onNew: () => void
  onPalette: () => void
}) {
  return (
    <nav aria-label="App" data-sidebar-rail data-tauri-drag-region className="titlebar-rail flex h-full w-12 shrink-0 flex-col items-center gap-1 border-r py-3">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Sessions"
        aria-current={sessionsActive ? 'page' : undefined}
        title={withHint('Sessions', 'sidebar')}
        onClick={onSessions}
        className={cn('relative text-dimmer hover:text-foreground', sessionsActive && 'bg-accent text-foreground')}
      >
        <MessagesSquareIcon />
        {waiting > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full bg-status-waiting px-1 text-[0.625rem] font-semibold text-background tabular-nums" aria-label={`${waiting} sessions waiting for you`}>
            {waiting}
          </span>
        ) : null}
      </Button>
      <Button size="icon" aria-label="New session" title={withHint('New session', 'new')} onClick={onNew} className="rounded-full">
        <PlusIcon />
      </Button>
      <ModuleButtons group="sessions" badges={spaceTurn} current={spaceActive} />
      <Button variant="ghost" size="icon" aria-label="Jump to a session" title={withHint('Jump to a session', 'palette')} onClick={onPalette} className="text-dimmer hover:text-foreground">
        <SearchIcon />
      </Button>
      <Button variant="ghost" size="icon" aria-label="Park a thought" title={withHint('Park a thought', 'park')} onClick={openPark} className="text-dimmer hover:text-foreground">
        <LightbulbIcon />
      </Button>
      <span aria-hidden className="my-1 h-px w-6 bg-border" />
      <ModuleButtons group="work" />
      <div className="mt-auto flex flex-col items-center gap-1">
        <FocusToggle />
        <ModuleButtons group="utility" />
      </div>
    </nav>
  )
}

/** Link to the notes explorer; nothing when no host has notes. */
export function NotesLink({ className, size = 'icon' }: { className?: string; size?: 'icon' | 'icon-sm' }) {
  const hosts = useNotesHosts()
  if (!hosts.length) return null
  return (
    <Button asChild variant="ghost" size={size} className={cn('text-dimmer hover:text-foreground', className)}>
      <a href="#/notes" aria-label="Notes" title={withHint('Notes', 'notes')}>
        <NotebookTextIcon />
      </a>
    </Button>
  )
}


/** Idle sessions folded into one row ("Idle · 12"); open while searching or when one is selected. */
function IdleGroup({ label, sessions, open, onToggle, renderRow }: { label: string; sessions: Session[]; open: boolean; onToggle: () => void; renderRow: (s: Session) => ReactNode }) {
  if (!sessions.length) return null
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs font-medium text-dimmer hover:text-foreground"
      >
        <ChevronRightIcon className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        {label} · {sessions.length}
      </button>
      {open ? <div className="mt-1.5 flex flex-col gap-1.5">{sessions.map(renderRow)}</div> : null}
    </div>
  )
}
