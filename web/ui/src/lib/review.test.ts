import { describe, expect, it } from 'vitest'

import type { DiffFile, DiffHunk, ReviewThread } from '@/api/types'

import { diffBar, fileKey, fileSignature, fileTree, orphanThreads, orphanThreadsByKey, repoViews, threadKey, parseReviewLocation, placeThreads, reviewHref, selectLine, selectionCode, splitRows, treeOrder } from './review'

const file = (path: string, o: Partial<DiffFile> = {}): DiffFile => ({
  path,
  oldPath: path,
  status: 'modified',
  binary: false,
  additions: 1,
  deletions: 0,
  truncated: false,
  hunks: [],
  ...o,
})

const hunk = (lines: DiffHunk['lines']): DiffHunk => ({ header: '@@ -1 +1 @@', oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, section: '', lines })

describe('review routes', () => {
  it('round-trips host and id', () => {
    const href = reviewHref('work station', 'abc-123')
    expect(href).toBe('/review/work%20station/abc-123')
    expect(parseReviewLocation(href)).toEqual({ host: 'work station', id: 'abc-123' })
    expect(parseReviewLocation('/s/a/b')).toBeNull()
    expect(parseReviewLocation('/review/a')).toBeNull()
  })
})

describe('fileTree', () => {
  it('folders first, single-child chains merged, the diff list follows the tree', () => {
    const tree = fileTree([file('src/lib/a.ts'), file('README.md'), file('src/lib/b.ts'), file('docs/x/y/z.md'), file('src/main.ts')])
    expect(tree.map((n) => n.name)).toEqual(['docs/x/y', 'src', 'README.md'])
    const src = tree[1]
    expect(src.kind === 'dir' && src.children.map((n) => n.name)).toEqual(['lib', 'main.ts'])
    expect(treeOrder(tree).map((f) => f.path)).toEqual(['docs/x/y/z.md', 'src/lib/a.ts', 'src/lib/b.ts', 'src/main.ts', 'README.md'])
  })
})

describe('splitRows', () => {
  it('pairs a removal run with the additions after it; context on both sides', () => {
    const rows = splitRows(
      hunk([
        { t: ' ', o: 1, n: 1, text: 'a' },
        { t: '-', o: 2, n: null, text: 'b' },
        { t: '-', o: 3, n: null, text: 'c' },
        { t: '+', o: null, n: 2, text: 'B' },
        { t: ' ', o: 4, n: 3, text: 'd' },
        { t: '+', o: null, n: 4, text: 'e' },
      ]),
    )
    expect(rows.map((r) => [r.left?.text ?? null, r.right?.text ?? null])).toEqual([
      ['a', 'a'],
      ['b', 'B'],
      ['c', null],
      ['d', 'd'],
      [null, 'e'],
    ])
  })
})

describe('fileSignature / diffBar', () => {
  it('changes with the content only', () => {
    const a = file('x', { hunks: [hunk([{ t: '+', o: null, n: 1, text: 'x' }])] })
    expect(fileSignature(a)).toBe(fileSignature({ ...a }))
    expect(fileSignature(a)).not.toBe(fileSignature(file('x', { hunks: [hunk([{ t: '+', o: null, n: 1, text: 'y' }])] })))
  })
  it('splits five squares', () => {
    expect(diffBar(0, 0)).toBe(0)
    expect(diffBar(6, 4)).toBe(3)
    expect(diffBar(1, 0)).toBe(5)
  })
})

const thread = (o: Partial<ReviewThread>): ReviewThread => ({
  id: 'c-000001',
  path: 'a.ts',
  side: 'new',
  start: 2,
  end: 2,
  code: ['B'],
  base: null,
  createdAt: 0,
  status: 'sent',
  resolved: false,
  reviewId: null,
  entries: [],
  ...o,
})

describe('line selection and threads', () => {
  const f = file('a.ts', {
    hunks: [
      hunk([
        { t: ' ', o: 1, n: 1, text: 'a' },
        { t: '-', o: 2, n: null, text: 'b' },
        { t: '+', o: null, n: 2, text: 'B' },
        { t: '+', o: null, n: 3, text: 'C' },
        { t: ' ', o: 3, n: 4, text: 'd' },
      ]),
    ],
  })
  it('shift extends on the same file and side only', () => {
    const one = selectLine(null, 'a.ts', 'new', 3, false)
    expect(selectLine(one, 'a.ts', 'new', 1, true)).toEqual({ path: 'a.ts', side: 'new', start: 1, end: 3 })
    expect(selectLine(one, 'a.ts', 'old', 1, true)).toEqual({ path: 'a.ts', side: 'old', start: 1, end: 1 })
  })
  it('code of a selection skips the other side', () => {
    expect(selectionCode(f, { path: 'a.ts', side: 'new', start: 1, end: 4 })).toEqual(['a', 'B', 'C', 'd'])
    expect(selectionCode(f, { path: 'a.ts', side: 'old', start: 1, end: 3 })).toEqual(['a', 'b', 'd'])
  })
  it('places threads after their last line; moved or changed lines are outdated', () => {
    const ok = thread({})
    const changed = thread({ id: 'c-000002', code: ['old text'] })
    const gone = thread({ id: 'c-000003', end: 40, start: 40 })
    const other = thread({ id: 'c-000004', path: 'b.ts' })
    const p = placeThreads(f, [ok, changed, gone, other])
    expect(p.at.get('new:2')?.map((t) => t.id)).toEqual(['c-000001', 'c-000002'])
    expect(p.unplaced.map((t) => t.id)).toEqual(['c-000003'])
    expect([...p.outdated].sort()).toEqual(['c-000002', 'c-000003'])
    expect(orphanThreads([f], [ok, other]).map((t) => t.id)).toEqual(['c-000004'])
  })
})

describe('several checkouts', () => {
  it('repoViews keeps checkouts with changes or errors, keys files by root + path', () => {
    const views = repoViews([
      { root: '/w', label: '~/w', files: [] },
      { root: '/w/wt/a', label: 'wt/a', files: [file('x.ts'), file('src/y.ts')] },
      { root: '/w/wt/gone', label: 'wt/gone', error: 'not a git repository' },
    ])
    expect(views.map((v) => v.repo.label)).toEqual(['wt/a', 'wt/gone'])
    expect(views[0].files.map((f) => f.key)).toEqual([fileKey('/w/wt/a', 'src/y.ts'), fileKey('/w/wt/a', 'x.ts')])
    expect(fileKey('/w/wt/a', 'x.ts')).not.toBe(fileKey('/w/wt/b', 'x.ts'))
  })
  it('a thread without a root belongs to the default checkout; orphans by key', () => {
    const legacy = thread({ root: null, path: 'a.ts' })
    const other = thread({ id: 'c-000002', root: '/w/wt/b', path: 'a.ts' })
    expect(threadKey(legacy, '/w')).toBe(fileKey('/w', 'a.ts'))
    expect(orphanThreadsByKey(new Set([fileKey('/w', 'a.ts')]), [legacy, other], '/w').map((t) => t.id)).toEqual(['c-000002'])
  })
})
