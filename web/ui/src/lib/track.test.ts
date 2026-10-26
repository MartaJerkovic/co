import { expect, test } from 'vitest'

import { areaOf, labelOf, screenOf } from '@/lib/track'

/** A stand-in Element: `attrs`, `text`, and the selectors its ancestors (or itself) match → that ancestor's attrs. */
function el(attrs: Record<string, string> = {}, text = '', ancestors: Record<string, Record<string, string>> = {}) {
  return {
    tagName: 'BUTTON',
    textContent: text,
    getAttribute: (k: string) => attrs[k] ?? null,
    closest: (sel: string) => {
      const hit = Object.keys(ancestors).find((a) => sel.split(',').some((s) => s.trim() === a))
      return hit ? { getAttribute: (k: string) => ancestors[hit][k] ?? null } : null
    },
  } as unknown as Element
}

test('screenOf names the route', () => {
  expect(screenOf('#/s/laptop/abc')).toBe('session')
  expect(screenOf('#/notes/a.md')).toBe('notes')
  expect(screenOf('#/')).toBe('home')
  expect(screenOf('')).toBe('home')
})

test('labelOf prefers data-track, then aria-label, title and text', () => {
  expect(labelOf(el({}, 'Go', { '[data-track]': { 'data-track': 'send' } }))).toBe('send')
  expect(labelOf(el({ 'aria-label': 'Stop' }, '■'))).toBe('Stop')
  expect(labelOf(el({ title: 'Usage' }))).toBe('Usage')
  expect(labelOf(el({}, '  Review\n PR '))).toBe('Review PR')
  expect(labelOf(el())).toBe('button')
})

test('labelOf groups session rows and notes links', () => {
  expect(labelOf(el({ href: '#/s/laptop/abc' }, 'fix login'))).toBe('session row')
  expect(labelOf(el({ href: '#/notes/ideje.md' }, 'ideje'))).toBe('notes link')
})

test('areaOf finds the nearest named region, menus and dialogs first', () => {
  expect(areaOf(el({}, '', { '[data-sidebar-rail]': {}, nav: {} }))).toBe('rail')
  expect(areaOf(el({}, '', { '[role="menu"]': {}, nav: {} }))).toBe('menu')
  expect(areaOf(el({}, '', { form: {} }))).toBe('composer')
  expect(areaOf(el())).toBe('')
})
