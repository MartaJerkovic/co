import { memo, useEffect, useLayoutEffect, useRef } from 'react'
import { BotIcon, ChevronRightIcon, ChevronsUpIcon, ClipboardIcon, ClockIcon, HandIcon, Loader2Icon, MessageSquareDashedIcon, SquareSlashIcon, TerminalIcon } from 'lucide-react'

import type { Message } from '@/api/types'
import { LatestButton } from '@/components/session/LatestButton'
import { QuestionCard, type QuestionActions } from '@/components/session/QuestionCard'
import { TermScreen } from '@/components/session/TermView'
import { Linkified, Markdown } from '@/components/Markdown'
import { Button } from '@/components/ui/button'
import { FileLinksContext, type FileStats } from '@/hooks/useFileLinks'
import { useFollowScroll } from '@/hooks/useFollowScroll'
import { useNow } from '@/hooks/useNow'
import { clockTime } from '@/lib/format'
import { SpeakButton } from '@/components/SpeakButton'
import { msgKind, sameGroup, splitPasted, visibleMessages } from '@/lib/chat'
import { pendingQuestion } from '@/lib/questions'
import { pathCandidates, textPathCandidates } from '@/lib/paths'
import { CHAT_FONT_REM } from '@/lib/prefs'
import type { WorkingInfo } from '@/lib/sessions'
import { termInput, type TermInput } from '@/lib/termKeys'
import { cn } from '@/lib/utils'

export interface ChatViewProps {
  /** null = not loaded yet. */
  messages: Message[] | null
  /** No transcript on disk (404 from /messages). */
  noTranscript: boolean
  /** The session no longer exists. */
  gone?: boolean
  hideNotes: boolean
  status: string
  waitingFor?: string | null
  /** What a busy session is doing, read from its terminal (spinner, step, to-dos). */
  working?: WorkingInfo | null
  /** The bottom of the terminal while Claude waits there on something the chat can't show; typing in it goes to the terminal. */
  screenTail?: string | null
  onTermInput?: (input: TermInput) => void
  /** Older messages exist and a bigger limit is available. */
  canLoadOlder: boolean
  loadingOlder: boolean
  onLoadOlder: () => void
  /** Bumped by the parent to jump to the bottom (after a send). */
  jumpSignal: number
  /** Desktop pane: a wider (still readable) column. */
  wide?: boolean
  /** Link file paths in the chat (Claude's messages and prompts) that exist on the session's host (click → preview). */
  fileLinks?: FileStats
  /** The outbox's optimistic bubbles, after the transcript; `outboxKey` changes when they do (keeps the tail followed). */
  outbox?: React.ReactNode
  outboxKey?: string
  /** Answer / dismiss Claude's pending question from its card; absent = the card is read-only. */
  questionActions?: QuestionActions | null
  /** A bot run shown from its start: its first prompt is the bot's recipe, shown folded. */
  bot?: boolean
}

/** Longer pastes start collapsed. */
const PASTE_OPEN_LINES = 6

/** A user prompt: typed text, with `<pasted_content>` blocks shown as collapsible quotes. */
function UserText({ text }: { text: string }) {
  const parts = splitPasted(text)
  if (parts.length === 1 && !parts[0].pasted) return <Linkified text={text} />
  return (
    <div className="flex flex-col gap-1.5">
      {parts.map((part, i) => {
        if (!part.pasted)
          return (
            <div key={i}>
              <Linkified text={part.text} />
            </div>
          )
        const lines = part.text.split('\n').length
        return (
          <details key={i} open={lines <= PASTE_OPEN_LINES} className="group rounded-lg border border-primary/20 bg-background/40 text-[0.9em]">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1 text-[0.8em] text-muted-foreground select-none [&::-webkit-details-marker]:hidden">
              <ChevronRightIcon className="size-3 transition-transform group-open:rotate-90" />
              <ClipboardIcon className="size-3" />
              Pasted · {lines} {lines === 1 ? 'line' : 'lines'}
            </summary>
            <div className="max-h-80 overflow-y-auto border-t border-primary/15 px-2 py-1.5">
              <Linkified text={part.text} />
            </div>
          </details>
        )
      })}
    </div>
  )
}

/** A bot's recipe (the run's first prompt), folded to one line. */
function BotInstructions({ text, caption }: { text: string; caption: string }) {
  const lines = text.split('\n').length
  return (
    <div className="flex w-full flex-col items-end">
      <details className="group w-fit max-w-[85%] rounded-2xl border border-primary/25 bg-accent text-accent-foreground">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3.5 py-2 text-xs text-muted-foreground select-none [&::-webkit-details-marker]:hidden">
          <ChevronRightIcon className="size-3 transition-transform group-open:rotate-90" />
          <BotIcon className="size-3.5" />
          Bot instructions · {lines} {lines === 1 ? 'line' : 'lines'}
        </summary>
        <div className="max-h-96 overflow-y-auto border-t border-primary/15 px-3.5 py-2 whitespace-pre-wrap [overflow-wrap:anywhere]">
          <UserText text={text} />
        </div>
      </details>
      {caption ? <div className="px-1 pt-0.5 text-[0.625rem] text-dimmer tabular-nums">{caption}</div> : null}
    </div>
  )
}

/**
 * What Claude waits on in its terminal (a question, a permission prompt, a dialog), as the terminal
 * shows it and answered the same way: it takes the focus, and every key goes to the terminal.
 */
function TerminalPrompt({ screen, onInput }: { screen: string; onInput: (input: TermInput) => void }) {
  const ref = useRef<HTMLPreElement>(null)
  useEffect(() => ref.current?.focus({ preventScroll: true }), [])
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-xl border border-status-waiting/35 bg-card px-3.5 py-3" aria-live="polite">
      <div className="flex items-center gap-2 text-xs font-medium text-status-waiting">
        <HandIcon className="size-3.5 shrink-0" />
        Needs you · answer here as in the terminal
      </div>
      <pre
        ref={ref}
        tabIndex={0}
        aria-label="Terminal, type to send keys"
        onKeyDown={(e) => {
          const input = termInput(e.nativeEvent)
          if (!input) return
          e.preventDefault()
          onInput(input)
        }}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData('text')
          if (!pasted.trim()) return
          e.preventDefault()
          onInput({ text: pasted })
        }}
        className="m-0 overflow-x-auto rounded-lg bg-background px-3 py-2.5 font-mono text-xs leading-[1.32] whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground/90 outline-none focus-visible:ring-2 focus-visible:ring-status-waiting/40"
      >
        <TermScreen text={screen} />
      </pre>
    </div>
  )
}

/** A slash command, skill or `!` shell command, as a chip. */
function CommandChip({ name, shell }: { name: string; shell: boolean }) {
  const Icon = shell ? TerminalIcon : SquareSlashIcon
  return (
    <span className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 font-mono text-[0.6875rem] text-status-waiting/90">
      <Icon className="size-3" />
      {shell ? 'shell' : name}
    </span>
  )
}

const Bubble = memo(function Bubble({ m, caption, actions }: { m: Message; caption: string; actions?: QuestionActions | null }) {
  const kind = msgKind(m)
  const text = typeof m.text === 'string' ? m.text : ''
  if (kind === 'question' && Array.isArray(m.questions)) {
    return (
      <>
        <QuestionCard m={m} actions={actions} />
        {caption ? <div className="-mt-2 px-1 pt-0.5 text-[0.625rem] text-dimmer tabular-nums">{caption}</div> : null}
      </>
    )
  }
  if (kind === 'command' && m.name && m.args?.trim()) {
    // A command with arguments is a prompt in disguise: a user bubble headed by the command.
    const shell = m.name === '!'
    return (
      <div className="flex w-full flex-col items-end">
        <div className="flex w-fit max-w-[85%] flex-col gap-1.5 rounded-2xl border border-primary/25 bg-accent px-3.5 py-2 whitespace-pre-wrap text-accent-foreground [overflow-wrap:anywhere]">
          <div>
            <CommandChip name={m.name} shell={shell} />
          </div>
          <div className={shell ? 'font-mono text-[0.9em]' : undefined}>{shell ? m.args.trim() : <UserText text={m.args.trim()} />}</div>
        </div>
        {caption ? <div className="px-1 pt-0.5 text-[0.625rem] text-dimmer tabular-nums">{caption}</div> : null}
      </div>
    )
  }
  if (kind === 'command') {
    return (
      <div className="self-center text-center">
        <span className="inline-block rounded-full border bg-muted px-2.5 py-0.5 font-mono text-[0.6875rem] text-status-waiting/90 [overflow-wrap:anywhere]">
          {text}
        </span>
      </div>
    )
  }
  if (kind === 'system') {
    return <div className="max-w-[92%] self-center text-center text-[0.6875rem] text-dimmer [overflow-wrap:anywhere]">{text}</div>
  }
  const cap = caption ? <div className="px-1 pt-0.5 text-[0.625rem] text-dimmer tabular-nums">{caption}</div> : null
  if (kind === 'user') {
    // Queued: typed while Claude works; Claude Code hands it over between steps or at the turn's end.
    const queued = m.queued === true
    return (
      <div className="flex w-full flex-col items-end" data-queued={queued || undefined}>
        <div
          className={cn(
            'w-fit max-w-[85%] rounded-2xl border px-3.5 py-2 whitespace-pre-wrap text-accent-foreground [overflow-wrap:anywhere]',
            queued ? 'border-dashed border-primary/40 bg-accent/60 opacity-80' : 'border-primary/25 bg-accent',
          )}
        >
          <UserText text={text} />
        </div>
        {queued ? (
          <div className="flex items-center gap-1 px-1 pt-0.5 text-[0.6875rem] text-dimmer">
            <ClockIcon className="size-3" aria-hidden />
            Queued · Claude reads it when it finishes the current step
          </div>
        ) : (
          cap
        )}
      </div>
    )
  }
  // Agent text: the caption row carries a read-aloud button.
  const speakId = `${m.ts ?? ''}:${text.length}:${text.slice(0, 24)}`
  const agentCap = (
    <div className="flex items-center gap-1 px-1 pt-0.5 text-[0.625rem] text-dimmer tabular-nums">
      {caption ? <span>{caption}</span> : null}
      <SpeakButton text={text} id={speakId} className="-my-1" />
    </div>
  )
  if (m.final === false) {
    return (
      <div className="flex w-full flex-col items-start">
        <Markdown text={text} className="border-l-2 border-border pl-2.5 text-[0.86em] leading-normal text-muted-foreground" />
        {agentCap}
      </div>
    )
  }
  return (
    <div className="flex w-full flex-col items-start">
      <div className="w-full px-1 py-1">
        <Markdown text={text} className="space-y-3 leading-relaxed" />
      </div>
      {agentCap}
    </div>
  )
})

function Typing({ status, waitingFor, asking, working, screenTail, onTermInput }: { status: string; waitingFor?: string | null; asking: boolean; working?: WorkingInfo | null; screenTail?: string | null; onTermInput?: (input: TermInput) => void }) {
  if (screenTail && onTermInput) return <TerminalPrompt screen={screenTail} onInput={onTermInput} />
  if (status === 'busy') {
    const todos = working?.todos
    return (
      <div className="flex flex-col gap-1 px-1 pt-3 text-xs text-dimmer" aria-live="polite">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex shrink-0 gap-[3px]" aria-hidden>
            {[0, 0.18, 0.36].map((d) => (
              <i key={d} className="size-[5px] animate-dot rounded-full bg-status-busy motion-reduce:animate-none" style={{ animationDelay: `${d}s` }} />
            ))}
          </span>
          {working?.verb ? <span className="shrink-0 text-muted-foreground">{working.verb}</span> : null}
          {working?.meta ? <span className="truncate tabular-nums">{working.meta}</span> : null}
        </div>
        {working?.step ? <div className="truncate pl-[23px] font-mono text-[0.95em]">{working.step}</div> : null}
        {todos ? (
          <div className="truncate pl-[23px]">
            <span className="tabular-nums">
              {todos.done}/{todos.total}
            </span>
            {todos.current ? ` · ${todos.current}` : null}
          </div>
        ) : null}
      </div>
    )
  }
  if (status === 'waiting') {
    return (
      <div className="flex items-center gap-2 px-1 pt-3 text-xs font-medium text-status-waiting" aria-live="polite">
        <HandIcon className="size-3.5" />
        {asking ? 'Needs you · answer the question above' : `Needs you${waitingFor?.trim() ? ` · ${waitingFor.trim()}` : ' — Claude is waiting for an answer'}`}
      </div>
    )
  }
  return null
}

/** Conversation view: bubbles, markdown, "Load older", follow-scroll with "↓ latest". */
export function ChatView(p: ChatViewProps) {
  const { ref, following, setFollow, setTop, stick, jump, onScroll } = useFollowScroll<HTMLDivElement>(60)
  const all = visibleMessages(p.messages, p.hideNotes)
  // Only the prompt Claude waits on right now takes answers.
  // A tmux session's pending question is answered in the terminal's own prompt (TerminalPrompt): its
  // card is left out until the transcript records the answer.
  const raw = !!p.onTermInput
  const pending = p.status === 'waiting' ? pendingQuestion(p.messages) : null
  const asking = raw ? null : pending
  const list = raw && pending ? all.filter((m) => !(m.kind === 'question' && m.id === pending.id)) : all
  const now = useNow(60_000) // captions: "today" vs a date

  // Remember the scroll geometry of the last commit, so "Load older" (which prepends)
  // can keep the same message under the thumb.
  const lastHeight = useRef(0)
  const anchorPending = useRef(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (p.loadingOlder) anchorPending.current = true
    else if (anchorPending.current) {
      anchorPending.current = false
      setFollow(false)
      setTop(el.scrollTop + (el.scrollHeight - lastHeight.current))
    } else stick()
    lastHeight.current = el.scrollHeight
  }, [p.messages, p.hideNotes, p.status, p.loadingOlder, p.outboxKey, ref, setFollow, setTop, stick])

  useEffect(() => {
    if (p.jumpSignal) jump()
  }, [p.jumpSignal, jump])

  // The live "working" line, images and code blocks grow without a new message — keep the tail in view.
  const content = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = content.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => stick())
    ro.observe(el)
    return () => ro.disconnect()
  }, [stick])

  // Ask the host which of the paths in the chat exist (batched, cached per session): Claude's
  // markdown, and the plain text of prompts and command arguments.
  const requestStats = p.fileLinks?.request
  useEffect(() => {
    if (!requestStats || !p.messages) return
    const candidates: string[] = []
    for (const m of p.messages) {
      const kind = msgKind(m)
      if (kind === 'assistant' && typeof m.text === 'string') candidates.push(...pathCandidates(m.text))
      else if (kind === 'user' && typeof m.text === 'string') candidates.push(...textPathCandidates(m.text))
      else if (kind === 'command' && m.name !== '!' && typeof m.args === 'string') candidates.push(...textPathCandidates(m.args))
    }
    if (candidates.length) requestStats(candidates)
  }, [p.messages, requestStats])

  let body
  if (p.messages === null) {
    body = p.gone ? (
      <Empty icon={<MessageSquareDashedIcon className="size-6" />} text="This session has ended" />
    ) : p.noTranscript ? (
      <Empty icon={<MessageSquareDashedIcon className="size-6" />} text="No transcript for this session yet" />
    ) : (
      <Empty icon={<Loader2Icon className="size-5 animate-spin" />} text="Loading conversation…" />
    )
  } else if (list.length === 0) {
    body = (
      <Empty
        icon={<MessageSquareDashedIcon className="size-6" />}
        text={p.messages.length ? 'Only progress notes here — show them from the ⋯ menu' : 'No messages yet'}
      />
    )
  } else {
    body = (
      <div className="flex flex-col gap-2.5">
        {list.map((m, i) =>
          p.bot && i === 0 && msgKind(m) === 'user' && typeof m.text === 'string' ? (
            <BotInstructions key={i} text={m.text} caption={sameGroup(m, list[i + 1]) ? '' : clockTime(m.ts, now)} />
          ) : (
            <Bubble key={i} m={m} caption={sameGroup(m, list[i + 1]) ? '' : clockTime(m.ts, now)} actions={m === asking ? p.questionActions : null} />
          ),
        )}
      </div>
    )
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={ref}
        onScroll={onScroll}
        tabIndex={0}
        aria-label="Conversation"
        className="absolute inset-0 overflow-x-hidden overflow-y-auto overscroll-contain px-safe outline-none [overflow-anchor:none]"
        style={{ fontSize: CHAT_FONT_REM, lineHeight: 1.5 }}
      >
        <div ref={content} className={p.wide ? 'mx-auto w-full max-w-3xl px-6 pt-3 pb-4' : 'mx-auto w-full max-w-3xl px-2 pt-3 pb-4'}>
          {p.canLoadOlder || p.loadingOlder ? (
            <div className="flex justify-center pb-3">
              <Button variant="outline" size="sm" className="h-8 rounded-full px-3.5" disabled={p.loadingOlder} onClick={p.onLoadOlder}>
                {p.loadingOlder ? <Loader2Icon className="animate-spin" /> : <ChevronsUpIcon />}
                {p.loadingOlder ? 'Loading…' : 'Load older'}
              </Button>
            </div>
          ) : null}
          {p.fileLinks ? <FileLinksContext.Provider value={p.fileLinks.api}>{body}</FileLinksContext.Provider> : body}
          {p.outbox}
          {p.messages ? <Typing status={p.status} waitingFor={p.waitingFor} asking={!!asking && !!p.questionActions} working={p.working} screenTail={p.screenTail} onTermInput={p.onTermInput} /> : null}
        </div>
      </div>
      <LatestButton show={!following} onClick={jump} />
    </div>
  )
}

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className={cn('flex flex-col items-center gap-2 px-4 py-14 text-center text-sm text-dimmer')}>
      {icon}
      {text}
    </div>
  )
}
