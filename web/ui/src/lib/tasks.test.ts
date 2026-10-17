import { describe, expect, it } from 'vitest'

import type { PullRequest, Session, Task } from '@/api/types'

import { dueInfo, groupTasks, idleDays, isTasksLocation, linkTasks, parseTaskLocation, statusOptions, taskHref, taskIdsIn, taskProjects } from './tasks'

const DAY = 24 * 3600 * 1000
const NOW = new Date(2026, 9, 17, 12).getTime()

const task = (o: Partial<Task>): Task => ({
  id: '1001',
  number: '12',
  title: 'Fix login',
  url: 'https://app.productive.io/1-acme/tasks/1001',
  column: 'inProgress',
  project: { id: '1', name: 'App' },
  taskList: null,
  status: { id: '5', name: 'Working', category: 'started', position: 2 },
  workflowId: '9',
  dueDate: null,
  startDate: null,
  createdAt: 0,
  updatedAt: NOW,
  lastActivityAt: NOW,
  todos: 0,
  openTodos: 0,
  tags: [],
  description: '',
  ...o,
})

describe('groupTasks', () => {
  const r = {
    columns: [
      { id: 'due' as const, title: 'Due', count: 0 },
      { id: 'inProgress' as const, title: 'In progress', count: 0 },
      { id: 'toDo' as const, title: 'To do', count: 0 },
    ],
    tasks: [
      task({ id: '1', title: 'Fix login' }),
      task({ id: '2', title: 'Old chore', column: 'toDo', lastActivityAt: NOW - 90 * DAY, project: { id: '2', name: 'Ops' } }),
      task({ id: '3', title: 'Ship it', column: 'due', lastActivityAt: NOW - 90 * DAY, tags: ['release'] }),
    ],
  }
  it('sorts into columns, filters by text, project and idleness', () => {
    expect(groupTasks(r).map((g) => g.tasks.map((t) => t.id))).toEqual([['3'], ['1'], ['2']])
    expect(groupTasks(r, 'release').flatMap((g) => g.tasks.map((t) => t.id))).toEqual(['3'])
    expect(groupTasks(r, '', { project: '2' }).flatMap((g) => g.tasks.map((t) => t.id))).toEqual(['2'])
    // A due task is never idle.
    expect(groupTasks(r, '', { hideIdle: true, now: NOW }).flatMap((g) => g.tasks.map((t) => t.id))).toEqual(['3', '1'])
  })
  it('keeps unknown columns, last; defaults the columns', () => {
    const g = groupTasks({ columns: [], tasks: [task({ column: 'later' as never })] })
    expect(g.map((x) => x.id)).toEqual(['due', 'inProgress', 'toDo', 'later'])
  })
})

it('idleDays and taskProjects', () => {
  expect(idleDays(task({ lastActivityAt: NOW - 3 * DAY }), NOW)).toBe(3)
  expect(idleDays(task({ lastActivityAt: null, updatedAt: NOW - DAY }), NOW)).toBe(1)
  expect(taskProjects([task({}), task({ id: '2' }), task({ project: { id: '0', name: 'Admin' } })])).toEqual([
    { id: '0', name: 'Admin', count: 1 },
    { id: '1', name: 'App', count: 2 },
  ])
})

it('dueInfo: overdue, today, soon, later', () => {
  expect(dueInfo(null, NOW)).toBeNull()
  expect(dueInfo('nope', NOW)).toBeNull()
  expect(dueInfo('2026-10-14', NOW)).toEqual({ label: 'overdue 3d', tone: 'overdue' })
  expect(dueInfo('2026-10-17', NOW)).toEqual({ label: 'due today', tone: 'soon' })
  expect(dueInfo('2026-10-18', NOW)).toEqual({ label: 'due tomorrow', tone: 'soon' })
  expect(dueInfo('2026-10-20', NOW)).toEqual({ label: 'due in 3d', tone: 'soon' })
  expect(dueInfo('2026-10-25', NOW)?.tone).toBe('later')
})

it('statusOptions: open ones by position, closed last; the current one always offered', () => {
  const statuses = {
    '9': [
      { id: '7', name: 'Closed', category: 'closed', position: 3 },
      { id: '6', name: 'Review', category: 'started', position: 4 },
      { id: '4', name: 'Backlog', category: 'notStarted', position: 1 },
    ],
  }
  expect(statusOptions(task({}), statuses).map((s) => s.name)).toEqual(['Backlog', 'Working', 'Review', 'Closed'])
  expect(statusOptions(task({ workflowId: 'x' }), statuses).map((s) => s.name)).toEqual(['Working'])
})

it('taskIdsIn finds Productive task links, once each', () => {
  expect(taskIdsIn('see https://app.productive.io/1-acme/tasks/1001) and app.productive.io/1-acme/task/1002 and /tasks/1001')).toEqual(['1001', '1002'])
  expect(taskIdsIn('https://example.com/tasks/1')).toEqual([])
  expect(taskIdsIn(null)).toEqual([])
})

it('locations', () => {
  expect(taskHref({ id: '1001' })).toBe('/tasks/1001')
  expect(parseTaskLocation('/tasks/1001')).toBe('1001')
  expect(parseTaskLocation('/tasks')).toBeNull()
  expect(isTasksLocation('/tasks')).toBe(true)
  expect(isTasksLocation('/tasks/1')).toBe(true)
  expect(isTasksLocation('/tasksx')).toBe(false)
})

it('linkTasks: sessions by their first prompt or their PR; PRs by their links', () => {
  const t1 = task({ id: '1001' })
  const t2 = task({ id: '1002' })
  const pr = { url: 'https://github.com/acme/app/pull/3', tasks: ['1002', '9999'] } as PullRequest
  const s = (id: string, title: string | null): Session => ({ host: 'laptop', session_id: id, title })
  const sessions = [
    s('a', 'Productive task #12 “Fix login”: https://app.productive.io/1-acme/tasks/1001. Plan it.'),
    s('b', 'something else'),
    s('c', null),
  ]
  const links = linkTasks([t1, t2], [pr], { bySession: new Map([['laptop/b', pr]]) }, sessions)
  expect(links.bySession.get('laptop/a')?.id).toBe('1001')
  expect(links.bySession.get('laptop/b')?.id).toBe('1002')
  expect(links.bySession.has('laptop/c')).toBe(false)
  expect(links.byTask.get('1002')?.map((x) => x.session_id)).toEqual(['b'])
  expect(links.prsByTask.get('1002')).toEqual([pr])
  expect(links.byPr.get(pr.url)?.map((t) => t.id)).toEqual(['1002'])
})
