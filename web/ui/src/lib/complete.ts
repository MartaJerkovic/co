// Composer autocomplete: which completion the text before the caret asks for, the ranked
// suggestions for it, and the text after picking one.
//   `/name`     a skill or command — the message's first word only (Claude reads it there)
//   `@path`     a .md / .plain file under the session cwd — at the start or after whitespace
//   `brain:ref` a brain note — likewise
import type { CompleteBrainNote, CompleteKind, CompleteResponse, CompleteSkill } from '@/api/types'

export interface Trigger {
  kind: CompleteKind
  /** What has been typed after the trigger. */
  query: string
  /** Where the trigger (`/`, `@`, `brain:`) starts. */
  start: number
  /** The end of the word being completed (the caret, or past the rest of the word under it). */
  end: number
}

export interface Suggestion {
  /** Inserted in place of the trigger + query (a space follows). */
  insert: string
  /** The main line (mono). */
  label: string
  /** The muted line: a description or a title. */
  detail?: string
  /** A badge: the skill's source, `[args]`. */
  hint?: string
}

export const MAX_SUGGESTIONS = 50

/** The completion the caret is in, or null. `skills`: whether `/` completes (Claude sessions). */
export function findTrigger(text: string, caret: number, { skills = true } = {}): Trigger | null {
  const before = text.slice(0, caret)
  const rest = /^\S*/.exec(text.slice(caret))?.[0] ?? ''
  const end = caret + rest.length
  if (skills) {
    const m = /^(\s*)\/([\w:.-]*)$/.exec(before)
    if (m) return { kind: 'skills', query: m[2], start: m[1].length, end }
  }
  const brain = /(^|\s)brain:(\S*)$/.exec(before)
  if (brain) return { kind: 'brain', query: brain[2], start: brain.index + brain[1].length, end }
  const at = /(^|\s)@([^\s@]*)$/.exec(before)
  if (at) return { kind: 'files', query: at[2], start: at.index + at[1].length, end }
  return null
}

/** Replace the trigger's word with `insert` + a space; the caret lands after the space. */
export function applySuggestion(text: string, t: Trigger, insert: string): { text: string; caret: number } {
  const after = text.slice(t.end)
  const glue = after.startsWith(' ') ? '' : ' '
  const head = text.slice(0, t.start) + insert + glue
  return { text: head + after, caret: head.length + (glue ? 0 : 1) }
}

const SOURCE_ORDER: Record<CompleteSkill['source'], number> = { project: 0, user: 1, plugin: 2, builtin: 3 }

/** A response → suggestions in their unfiltered order. */
export function toSuggestions(kind: CompleteKind, r: CompleteResponse | null | undefined): Suggestion[] {
  if (!r) return []
  if (kind === 'skills') {
    return [...(r.skills ?? [])]
      .sort((a, b) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source])
      .map((s) => ({
        insert: `/${s.name}`,
        label: `/${s.name}`,
        detail: s.description || undefined,
        hint: s.argumentHint || (s.source === 'builtin' ? 'built-in' : s.source),
      }))
  }
  if (kind === 'files') return (r.files ?? []).map((f) => ({ insert: `@${f}`, label: f }))
  return (r.notes ?? []).map((n: CompleteBrainNote) => ({
    insert: `brain:${n.ref}`,
    label: n.ref,
    detail: n.title && n.title !== n.ref ? n.title : n.path !== `${n.ref}.md` ? n.path : undefined,
  }))
}

/** Where a word starts in `s`: after `/`, `:`, `-`, `_`, `.` or a space. */
const BOUNDARY = /[/:\-_. ]/

/** How well `q` (lowercase) matches `s`: higher is better, 0 = no match. */
export function score(s: string, q: string): number {
  const l = s.toLowerCase()
  if (l.startsWith(q)) return 1000 - l.length
  const idx = l.indexOf(q)
  if (idx >= 0) return (idx > 0 && BOUNDARY.test(l[idx - 1]) ? 800 : 600) - l.length
  // A subsequence: every query letter in order; fewer gaps rank higher.
  let i = 0
  let gaps = 0
  let last = -1
  for (let j = 0; j < l.length && i < q.length; j++) {
    if (l[j] !== q[i]) continue
    if (last >= 0 && j !== last + 1) gaps++
    last = j
    i++
  }
  return i === q.length ? Math.max(1, 400 - gaps * 20 - l.length) : 0
}

/** The suggestions matching `query`, best first (the label counts more than the detail). */
export function rankSuggestions(all: Suggestion[], query: string, limit = MAX_SUGGESTIONS): Suggestion[] {
  const q = query.toLowerCase().replace(/^[/@]/, '')
  if (!q) return all.slice(0, limit)
  const scored: { s: Suggestion; score: number; i: number }[] = []
  all.forEach((s, i) => {
    const label = score(s.label.replace(/^\//, ''), q)
    const detail = s.detail && q.length >= 2 && s.detail.toLowerCase().includes(q) ? 100 : 0
    const best = Math.max(label, detail)
    if (best > 0) scored.push({ s, score: best, i })
  })
  scored.sort((a, b) => b.score - a.score || a.i - b.i)
  return scored.slice(0, limit).map((x) => x.s)
}
