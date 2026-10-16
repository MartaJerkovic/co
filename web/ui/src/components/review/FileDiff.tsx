import { ChevronDownIcon, ChevronRightIcon, CopyIcon } from 'lucide-react'
import { memo } from 'react'

import type { DiffFile, DiffHunk, DiffLine } from '@/api/types'
import { Button } from '@/components/ui/button'
import { copyWithToast } from '@/lib/clipboard'
import { diffBar, fileAnchor, splitRows } from '@/lib/review'
import { cn } from '@/lib/utils'

export type DiffView = 'unified' | 'split'

const STATUS_LABEL: Record<DiffFile['status'], string> = { added: 'A', deleted: 'D', modified: 'M', renamed: 'R', copied: 'C' }
const STATUS_TONE: Record<DiffFile['status'], string> = {
  added: 'text-diff-add',
  deleted: 'text-diff-del',
  modified: 'text-status-waiting',
  renamed: 'text-primary',
  copied: 'text-primary',
}

export function StatusLetter({ status, className }: { status: DiffFile['status']; className?: string }) {
  return (
    <span title={status} className={cn('w-3 shrink-0 text-center font-mono text-[0.6875rem] font-bold', STATUS_TONE[status], className)}>
      {STATUS_LABEL[status]}
    </span>
  )
}

export function DiffStat({ additions, deletions, bar = true }: { additions: number; deletions: number; bar?: boolean }) {
  const green = diffBar(additions, deletions)
  const total = additions + deletions
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-xs tabular-nums">
      <span className="text-diff-add">+{additions}</span>
      <span className="text-diff-del">−{deletions}</span>
      {bar ? (
        <span aria-hidden className="flex gap-px">
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className={cn('size-2 rounded-[2px]', !total ? 'bg-muted' : i < green ? 'bg-diff-add' : i < 5 ? 'bg-diff-del' : 'bg-muted')}
            />
          ))}
        </span>
      ) : null}
    </span>
  )
}

const lineBg = (l: DiffLine | null) => (!l ? 'bg-muted/40' : l.t === '+' ? 'bg-diff-add/10' : l.t === '-' ? 'bg-diff-del/10' : '')
const numBg = (l: DiffLine | null) => (!l ? 'bg-muted/40' : l.t === '+' ? 'bg-diff-add/20' : l.t === '-' ? 'bg-diff-del/20' : '')
const NUM = 'w-12 shrink-0 select-none px-2 text-right text-dimmer tabular-nums'
const CODE = 'min-w-0 flex-1 whitespace-pre-wrap break-all pr-3'

function Text({ l }: { l: DiffLine }) {
  return (
    <>
      {l.text || ' '}
      {l.noEol ? <span className="ml-1 text-dimmer" title="No newline at end of file">⏎̸</span> : null}
    </>
  )
}

function HunkHeader({ hunk }: { hunk: DiffHunk }) {
  return (
    <div className="flex bg-primary/5 font-mono text-xs leading-6 text-muted-foreground">
      <span className="truncate px-3">{hunk.header}</span>
    </div>
  )
}

function UnifiedHunk({ hunk }: { hunk: DiffHunk }) {
  return (
    <>
      <HunkHeader hunk={hunk} />
      {hunk.lines.map((l, i) => (
        <div key={i} className={cn('flex font-mono text-xs leading-5', lineBg(l))}>
          <span className={cn(NUM, numBg(l))}>{l.o ?? ''}</span>
          <span className={cn(NUM, numBg(l))}>{l.n ?? ''}</span>
          <span className={cn('w-5 shrink-0 select-none text-center', l.t === '+' ? 'text-diff-add' : l.t === '-' ? 'text-diff-del' : 'text-dimmer')}>
            {l.t === ' ' ? '' : l.t === '-' ? '−' : '+'}
          </span>
          <span className={CODE}>
            <Text l={l} />
          </span>
        </div>
      ))}
    </>
  )
}

function SplitSide({ l, side }: { l: DiffLine | null; side: 'o' | 'n' }) {
  return (
    <div className={cn('flex min-w-0 flex-1 font-mono text-xs leading-5', lineBg(l))}>
      <span className={cn(NUM, numBg(l))}>{l ? l[side] : ''}</span>
      <span className={cn('w-5 shrink-0 select-none text-center', l?.t === '+' ? 'text-diff-add' : l?.t === '-' ? 'text-diff-del' : 'text-dimmer')}>
        {l && l.t !== ' ' ? (l.t === '-' ? '−' : '+') : ''}
      </span>
      <span className={CODE}>{l ? <Text l={l} /> : null}</span>
    </div>
  )
}

function SplitHunk({ hunk }: { hunk: DiffHunk }) {
  return (
    <>
      <HunkHeader hunk={hunk} />
      {splitRows(hunk).map((r, i) => (
        <div key={i} className="flex divide-x">
          <SplitSide l={r.left} side="o" />
          <SplitSide l={r.right} side="n" />
        </div>
      ))}
    </>
  )
}

export interface FileDiffProps {
  file: DiffFile
  view: DiffView
  collapsed: boolean
  viewed: boolean
  /** changed since the last poll that showed it */
  fresh: boolean
  onToggleCollapsed: (path: string) => void
  onToggleViewed: (path: string) => void
}

/** One file's card: the GitHub "Files changed" header (path, +/−, Viewed) over its hunks. */
export const FileDiff = memo(function FileDiff({ file, view, collapsed, viewed, fresh, onToggleCollapsed, onToggleViewed }: FileDiffProps) {
  const Hunk = view === 'split' ? SplitHunk : UnifiedHunk
  const open = !collapsed && !viewed
  return (
    <section
      id={fileAnchor(file.path)}
      aria-label={file.path}
      className={cn('scroll-mt-3 overflow-hidden rounded-lg border bg-background [content-visibility:auto]', fresh && 'ring-2 ring-primary/40')}
    >
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-card px-2 py-1.5">
        <Button variant="ghost" size="icon" className="size-7" aria-label={open ? 'Collapse' : 'Expand'} aria-expanded={open} onClick={() => onToggleCollapsed(file.path)}>
          {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
        </Button>
        <StatusLetter status={file.status} />
        <span className="min-w-0 truncate font-mono text-[0.8125rem]" title={file.path}>
          {file.oldPath && file.oldPath !== file.path ? (
            <>
              <span className="text-dimmer">{file.oldPath} → </span>
              {file.path}
            </>
          ) : (
            file.path
          )}
        </span>
        <Button variant="ghost" size="icon" className="size-7 shrink-0 text-dimmer" aria-label="Copy path" title="Copy path" onClick={() => void copyWithToast(file.path)}>
          <CopyIcon className="size-3.5" />
        </Button>
        <span className="flex-1" />
        <DiffStat additions={file.additions} deletions={file.deletions} />
        <label className={cn('ml-1 flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs', viewed && 'border-primary/40 bg-primary/10')}>
          <input type="checkbox" checked={viewed} onChange={() => onToggleViewed(file.path)} className="accent-primary" />
          Viewed
        </label>
      </header>
      {open ? (
        <div className="overflow-x-auto">
          {file.binary ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">Binary file not shown.</p>
          ) : !file.hunks.length ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">{file.truncated ? 'Diff too large to show.' : 'No content changes (mode or rename only).'}</p>
          ) : (
            file.hunks.map((h, i) => <Hunk key={i} hunk={h} />)
          )}
          {file.truncated && file.hunks.length ? <p className="border-t px-4 py-2 text-xs text-muted-foreground">Diff cut short — too many lines.</p> : null}
        </div>
      ) : null}
    </section>
  )
})

