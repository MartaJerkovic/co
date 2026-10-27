import { expect, test } from 'vitest'

import type { DormantSession, FleetResponse, Space } from '@/api/types'

import { closedPlace, sessionSpace, spaceDir, spaceOf } from './spaces'

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

test('sessionSpace: the space it was started from wins over its directory', () => {
  expect(sessionSpace(spaces, fleet, { host: 'laptop', cwd: '/home/me/work/ai-agent', space: 'playground' })?.id).toBe('playground')
  expect(sessionSpace(spaces, fleet, { host: 'laptop', cwd: '/home/me/life', space: null })?.id).toBe('life')
  expect(sessionSpace(spaces, fleet, { host: 'laptop', cwd: '/home/me/work/ai-agent', space: 'gone' })).toBeNull()
})

test('a closed entry is listed like its live session: its space, else Bots for a bot run, else Sessions', () => {
  const play = space('playground', 'Playground')
  const life = space('life', 'Life')
  const view = (s: Partial<DormantSession>) => ({ sessions: [{ sessionId: 'a', name: null, title: null, cwd: '/home/me/work/api', ...s }] })
  expect(closedPlace([play, life], fleet, 'laptop', view({ space: 'playground' }))).toBe(play)
  expect(closedPlace([play, life], fleet, 'laptop', view({ job: 'markets', cwd: '/home/me/life' }))).toBe(life)
  expect(closedPlace([play, life], fleet, 'laptop', view({ job: 'support' }))).toBe('bots')
  expect(closedPlace([play, life], fleet, 'laptop', view({}))).toBeNull()
})
