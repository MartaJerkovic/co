import type { SessionKey } from '@/api/types'

/** One keystroke typed into the terminal view: a named key, or literal text. */
export type TermInput = { key: SessionKey } | { text: string }

const NAMED: Record<string, SessionKey> = {
  Enter: 'Enter',
  Escape: 'Escape',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Backspace: 'BSpace',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
}

/** The terminal input for a keydown, or null when the app keeps it (⌘ and Ctrl shortcuts, modifiers). */
export function termInput(e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'isComposing'>): TermInput | null {
  if (e.metaKey || e.ctrlKey || e.isComposing) return null
  if (e.key === 'Tab') return { key: e.shiftKey ? 'BTab' : 'Tab' }
  if (NAMED[e.key]) return { key: NAMED[e.key] }
  if (e.key === ' ') return { key: 'Space' }
  if ([...e.key].length === 1) return { text: e.key }
  return null
}
