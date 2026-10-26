import { expect, test } from 'vitest'

import { parseAnsi, placeCursor, stripAnsi } from './ansi'

test('parseAnsi: colours, truecolor, reset and carry-over between lines', () => {
  const [a, b] = parseAnsi('\x1b[1;31mred\x1b[0m plain \x1b[38;2;10;20;30mrgb\n\x1b[48;5;22mbg\x1b[49m')
  expect(a).toEqual([
    { text: 'red', style: { bold: true, color: '#e06c75' } },
    { text: ' plain ', style: {} },
    { text: 'rgb', style: { color: 'rgb(10,20,30)' } },
  ])
  expect(b).toEqual([{ text: 'bg', style: { color: 'rgb(10,20,30)', background: 'rgb(0,95,0)' } }])
})

test('stripAnsi drops every escape', () => {
  expect(stripAnsi('\x1b[2m⎿\x1b[22m \x1b]0;title\x07done')).toBe('⎿ done')
})

test("parseAnsi: Claude Code's white and greys follow the theme", () => {
  const [line] = parseAnsi('\x1b[38;5;231m⏺\x1b[38;5;246m tool\x1b[37m text')
  expect(line.map((s) => s.style.color)).toEqual(['var(--foreground)', 'var(--muted-foreground)', 'var(--foreground)'])
})

test('placeCursor marks the character under the cursor, past the end it pads', () => {
  const lines = parseAnsi('❯ vv\n  footer')
  expect(placeCursor(lines, { x: 2, below: 1 })[0]).toEqual([
    { text: '❯ ', style: {} },
    { text: 'v', style: {}, cursor: true },
    { text: 'v', style: {} },
  ])
  expect(placeCursor(lines, { x: 6, below: 1 })[0]).toEqual([
    { text: '❯ vv', style: {} },
    { text: '  ', style: {} },
    { text: ' ', style: {}, cursor: true },
  ])
})

test('parseAnsi: inverse (SGR 7) on and off', () => {
  const [line] = parseAnsi('\x1b[7m tab \x1b[27m rest')
  expect(line.map((s) => !!s.style.inverse)).toEqual([true, false])
})
