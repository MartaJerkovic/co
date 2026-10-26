import { expect, test } from 'vitest'

import type { FleetResponse, Space } from '@/api/types'

import { spaceDir, spaceOf } from './spaces'

const fleet = {
  self: 'laptop',
  hosts: [{ name: 'laptop', spawnDirs: [{ label: 'Playground', path: '/home/me/playground' }, { label: 'Life', path: '/home/me/life' }] }],
} as unknown as FleetResponse

const space = (id: string, label: string): Space => ({ id, label, blurb: '', action: 'New session', empty: '', icon: null, previews: false })
const spaces = [space('playground', 'Playground'), space('life', 'Life')]

test('spaceOf: a directory in a space, with ~ or absolute, nothing beside it', () => {
  expect(spaceOf(spaces, fleet, 'laptop', '/home/me/playground/idea')?.id).toBe('playground')
  expect(spaceOf(spaces, fleet, 'laptop', '~/life')?.id).toBe('life')
  expect(spaceOf(spaces, fleet, 'laptop', '/home/me/lifestyle')).toBeNull()
  expect(spaceOf(spaces, fleet, 'other', '/home/me/life')).toBeNull()
  expect(spaceOf([], fleet, 'laptop', '/home/me/life')).toBeNull()
  expect(spaceDir(fleet, 'laptop', spaces[1])).toBe('/home/me/life')
})
