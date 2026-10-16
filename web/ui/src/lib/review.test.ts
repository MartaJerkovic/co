import { describe, expect, it } from 'vitest'

import type { DiffFile, DiffHunk } from '@/api/types'

import { diffBar, fileSignature, fileTree, parseReviewLocation, reviewHref, splitRows, treeOrder } from './review'

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
