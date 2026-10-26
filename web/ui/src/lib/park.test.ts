import { expect, test } from 'vitest'

import { appendLine, PARK_LINE } from './park'

test('appendLine: one parked thought per line, in the skills format', () => {
  expect(appendLine('# Zadaci\n\n- [ ] a\n\n', PARK_LINE.todo('b'))).toBe('# Zadaci\n\n- [ ] a\n- [ ] b\n')
  expect(appendLine('# Ideje\n', PARK_LINE.idea('c'))).toMatch(/^# Ideje\n- \d{4}-\d{2}-\d{2} — c\n$/)
})
