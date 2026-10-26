/**
 * Usage log: every button, link and menu item clicked and every keyboard shortcut run, batched to
 * the server's `/api/clicks` (a JSON-lines file on this machine). Only names of controls are kept —
 * never what is typed — so a later redesign can follow what is actually used.
 */

export interface TrackEvent {
  t: number
  kind: 'click' | 'key'
  label: string
  area: string
  screen: string
}

const FLUSH_MS = 15_000
const CONTROL = 'button, a, [role="menuitem"], [role="menuitemradio"], [role="tab"], [role="radio"], [role="option"], [role="switch"], [role="checkbox"], summary'
const AREAS: [string, string][] = [
  ['[role="menu"]', 'menu'],
  ['[role="dialog"]', 'dialog'],
  ['[data-sidebar-rail]', 'rail'],
  ['aside, nav', 'sidebar'],
  ['header', 'header'],
  ['form', 'composer'],
  ['main', 'main'],
]

const queue: TrackEvent[] = []

/** `#/s/host/id` → `session`, `#/notes/…` → `notes`, `#/` → `home`. */
export function screenOf(hash: string): string {
  const first = hash.replace(/^#\/?/, '').split(/[/?]/)[0]
  return first === 's' ? 'session' : first || 'home'
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)

/** A control's name: `data-track`, else its accessible name, else its text. Session rows and notes links are grouped. */
export function labelOf(el: Element): string {
  const explicit = el.closest('[data-track]')?.getAttribute('data-track')
  if (explicit) return explicit
  const href = el.getAttribute('href') ?? ''
  if (/^#\/s\//.test(href)) return 'session row'
  if (/^#\/notes/.test(href)) return 'notes link'
  return clean(el.getAttribute('aria-label')) || clean(el.getAttribute('title')) || clean(el.textContent) || el.tagName.toLowerCase()
}

export function areaOf(el: Element): string {
  for (const [sel, name] of AREAS) if (el.closest(sel)) return name
  return ''
}

export function track(kind: TrackEvent['kind'], label: string, area = '') {
  queue.push({ t: Date.now(), kind, label, area, screen: screenOf(location.hash) })
}

function flush(beacon = false) {
  if (!queue.length) return
  const body = JSON.stringify({ events: queue.splice(0) })
  if (beacon && navigator.sendBeacon) navigator.sendBeacon('/api/clicks', new Blob([body], { type: 'application/json' }))
  else void fetch('/api/clicks', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {})
}

/** One capture-phase listener for the whole app; call once at startup. */
export function installTracker() {
  document.addEventListener(
    'click',
    (e) => {
      const el = e.target instanceof Element ? e.target.closest(CONTROL) : null
      // Palette picks are logged by the palette itself (keyboard or mouse alike).
      if (el && !el.closest('[cmdk-item]')) track('click', labelOf(el), areaOf(el))
    },
    { capture: true },
  )
  setInterval(flush, FLUSH_MS)
  addEventListener('pagehide', () => flush(true))
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush(true))
}
