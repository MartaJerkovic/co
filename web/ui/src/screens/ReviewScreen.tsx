import { ChevronLeftIcon, Columns2Icon, FoldVerticalIcon, GitBranchIcon, ListTreeIcon, MessageSquareTextIcon, RowsIcon, UnfoldVerticalIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'wouter'

import { HostBadge } from '@/components/HostBadge'
import { DiffStat, FileDiff, type DiffView } from '@/components/review/FileDiff'
import { FileTree } from '@/components/review/FileTree'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useFleet } from '@/hooks/useFleet'
import { useDiff } from '@/hooks/useDiff'
import { useNow } from '@/hooks/useNow'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useSessionTitle } from '@/hooks/useTitles'
import { relTime } from '@/lib/format'
import { fileAnchor, fileSignature, fileTree, parseReviewLocation, treeOrder } from '@/lib/review'
import { findSession, sessionHref } from '@/lib/sessions'
import { storage } from '@/lib/storage'
import { cn } from '@/lib/utils'
import { SessionScreen } from '@/screens/SessionScreen'

/** A file whose diff changed in the last update keeps its highlight this long. */
const FRESH_MS = 10_000
const parseView = (r: string) => (r === 'split' || r === 'unified' ? r : undefined)
const parseBool = (r: string) => (r === 'true' ? true : r === 'false' ? false : undefined)

/**
 * `#/review/<host>/<id>`: GitHub's "Files changed" over the session's worktree, following it
 * live. Desktop (`pane`): file tree | diff | the session itself (chat + composer), so the
 * review and the conversation sit side by side. Mobile: the diff alone.
 */
export function ReviewScreen({ layout = 'screen' }: { layout?: 'screen' | 'pane' }) {
  const pane = layout === 'pane'
  const [location, navigate] = useLocation()
  const loc = parseReviewLocation(location)
  const host = loc?.host ?? ''
  const id = loc?.id ?? ''
  const { fleet } = useFleet()
  const session = findSession(fleet, host, id)
  const { title } = useSessionTitle(session, `${host}/${id}`)
  const now = useNow(5_000)
  const { data, error, changedAt } = useDiff(host, id)

  const [view, setView] = usePersistentState<DiffView>('fleet.diffView', pane ? 'split' : 'unified', parseView)
  const [showTree, setShowTree] = usePersistentState<boolean>('fleet.reviewTree', true, parseBool)
  const [showChat, setShowChat] = usePersistentState<boolean>('fleet.reviewChat', true, parseBool)

  const files = useMemo(() => data?.files ?? [], [data])
  const tree = useMemo(() => fileTree(files), [files])
  const ordered = useMemo(() => treeOrder(tree), [tree])
  const signatures = useMemo(() => new Map(files.map((f) => [f.path, fileSignature(f)])), [files])

  // Viewed: per session, path → the diff's signature when ticked (a new change unticks it).
  const viewedKey = `fleet.reviewViewed:${host}/${id}`
  const [viewedMap, setViewedMap] = useState<Record<string, string>>(() => storage.getJSON<Record<string, string>>(viewedKey) ?? {})
  const isViewed = useCallback((path: string) => viewedMap[path] != null && viewedMap[path] === signatures.get(path), [viewedMap, signatures])
  const toggleViewed = useCallback(
    (path: string) => {
      setViewedMap((m) => {
        const next = { ...m }
        if (next[path] != null && next[path] === signatures.get(path)) delete next[path]
        else next[path] = signatures.get(path) ?? ''
        storage.set(viewedKey, JSON.stringify(next))
        return next
      })
    },
    [signatures, viewedKey],
  )
  const viewedCount = files.filter((f) => isViewed(f.path)).length

  // Fresh: the files whose diff changed in the latest update (not on the first load).
  const prevSigs = useRef<Map<string, string> | null>(null)
  const [fresh, setFresh] = useState<{ paths: Set<string>; at: number }>({ paths: new Set(), at: 0 })
  useEffect(() => {
    if (!data) return // nothing loaded yet: the first answer is not a change
    const prev = prevSigs.current
    prevSigs.current = signatures
    if (!prev) return
    const changed = new Set([...signatures].filter(([p, s]) => prev.get(p) !== s).map(([p]) => p))
    if (changed.size) setFresh({ paths: changed, at: Date.now() })
  }, [data, signatures])
  const isFresh = useCallback((path: string) => fresh.paths.has(path) && now - fresh.at < FRESH_MS, [fresh, now])

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const toggleCollapsed = useCallback(
    (path: string) => {
      // A viewed file shows collapsed; expanding it unticks Viewed like GitHub does.
      if (isViewed(path)) return toggleViewed(path)
      setCollapsed((c) => {
        const next = new Set(c)
        if (next.has(path)) next.delete(path)
        else next.add(path)
        return next
      })
    },
    [isViewed, toggleViewed],
  )
  const allCollapsed = files.length > 0 && files.every((f) => collapsed.has(f.path) || isViewed(f.path))

  const [active, setActive] = useState<string | null>(null)
  const openFile = (path: string) => {
    setActive(path)
    setCollapsed((c) => {
      if (!c.has(path)) return c
      const next = new Set(c)
      next.delete(path)
      return next
    })
    requestAnimationFrame(() => document.getElementById(fileAnchor(path))?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }

  const back = () => navigate(session ? sessionHref(session) : `/s/${encodeURIComponent(host)}/${encodeURIComponent(id)}`)

  const header = (
    <header
      data-tauri-drag-region={pane ? 'deep' : undefined}
      className="z-20 shrink-0 border-b bg-background/90 pt-safe px-safe backdrop-blur-md backdrop-saturate-150"
    >
      <div className={cn('flex w-full items-center gap-1 py-1.5 pr-2', pane ? 'titlebar titlebar-lead pl-2 [--titlebar-pad:0.5rem]' : 'pl-1')}>
        <Button variant="ghost" size="icon" aria-label="Back to session" title="Back to session" onClick={back} className="size-11 shrink-0 rounded-xl">
          <ChevronLeftIcon className="size-6" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[0.9375rem] leading-tight font-bold">Changes · {title}</div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden text-xs whitespace-nowrap text-muted-foreground">
            <HostBadge host={host} className="h-4 px-1 text-[0.625rem]" />
            {data ? (
              <>
                <GitBranchIcon className="size-3 shrink-0" />
                <span className="truncate font-mono">
                  {data.branch ?? 'detached'}
                  {data.base.ref && data.base.ref !== data.branch ? <span className="text-dimmer"> ← {data.base.ref}</span> : null}
                </span>
                {data.stats ? (
                  <>
                    <span className="text-dimmer">·</span>
                    <span className="shrink-0">{data.stats.files} files</span>
                    <DiffStat additions={data.stats.additions} deletions={data.stats.deletions} bar={false} />
                  </>
                ) : null}
                {changedAt ? <span className="truncate text-dimmer tabular-nums">· changed {relTime(changedAt, now)} ago</span> : null}
              </>
            ) : null}
          </div>
        </div>
        {files.length ? (
          <span className="mr-1 hidden shrink-0 text-xs text-muted-foreground tabular-nums sm:inline">
            {viewedCount} / {files.length} viewed
          </span>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          className="size-10 shrink-0 rounded-xl"
          aria-label={allCollapsed ? 'Expand all' : 'Collapse all'}
          title={allCollapsed ? 'Expand all' : 'Collapse all'}
          onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(files.map((f) => f.path)))}
        >
          {allCollapsed ? <UnfoldVerticalIcon className="size-5" /> : <FoldVerticalIcon className="size-5" />}
        </Button>
        <ToggleGroup type="single" value={view} onValueChange={(v) => v && setView(v as DiffView)} spacing={0} aria-label="Diff layout" className="shrink-0 rounded-xl bg-muted p-0.5">
          <ToggleGroupItem value="unified" aria-label="Unified" title="Unified" className={toggleItem}>
            <RowsIcon />
          </ToggleGroupItem>
          <ToggleGroupItem value="split" aria-label="Split" title="Split" className={toggleItem}>
            <Columns2Icon />
          </ToggleGroupItem>
        </ToggleGroup>
        {pane ? (
          <>
            <Button variant="ghost" size="icon" aria-label="File tree" title="File tree" aria-pressed={showTree} onClick={() => setShowTree(!showTree)} className={cn('size-10 shrink-0 rounded-xl', showTree && 'bg-muted text-foreground')}>
              <ListTreeIcon className="size-5" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Session" title="Session" aria-pressed={showChat} onClick={() => setShowChat(!showChat)} className={cn('size-10 shrink-0 rounded-xl', showChat && 'bg-muted text-foreground')}>
              <MessageSquareTextIcon className="size-5" />
            </Button>
          </>
        ) : null}
      </div>
    </header>
  )

  const body = (
    <div className="min-w-0 flex-1 space-y-3 overflow-y-auto p-3">
      {error ? <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p> : null}
      {!data && !error ? <p className="px-1 py-6 text-center text-sm text-muted-foreground">Loading the diff…</p> : null}
      {data && !files.length ? (
        <div className="px-1 py-12 text-center">
          <p className="text-base font-semibold">No changes</p>
          <p className="mt-1 text-sm text-dimmer">
            The worktree matches {data.base.ref ?? 'HEAD'}
            {data.base.ref ? ` (${data.base.sha.slice(0, 7)})` : ''}. This view follows the session as it edits.
          </p>
        </div>
      ) : null}
      {data?.truncated ? <p className="text-xs text-muted-foreground">The diff is very large: later files are listed without their lines.</p> : null}
      {ordered.map((f) => (
        <FileDiff
          key={f.path}
          file={f}
          view={view}
          collapsed={collapsed.has(f.path)}
          viewed={isViewed(f.path)}
          fresh={isFresh(f.path)}
          onToggleCollapsed={toggleCollapsed}
          onToggleViewed={toggleViewed}
        />
      ))}
    </div>
  )

  if (!loc) return null
  if (!pane) {
    return (
      <div className="flex h-dvh flex-col bg-background">
        {header}
        {body}
      </div>
    )
  }
  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {header}
        <div className="flex min-h-0 flex-1">
          {showTree && files.length ? (
            <aside aria-label="Changed files" className="w-64 shrink-0 overflow-y-auto border-r px-1.5">
              <FileTree nodes={tree} viewed={isViewed} fresh={isFresh} active={active} onOpen={openFile} />
            </aside>
          ) : null}
          {body}
        </div>
      </div>
      {showChat ? (
        <aside aria-label="Session" className="flex w-[28rem] shrink-0 border-l xl:w-[32rem]">
          <SessionScreen key={`${host}/${id}`} host={host} id={id} layout="pane" embedded />
        </aside>
      ) : null}
    </div>
  )
}

const toggleItem =
  'size-9 rounded-[10px] text-muted-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm dark:data-[state=on]:bg-accent [&_svg:not([class*=size-])]:size-[18px]'
