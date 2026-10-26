import { expect, test } from 'vitest'

import { termInput } from './termKeys'

const k = (key: string, mods: Partial<{ shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }> = {}) =>
  termInput({ key, shiftKey: false, metaKey: false, ctrlKey: false, isComposing: false, ...mods })

test('termInput maps keys to tmux names and leaves app shortcuts alone', () => {
  expect(k('a')).toEqual({ text: 'a' })
  expect(k('č')).toEqual({ text: 'č' })
  expect(k('Enter')).toEqual({ key: 'Enter' })
  expect(k('ArrowLeft')).toEqual({ key: 'Left' })
  expect(k('Backspace')).toEqual({ key: 'BSpace' })
  expect(k(' ')).toEqual({ key: 'Space' })
  expect(k('Tab', { shiftKey: true })).toEqual({ key: 'BTab' })
  expect(k('j', { metaKey: true })).toBeNull()
  expect(k('c', { ctrlKey: true })).toBeNull()
  expect(k('Shift')).toBeNull()
})
