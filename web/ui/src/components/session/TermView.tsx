import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Loader2Icon } from 'lucide-react'

import type { TermCursor } from '@/api/types'
import { Linkified } from '@/components/Markdown'
import { LatestButton } from '@/components/session/LatestButton'
import { FileLinksContext, type FileStats } from '@/hooks/useFileLinks'
import { useFollowScroll } from '@/hooks/useFollowScroll'
import { hasAnsi, parseAnsi, placeCursor, stripAnsi, type AnsiStyle } from '@/lib/ansi'
import { textPathCandidates } from '@/lib/paths'
import { termFontRem } from '@/lib/prefs'
import { termInput, type TermInput } from '@/lib/termKeys'
import { cn } from '@/lib/utils'

export interface TermViewProps {
  /** null = not loaded yet. */
  text: string | null
  failed: boolean
  /** px at the default text size (`fleet.termFont`); rendered in rem, so it follows the text size. */
  fontSize: number
  jumpSignal: number
  /** Link file paths that exist on the session's host (click → preview). */
  fileLinks?: FileStats
  /** The terminal cursor (tmux), drawn as a block. */
  cursor?: TermCursor | null
  /** Keystrokes typed while the view has focus go to the session's terminal. */
  onInput?: (input: TermInput) => void
}

/**
 * Without colours in the capture (iTerm), Claude Code's lines are tinted by shape: its replies
 * bright, diffs green / red, tool output dim. tmux captures keep the real colours (AnsiLines).
 */
function lineClass(line: string): string | null {
  if (/^\s*\d+\s+\+/.test(line) || /^\s*\+(?!\+)/.test(line)) return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  if (/^\s*\d+\s+-/.test(line) || /^\s*-(?!-)/.test(line)) return 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
  if (/^[●⏺] /.test(line)) return 'text-foreground'
  if (/^[✳✻✶✢✽*·] \S.*…/.test(line)) return 'text-status-busy'
  if (/^\s*[⎿└]/.test(line)) return 'text-dimmer'
  if (/^❯/.test(line)) return 'text-foreground'
  return null
}

const isRule = (line: string) => /^[─━-]{20,}$/.test(line.trim())

function Colored({ text }: { text: string }) {
  return text.split('\n').map((line, i) =>
    isRule(line) ? (
      <span key={i} aria-hidden className="my-1.5 block border-t border-border" />
    ) : (
      <span key={i} className={cn('block min-h-[1.32em]', lineClass(line) ?? 'text-muted-foreground')}>
        <Linkified text={line} />
      </span>
    ),
  )
}

const css = (st: AnsiStyle): React.CSSProperties => ({
  color: st.inverse ? (st.background ?? 'var(--background)') : st.color,
  backgroundColor: st.inverse ? (st.color ?? 'var(--foreground)') : st.background,
  fontWeight: st.bold ? 600 : undefined,
  opacity: st.dim ? 0.6 : undefined,
  fontStyle: st.italic ? 'italic' : undefined,
  textDecoration: st.underline ? 'underline' : undefined,
})

/** The capture with the terminal's own colours; links and file paths stay clickable. */
function AnsiLines({ text, cursor }: { text: string; cursor?: TermCursor | null }) {
  const lines = parseAnsi(text)
  return (cursor ? placeCursor(lines, cursor) : lines).map((segments, i) => {
    const plain = segments.map((s) => s.text).join('')
    if (isRule(plain)) return <span key={i} aria-hidden className="my-1.5 block border-t border-border" />
    return (
      <span key={i} className="block min-h-[1.32em]">
        {segments.map((s, j) => (
          s.cursor ? (
            <span key={j} className="bg-foreground/80 text-background">
              {s.text}
            </span>
          ) : (
            <span key={j} style={css(s.style)}>
              <Linkified text={s.text} />
            </span>
          )
        ))}
      </span>
    )
  })
}

/** A capture as the terminal shows it: its own colours (tmux) or tinted by shape (iTerm). */
export function TermScreen({ text, cursor }: { text: string; cursor?: TermCursor | null }) {
  return hasAnsi(text) ? <AnsiLines text={text} cursor={cursor} /> : <Colored text={text} />
}

/**
 * Raw terminal capture (`peek`), links and file paths clickable, follow-scroll with "↓ latest".
 * Scrolled up, the view holds still (the capture is a moving window of the last lines); "↓ latest"
 * catches up.
 */
export function TermView({ text: live, failed, fontSize, jumpSignal, fileLinks, cursor: liveCursor, onInput }: TermViewProps) {
  const { ref, following, stick, jump, onScroll } = useFollowScroll<HTMLPreElement>(40)
  // A fullscreen app (Claude Code's fullscreen TUI) keeps its own history: the capture is only its
  // screen, always shown live, and the wheel pages through the history (PageUp / PageDown).
  const paging = !!onInput && !!liveCursor?.alternate
  const [shown, setShown] = useState({ text: live, cursor: liveCursor })
  if ((following || paging || shown.text === null) && (shown.text !== live || shown.cursor !== liveCursor)) setShown({ text: live, cursor: liveCursor })
  const { text, cursor } = shown
  const wheel = useRef(0)
  const inputRef = useRef(onInput)
  useEffect(() => {
    inputRef.current = onInput
  })
  useEffect(() => {
    const el = ref.current
    if (!el || !paging) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      wheel.current += e.deltaY
      if (Math.abs(wheel.current) < WHEEL_PAGE_PX) return
      inputRef.current?.({ key: wheel.current < 0 ? 'PageUp' : 'PageDown' })
      wheel.current = 0
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [ref, paging])
  useEffect(() => {
    if (paging) jump()
  }, [paging, jump])

  useLayoutEffect(() => {
    stick()
  }, [text, fontSize, stick])

  useEffect(() => {
    if (jumpSignal) jump()
  }, [jumpSignal, jump])

  const requestStats = fileLinks?.request
  useEffect(() => {
    if (!requestStats || !text) return
    const candidates = textPathCandidates(stripAnsi(text))
    if (candidates.length) requestStats(candidates)
  }, [text, requestStats])

  return (
    <div className="relative min-h-0 flex-1 bg-background">
      <pre
        ref={ref}
        onScroll={onScroll}
        tabIndex={0}
        aria-label={onInput ? 'Terminal, type to send keys' : 'Terminal output'}
        onKeyDown={(e) => {
          const input = onInput && termInput(e.nativeEvent)
          if (!input) return
          e.preventDefault()
          onInput(input)
        }}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData('text')
          if (!onInput || !pasted.trim()) return
          e.preventDefault()
          onInput({ text: pasted })
        }}
        className="absolute inset-0 m-0 overflow-auto overscroll-contain px-safe font-mono whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground/90 outline-none [overflow-anchor:none] [tab-size:4]"
        style={{ fontSize: termFontRem(fontSize), lineHeight: 1.32 }}
      >
        <span className="mx-auto block w-full max-w-4xl px-4 pt-3 pb-6">
          {text === null ? (
            failed ? null : (
              <span className="flex items-center gap-2 font-sans text-sm text-dimmer">
                <Loader2Icon className="size-4 animate-spin" /> Connecting…
              </span>
            )
          ) : fileLinks ? (
            <FileLinksContext.Provider value={fileLinks.api}>
              <TermScreen text={text} cursor={cursor} />
            </FileLinksContext.Provider>
          ) : (
            <TermScreen text={text} cursor={cursor} />
          )}
        </span>
      </pre>
      <LatestButton show={!following} onClick={jump} />
    </div>
  )
}

/** Wheel travel (px) that pages a fullscreen app once. */
const WHEEL_PAGE_PX = 80
