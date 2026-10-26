// Terminal colours (SGR escapes from `capture-pane -e`) as styled segments for the terminal view.

import type { TermCursor } from '@/api/types'

export interface AnsiStyle {
  color?: string
  background?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  inverse?: boolean
}

export interface AnsiSegment {
  text: string
  style: AnsiStyle
  /** The terminal cursor sits on this one character. */
  cursor?: boolean
}


// The 16 basic colours, tuned to read on the dark terminal background.
const BASIC = [
  '#3b3f4c', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#c8ccd4',
  '#5c6370', '#ef7b85', '#a9d48a', '#f0cc8c', '#74bdf8', '#d58ae8', '#67c7d3', '#e6e8ec',
]

// Claude Code draws its text in white and greys; those follow the theme so the terminal reads like the app.
const THEMED: Record<number, string> = { 7: 'var(--foreground)', 15: 'var(--foreground)', 231: 'var(--foreground)', 8: 'var(--muted-foreground)' }

function color256(n: number): string {
  if (THEMED[n]) return THEMED[n]
  if (n >= 244) return 'var(--muted-foreground)'
  if (n >= 232) return 'var(--dimmer)'
  if (n < 16) return BASIC[n]
  if (n >= 232) {
    const v = 8 + (n - 232) * 10
    return `rgb(${v},${v},${v})`
  }
  const i = n - 16
  const step = (c: number) => (c === 0 ? 0 : 55 + c * 40)
  return `rgb(${step(Math.floor(i / 36))},${step(Math.floor(i / 6) % 6)},${step(i % 6)})`
}

// eslint-disable-next-line no-control-regex
const ESC_RE = /\x1b\[([0-9;:]*)([A-Za-z])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\x1b[=>]/g

export const hasAnsi = (text: string) => text.includes('\x1b')

export const stripAnsi = (text: string) => text.replace(ESC_RE, '')

/** Apply one SGR parameter list to `style` (a new object). */
function applySgr(style: AnsiStyle, params: string): AnsiStyle {
  const next = { ...style }
  const p = params === '' ? [0] : params.split(/[;:]/).map((x) => Number(x) || 0)
  for (let i = 0; i < p.length; i++) {
    const c = p[i]
    if (c === 0) {
      for (const k of Object.keys(next) as (keyof AnsiStyle)[]) delete next[k]
    } else if (c === 1) next.bold = true
    else if (c === 2) next.dim = true
    else if (c === 3) next.italic = true
    else if (c === 4) next.underline = true
    else if (c === 7) next.inverse = true
    else if (c === 27) delete next.inverse
    else if (c === 22) {
      delete next.bold
      delete next.dim
    } else if (c === 23) delete next.italic
    else if (c === 24) delete next.underline
    else if (c >= 30 && c <= 37) next.color = color256(c - 30)
    else if (c >= 90 && c <= 97) next.color = color256(c - 90 + 8)
    else if (c === 39) delete next.color
    else if (c >= 40 && c <= 47) next.background = BASIC[c - 40]
    else if (c >= 100 && c <= 107) next.background = BASIC[c - 100 + 8]
    else if (c === 49) delete next.background
    else if (c === 38 || c === 48) {
      const key = c === 38 ? 'color' : 'background'
      if (p[i + 1] === 5) {
        next[key] = color256(p[i + 2] ?? 0)
        i += 2
      } else if (p[i + 1] === 2) {
        next[key] = `rgb(${p[i + 2] ?? 0},${p[i + 3] ?? 0},${p[i + 4] ?? 0})`
        i += 4
      }
    }
  }
  return next
}

/**
 * Split each line into styled segments. The style carries over line breaks, as in a terminal;
 * escapes other than SGR (cursor moves, titles, charset switches) are dropped.
 */
export function parseAnsi(text: string): AnsiSegment[][] {
  let style: AnsiStyle = {}
  return text.split('\n').map((line) => {
    const out: AnsiSegment[] = []
    let last = 0
    for (const m of line.matchAll(ESC_RE)) {
      const at = m.index ?? 0
      if (at > last) out.push({ text: line.slice(last, at), style })
      if (m[2] === 'm') style = applySgr(style, m[1] ?? '')
      last = at + m[0].length
    }
    if (last < line.length) out.push({ text: line.slice(last), style })
    return out
  })
}

/** Mark the character under the terminal cursor (padding the line when the cursor is past its end). */
export function placeCursor(lines: AnsiSegment[][], { x, below }: TermCursor): AnsiSegment[][] {
  const row = lines.length - 1 - below
  if (x == null || row < 0) return lines
  const out: AnsiSegment[] = []
  let col = 0
  let placed = false
  for (const seg of lines[row]) {
    const chars = [...seg.text]
    const i = x - col
    if (!placed && i >= 0 && i < chars.length) {
      if (i > 0) out.push({ text: chars.slice(0, i).join(''), style: seg.style })
      out.push({ text: chars[i], style: seg.style, cursor: true })
      if (i + 1 < chars.length) out.push({ text: chars.slice(i + 1).join(''), style: seg.style })
      placed = true
    } else out.push(seg)
    col += chars.length
  }
  if (!placed) {
    if (x > col) out.push({ text: ' '.repeat(x - col), style: {} })
    out.push({ text: ' ', style: {}, cursor: true })
  }
  return lines.map((line, i) => (i === row ? out : line))
}
