import { useEffect, useRef, useState } from 'react'

const DELAY_MS = 250

interface Tip {
  text: string
  x: number
  y: number
  below: boolean
}

/** The hover label of an element: its `title`, else the `aria-label` of an icon-only control. */
function labelOf(el: HTMLElement): string | null {
  const title = el.dataset.hoverTitle ?? el.getAttribute('title')
  if (title) return title
  const aria = el.getAttribute('aria-label')
  if (aria && (el.tagName === 'BUTTON' || el.tagName === 'A') && !el.textContent?.trim()) return aria
  return null
}

/**
 * One app-wide tooltip for every element with a `title` (and icon-only buttons and links with an
 * `aria-label`). WKWebView — Fleet.app — never shows native `title` tooltips, and browsers show
 * them late, so the `title` is lifted into `data-hover-title` while the pointer is on the element
 * (no native tooltip on top of this one) and put back when it leaves.
 */
export function HoverTips() {
  const [tip, setTip] = useState<Tip | null>(null)
  const timer = useRef<number | null>(null)
  const current = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const restore = () => {
      const el = current.current
      if (el?.dataset.hoverTitle != null) {
        el.setAttribute('title', el.dataset.hoverTitle)
        delete el.dataset.hoverTitle
      }
      current.current = null
    }
    const hide = () => {
      if (timer.current != null) window.clearTimeout(timer.current)
      timer.current = null
      restore()
      setTip(null)
    }
    const over = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      const el = (e.target as Element | null)?.closest?.<HTMLElement>('[title], button[aria-label], a[aria-label]') ?? null
      if (el === current.current) return
      hide()
      if (!el) return
      const text = labelOf(el)
      if (!text) return
      current.current = el
      const title = el.getAttribute('title')
      if (title != null) {
        el.dataset.hoverTitle = title
        el.removeAttribute('title')
      }
      timer.current = window.setTimeout(() => {
        const r = el.getBoundingClientRect()
        const below = r.top < 48
        setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom + 6 : r.top - 6, below })
      }, DELAY_MS)
    }
    document.addEventListener('pointerover', over)
    document.addEventListener('pointerdown', hide, true)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      hide()
      document.removeEventListener('pointerover', over)
      document.removeEventListener('pointerdown', hide, true)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [])

  if (!tip) return null
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[1000] max-w-xs rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
      style={{
        left: Math.min(Math.max(tip.x, 80), window.innerWidth - 80),
        top: tip.y,
        transform: `translate(-50%, ${tip.below ? '0' : '-100%'})`,
      }}
    >
      {tip.text}
    </div>
  )
}
