import { describe, expect, it } from 'vitest'

import type { PullRequest } from '@/api/types'

import { checksTone, groupPrs, promptChips, prRef, reviewLabel } from './prs'

const pr = (o: Partial<PullRequest>): PullRequest => ({
  column: 'waitingOnMe',
  owner: 'acme',
  repo: 'app',
  number: 1,
  title: 'Fix login',
  url: 'https://github.com/acme/app/pull/1',
  author: 'ana',
  draft: false,
  createdAt: 0,
  updatedAt: 0,
  additions: 1,
  deletions: 0,
  changedFiles: 1,
  size: 'XS',
  baseBranch: 'main',
  headBranch: 'fix-login',
  headOid: null,
  reviewDecision: null,
  checks: null,
  comments: 0,
  requestedReviewers: [],
  myReview: null,
  ...o,
})

describe('groupPrs', () => {
  const columns = [
    { id: 'waitingOnMe' as const, title: 'Waiting on me', count: 1 },
    { id: 'draftMine' as const, title: 'My drafts', count: 1 },
  ]
  const prs = [pr({ number: 1 }), pr({ number: 2, column: 'draftMine', title: 'Refactor', headBranch: 'r' }), pr({ number: 3, column: 'futureColumn' as never })]

  it('keeps the server order, empty columns and unknown ones last', () => {
    const g = groupPrs({ columns, prs })
    expect(g.map((c) => [c.id, c.prs.map((p) => p.number)])).toEqual([
      ['waitingOnMe', [1]],
      ['draftMine', [2]],
      ['futureColumn', [3]],
    ])
  })

  it('filters by title, repo#number and author', () => {
    expect(groupPrs({ columns, prs }, 'refac').flatMap((c) => c.prs.map((p) => p.number))).toEqual([2])
    expect(groupPrs({ columns, prs }, 'app#3').flatMap((c) => c.prs.map((p) => p.number))).toEqual([3])
    expect(groupPrs({ columns, prs }, 'ANA').flatMap((c) => c.prs.map((p) => p.number))).toEqual([1, 2, 3])
  })

  it('falls back to the default columns and copes with nothing', () => {
    expect(groupPrs(null)).toEqual([])
    expect(groupPrs({ columns: [], prs: [] }).map((c) => c.id)).toEqual(['waitingOnMe', 'reviewMine', 'readyToMergeMine', 'draftMine', 'waitingOnAuthor'])
  })
})

describe('labels', () => {
  it('checks', () => {
    expect([checksTone('success'), checksTone('error'), checksTone('expected'), checksTone(null)]).toEqual(['ok', 'bad', 'running', 'none'])
  })
  it('review', () => {
    expect(reviewLabel(pr({ myReview: { state: 'changesRequested', at: null, newCommits: true } }))).toBe('new commits since your review')
    expect(reviewLabel(pr({ myReview: { state: 'changesRequested', at: null, newCommits: false } }))).toBe('you requested changes')
    expect(reviewLabel(pr({ reviewDecision: 'approved' }))).toBe('approved')
    expect(reviewLabel(pr({}))).toBeNull()
  })
})

describe('actions', () => {
  it('refs and prompt chips', () => {
    expect(prRef(pr({ number: 12 }))).toBe('acme/app#12')
    expect(promptChips(pr({})).map((c) => c.label)).toEqual(['Review', 'Fix CI'])
    expect(promptChips(pr({ column: 'draftMine' })).map((c) => c.label)).toEqual(['Continue', 'Address review', 'Fix CI'])
    expect(promptChips(pr({ column: 'draftMine', checks: 'failure' }))[0].label).toBe('Fix CI')
  })
})
