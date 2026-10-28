import { expect, it } from 'vitest'

import { placeBefore, rememberPlace } from './place'

it('closing a pane screen returns to the last place that was a list', () => {
  rememberPlace('/space/playground')
  expect(placeBefore(true)).toBe('/space/playground')
  rememberPlace('/s/laptop/abc')
  expect(placeBefore(true)).toBe('/s/laptop/abc')
})

it('closing a mobile screen goes to the list', () => {
  rememberPlace('/space/playground')
  expect(placeBefore(false)).toBe('/')
})
