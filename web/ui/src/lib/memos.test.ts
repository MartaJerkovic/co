import { describe, expect, it } from 'vitest'

import { formatDuration, memoWhen, parseMemosLocation } from './memos'

describe('memos helpers', () => {
  it('parses the memos routes', () => {
    expect(parseMemosLocation('/memos')).toEqual({ id: null })
    expect(parseMemosLocation('/memos/2026-10-15-plan')).toEqual({ id: '2026-10-15-plan' })
    expect(parseMemosLocation('/memos/a%20b')).toEqual({ id: 'a b' })
    expect(parseMemosLocation('/memosx')).toBeNull()
    expect(parseMemosLocation('/')).toBeNull()
  })

  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(125)).toBe('2:05')
    expect(formatDuration(3725)).toBe('1:02:05')
    expect(formatDuration(null)).toBe('')
  })

  it('labels when a memo was recorded', () => {
    const now = new Date(2026, 9, 15, 18, 0).getTime()
    expect(memoWhen(new Date(2026, 9, 15, 14, 32).toISOString(), now)).toBe('14:32')
    expect(memoWhen(new Date(2026, 9, 14, 9, 5).toISOString(), now)).toBe('Yesterday 09:05')
    expect(memoWhen(new Date(2026, 9, 1, 9, 5).toISOString(), now)).toBe('1 Oct 09:05')
    expect(memoWhen(new Date(2025, 9, 1, 9, 5).toISOString(), now)).toBe('1 Oct 2025 09:05')
    expect(memoWhen(null, now)).toBe('')
  })
})
