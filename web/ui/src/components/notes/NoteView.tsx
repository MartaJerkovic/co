import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { CircleAlertIcon, CodeXmlIcon, CopyIcon, Loader2Icon, LockIcon, SendIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useLocation } from 'wouter'

import { api, noteRawUrl } from '@/api/client'
import type { NoteEntry, NoteFile } from '@/api/types'
import { HostBadge } from '@/components/HostBadge'
import { Linkified, Markdown } from '@/components/Markdown'
import { SendNoteDialog } from '@/components/notes/SendNoteDialog'
import { CodeLines } from '@/components/session/FilePreview'
import { Button } from '@/components/ui/button'
import { FileLinksContext, HighlightContext, type FileLinkApi } from '@/hooks/useFileLinks'
import { useNoteFile } from '@/hooks/useNotes'
import { copyWithToast } from '@/lib/clipboard'
import { relTime } from '@/lib/format'
import { isLocalHref } from '@/lib/markdown'
import { metaText, notesHref, resolveNoteLink, type NoteIndex } from '@/lib/notes'
import { cn } from '@/lib/utils'

export interface NoteViewProps {
  host: string
  path: string
  entry: NoteEntry | null
  index: NoteIndex
  /** Words to mark (the active search). */
  highlight: string[]
  /** Scroll to the first mark once loaded (opened from a search result). */
  scrollToHit: boolean
  /** Desktop pane (wider column, editor link) vs the mobile screen. */
  desktop?: boolean
  /** Rendered above the note (the mobile back bar). */
  header?: ReactNode
}

/** One note: title, path, frontmatter, then the body — links to other notes stay in the explorer. */
export function NoteView({ host, path, entry, index, highlight, scrollToHit, desktop = false, header }: NoteViewProps) {
  const [, navigate] = useLocation()
  const loaded = useNoteFile(host, entry?.kind === 'image' ? null : path, entry?.mtime)
  // A save returns the note as written; show that until the next load catches up.
  const [saved, setSaved] = useState<NoteFile | null>(null)
  const file = saved && saved.path === path && (!loaded.file || loaded.file.path !== path || saved.mtime >= loaded.file.mtime) ? saved : loaded.file
  const { error, loading } = loaded
  const [editingFor, setEditingFor] = useState<string | null>(null)
  const editing = editingFor === `${host}/${path}`
  const editable = !!file && !file.encrypted && file.kind === 'markdown'
  const [sourceFor, setSourceFor] = useState<string | null>(null)
  const source = sourceFor === `${host}/${path}`
  const [sendOpen, setSendOpen] = useState(false)

  const links = useMemo<FileLinkApi>(
    () => ({
      isLink: (raw, src) => (src === 'file' || src === 'wiki') && !!resolveNoteLink(index, path, raw, src === 'wiki'),
      open: (raw, src) => {
        const target = resolveNoteLink(index, path, raw, src === 'wiki')
        if (target) navigate(notesHref(host, target.path))
        else toast.error(`No note at ${raw}`)
      },
      imageSrc: (src) => {
        if (!isLocalHref(src)) return null
        const target = resolveNoteLink(index, path, src)
        return target?.kind === 'image' ? noteRawUrl(host, target.path) : null
      },
    }),
    [index, path, host, navigate],
  )

  const bodyRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!file || !scrollToHit) return
    bodyRef.current?.querySelector('[data-hit]')?.scrollIntoView({ block: 'center' })
  }, [file, scrollToHit])

  const title = file?.title ?? entry?.title ?? path.split('/').pop() ?? path
  const abs = file?.abs ?? null

  let body: ReactNode
  if (entry?.kind === 'image') {
    body = (
      <div className="flex justify-center p-4">
        <img src={noteRawUrl(host, path)} alt={path} className="max-w-full rounded-md object-contain" />
      </div>
    )
  } else if (error) {
    body = (
      <p className="flex items-center gap-2 px-4 py-10 text-sm text-destructive">
        <CircleAlertIcon className="size-4 shrink-0" /> {error}
      </p>
    )
  } else if (!file || loading) {
    body = (
      <p className="flex items-center gap-2 px-4 py-10 text-sm text-dimmer">
        <Loader2Icon className="size-4 animate-spin" /> Loading…
      </p>
    )
  } else if (editing && editable) {
    body = <NoteEditor key={`${host}/${path}`} host={host} file={file} desktop={desktop} onSaved={setSaved} onDone={() => setEditingFor(null)} />
  } else if (file.kind === 'markdown' && !source) {
    body = (
      <div
        className={cn('mx-auto w-full px-4 pt-2 pb-10', desktop ? 'max-w-3xl' : 'max-w-2xl', editable && 'cursor-text')}
        style={{ fontSize: '0.9375rem', lineHeight: 1.6 }}
        onClick={(e) => editable && startEditing(e, () => setEditingFor(`${host}/${path}`))}
        title={editable ? 'Click to edit' : undefined}
      >
        {file.meta.length ? <Frontmatter meta={file.meta} /> : null}
        {file.encrypted ? (
          <p className="mb-3 flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
            <LockIcon className="size-3.5 shrink-0" /> Encrypted content is not shown here.
          </p>
        ) : null}
        <HighlightContext.Provider value={highlight}>
          <FileLinksContext.Provider value={links}>
            <Markdown text={file.body} notes />
          </FileLinksContext.Provider>
        </HighlightContext.Provider>
      </div>
    )
  } else {
    body = (
      <div className="overflow-x-auto">
        <CodeLines text={file.text} />
      </div>
    )
  }

  return (
    <article aria-label={title} className="flex min-h-0 min-w-0 flex-1 flex-col">
      {header}
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className={cn('mx-auto w-full px-4 pt-4 pb-2', desktop ? 'max-w-3xl' : 'max-w-2xl')}>
          <h1 className="text-xl leading-tight font-bold tracking-tight [overflow-wrap:anywhere]">{title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <HostBadge host={host} />
            <span className="min-w-0 font-mono break-all text-dimmer">{path}</span>
            {entry?.mtime ? <span className="text-dimmer tabular-nums">· modified {relTime(entry.mtime)} ago</span> : null}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {file?.kind === 'markdown' ? (
              <Button variant="outline" size="sm" onClick={() => setSourceFor(source ? null : `${host}/${path}`)} aria-pressed={source}>
                {source ? 'Rendered' : 'Source'}
              </Button>
            ) : null}
            {abs ? (
              <Button variant="outline" size="sm" onClick={() => void copyWithToast(abs)}>
                <CopyIcon /> Copy path
              </Button>
            ) : null}
            {abs ? (
              <Button variant="outline" size="sm" onClick={() => setSendOpen(true)} title="Open a session with this note's path in its composer">
                <SendIcon /> Send to session
              </Button>
            ) : null}
            {file?.editorUrl ? (
              <Button asChild variant="outline" size="sm" className="pointer-coarse:hidden">
                <a href={file.editorUrl}>
                  <CodeXmlIcon /> Open in {/^cursor:/.test(file.editorUrl) ? 'Cursor' : 'VS Code'}
                </a>
              </Button>
            ) : null}
          </div>
        </div>
        {body}
      </div>
      {abs ? <SendNoteDialog open={sendOpen} onOpenChange={setSendOpen} host={host} absPath={abs} /> : null}
    </article>
  )
}

/** A click on the note's text (not on a link, image or selection) opens the editor. */
function startEditing(e: MouseEvent, open: () => void) {
  if ((e.target as HTMLElement).closest('a, button, img, input, summary')) return
  if (window.getSelection()?.toString()) return
  open()
}

/** How long typing pauses before the note is written. */
const SAVE_DELAY_MS = 600

/** The note as plain text, saved as you type; Esc or clicking away goes back to the rendered note. */
function NoteEditor({ host, file, desktop, onSaved, onDone }: { host: string; file: NoteFile; desktop: boolean; onSaved: (f: NoteFile) => void; onDone: () => void }) {
  const [text, setText] = useState(file.text)
  const [state, setState] = useState<'saved' | 'saving' | 'error'>('saved')
  const base = useRef(file.mtime)
  const written = useRef(file.text)
  const ref = useRef<HTMLTextAreaElement>(null)

  // Saves run one after another, each with the mtime the previous one returned: two in flight
  // would carry the same base and the second would be refused as a conflict.
  const queue = useRef<Promise<void>>(Promise.resolve())
  const save = (value: string) => {
    queue.current = queue.current.then(() => write(value))
    return queue.current
  }
  const write = async (value: string) => {
    if (value === written.current) return
    setState('saving')
    try {
      const f = await api.saveNote(host, file.path, value, base.current)
      base.current = f.mtime
      written.current = value
      onSaved(f)
      setState('saved')
    } catch (err) {
      setState('error')
      toast.error(err instanceof Error ? err.message : 'Could not save the note')
    }
  }

  useEffect(() => {
    if (text === written.current) return
    const t = setTimeout(() => void save(text), SAVE_DELAY_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [text])

  useEffect(() => {
    const el = ref.current
    el?.focus()
    el?.setSelectionRange(el.value.length, el.value.length)
  }, [])

  const finish = () => {
    void save(text)
    onDone()
  }

  return (
    <div className={cn('mx-auto w-full px-4 pt-2 pb-10', desktop ? 'max-w-3xl' : 'max-w-2xl')}>
      <textarea
        ref={ref}
        aria-label={`Edit ${file.path}`}
        value={text}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            finish()
          }
        }}
        className="block w-full resize-none overflow-hidden bg-transparent font-sans outline-none"
        style={{ fontSize: '0.9375rem', lineHeight: 1.6 }}
      />
      <p className="pt-2 text-[0.6875rem] text-dimmer" aria-live="polite">
        {state === 'saving' ? 'Saving…' : state === 'error' ? 'Not saved' : 'Saved · Esc to finish'}
      </p>
    </div>
  )
}

/** Frontmatter as a compact key → value grid; lists as chips, URLs as links. */
function Frontmatter({ meta }: { meta: NoteFile['meta'] }) {
  return (
    <dl className="mb-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
      {meta.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-mono text-dimmer">{k}</dt>
          <dd className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">
            {Array.isArray(v) ? (
              <span className="flex flex-wrap gap-1">
                {v.map((x) => (
                  <span key={x} className="rounded-md bg-foreground/[0.07] px-1.5 py-px font-medium text-foreground/80">
                    {k === 'tags' || k === 'tag' ? `#${x.replace(/^#/, '')}` : x}
                  </span>
                ))}
              </span>
            ) : (
              <Linkified text={metaText(v)} />
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}
