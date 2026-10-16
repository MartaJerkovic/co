import type { DiffFile, DiffHunk, DiffLine } from '@/api/types'

/** `#/review/<host>/<id>`: the diff reviewer for that session. */
export const reviewHref = (host: string, id: string) => `/review/${encodeURIComponent(host)}/${encodeURIComponent(id)}`

export function parseReviewLocation(location: string): { host: string; id: string } | null {
  const m = /^\/review\/([^/]+)\/([^/]+)\/?$/.exec(location)
  if (!m) return null
  try {
    return { host: decodeURIComponent(m[1]), id: decodeURIComponent(m[2]) }
  } catch {
    return null
  }
}

export interface TreeDir {
  kind: 'dir'
  /** display name: a chain of single-child folders is one row (`src/lib`) */
  name: string
  path: string
  children: TreeNode[]
}
export interface TreeFile {
  kind: 'file'
  name: string
  file: DiffFile
}
export type TreeNode = TreeDir | TreeFile

/** The changed files as a folder tree (folders first, then files, each by name), single-child folder chains merged. */
export function fileTree(files: DiffFile[]): TreeNode[] {
  const root: TreeDir = { kind: 'dir', name: '', path: '', children: [] }
  for (const file of files) {
    const parts = file.path.split('/')
    let dir = root
    for (const part of parts.slice(0, -1)) {
      const path = dir.path ? `${dir.path}/${part}` : part
      let next = dir.children.find((c): c is TreeDir => c.kind === 'dir' && c.path === path)
      if (!next) {
        next = { kind: 'dir', name: part, path, children: [] }
        dir.children.push(next)
      }
      dir = next
    }
    dir.children.push({ kind: 'file', name: parts.at(-1) ?? file.path, file })
  }
  const finish = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .map((n) => {
        if (n.kind === 'file') return n
        let d = n
        while (d.children.length === 1 && d.children[0].kind === 'dir') {
          const only = d.children[0]
          d = { ...only, name: `${d.name}/${only.name}` }
        }
        return { ...d, children: finish(d.children) }
      })
      .sort((a, b) => (a.kind !== b.kind ? (a.kind === 'dir' ? -1 : 1) : a.name.localeCompare(b.name)))
  return finish(root.children)
}

/** The files in the order the tree shows them (the diff list follows the tree). */
export function treeOrder(nodes: TreeNode[]): DiffFile[] {
  return nodes.flatMap((n) => (n.kind === 'file' ? [n.file] : treeOrder(n.children)))
}

export interface SplitRow {
  left: DiffLine | null
  right: DiffLine | null
}

/** Side-by-side rows: context on both sides; a run of removals paired line by line with the additions after it. */
export function splitRows(hunk: DiffHunk): SplitRow[] {
  const rows: SplitRow[] = []
  const lines = hunk.lines
  for (let i = 0; i < lines.length; ) {
    const l = lines[i]
    if (l.t === ' ') {
      rows.push({ left: l, right: l })
      i++
      continue
    }
    const del: DiffLine[] = []
    const add: DiffLine[] = []
    while (i < lines.length && lines[i].t === '-') del.push(lines[i++])
    while (i < lines.length && lines[i].t === '+') add.push(lines[i++])
    for (let k = 0; k < Math.max(del.length, add.length); k++) rows.push({ left: del[k] ?? null, right: add[k] ?? null })
  }
  return rows
}

/** A short content signature of a file's diff: "Viewed" is dropped when it changes. */
export function fileSignature(file: DiffFile): string {
  let h = 5381
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  }
  feed(`${file.status}\0${file.oldPath ?? ''}\0${file.binary ? 1 : 0}`)
  for (const hunk of file.hunks) {
    feed(hunk.header)
    for (const l of hunk.lines) feed(`${l.t}${l.text}\n`)
  }
  return (h >>> 0).toString(36)
}

/** GitHub's five-square bar: how many of 5 are green. */
export function diffBar(additions: number, deletions: number): number {
  const total = additions + deletions
  if (!total) return 0
  return Math.round((additions / total) * 5)
}

/** A file card's element id (looked up with getElementById, so any path is fine). */
export const fileAnchor = (path: string) => `diff:${path}`
