import type { ParkKind } from '@/api/types'

/** Opens the "Park a thought" dialog (components/ParkDialog) from anywhere: a shortcut, the palette. */
const EVENT = 'fleet:park'

export function openPark() {
  window.dispatchEvent(new Event(EVENT))
}

export function onPark(fn: () => void): () => void {
  window.addEventListener(EVENT, fn)
  return () => window.removeEventListener(EVENT, fn)
}

/** Local date as YYYY-MM-DD. */
const today = () => new Date().toLocaleDateString('sv-SE')

/** The line a parked thought becomes (the /idea and /todo skills' format); the file is config `web.park`. */
export const PARK_LINE: Record<ParkKind, (t: string) => string> = {
  idea: (t) => `- ${today()} — ${t}`,
  todo: (t) => `- [ ] ${t}`,
}

/** `text` with `line` appended on its own line. */
export function appendLine(text: string, line: string): string {
  const body = text.replace(/\s+$/, '')
  return `${body}\n${line}\n`
}
