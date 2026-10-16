import { CheckIcon, ChevronDownIcon, ChevronRightIcon, FolderIcon } from 'lucide-react'
import { useState } from 'react'

import { StatusLetter } from '@/components/review/FileDiff'
import type { TreeNode } from '@/lib/review'
import { cn } from '@/lib/utils'

export interface FileTreeProps {
  nodes: TreeNode[]
  viewed: (path: string) => boolean
  fresh: (path: string) => boolean
  active: string | null
  onOpen: (path: string) => void
}

/** The left column: changed files as folders (collapsible), status letter, viewed tick. */
export function FileTree({ nodes, ...rest }: FileTreeProps) {
  return (
    <ul role="tree" aria-label="Changed files" className="space-y-px py-1 text-[0.8125rem]">
      {nodes.map((n) => (
        <Node key={n.kind === 'dir' ? `d:${n.path}` : n.file.path} node={n} depth={0} {...rest} />
      ))}
    </ul>
  )
}

function Node({ node, depth, viewed, fresh, active, onOpen }: { node: TreeNode; depth: number } & Omit<FileTreeProps, 'nodes'>) {
  const [open, setOpen] = useState(true)
  const pad = { paddingLeft: `${0.5 + depth * 0.875}rem` }
  if (node.kind === 'dir') {
    return (
      <li role="treeitem" aria-expanded={open}>
        <button type="button" onClick={() => setOpen(!open)} style={pad} className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left hover:bg-muted">
          {open ? <ChevronDownIcon className="size-3.5 shrink-0 text-dimmer" /> : <ChevronRightIcon className="size-3.5 shrink-0 text-dimmer" />}
          <FolderIcon className="size-3.5 shrink-0 text-dimmer" />
          <span className="truncate">{node.name}</span>
        </button>
        {open ? (
          <ul role="group" className="space-y-px">
            {node.children.map((c) => (
              <Node key={c.kind === 'dir' ? `d:${c.path}` : c.file.path} node={c} depth={depth + 1} viewed={viewed} fresh={fresh} active={active} onOpen={onOpen} />
            ))}
          </ul>
        ) : null}
      </li>
    )
  }
  const path = node.file.path
  const seen = viewed(path)
  return (
    <li role="treeitem" aria-selected={active === path}>
      <button
        type="button"
        onClick={() => onOpen(path)}
        style={pad}
        title={path}
        className={cn('flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left hover:bg-muted', active === path && 'bg-muted font-medium', seen && 'text-muted-foreground')}
      >
        <span className="size-3.5 shrink-0" />
        <StatusLetter status={node.file.status} />
        <span className={cn('min-w-0 flex-1 truncate', fresh(path) && 'text-primary')}>{node.name}</span>
        {seen ? <CheckIcon className="size-3.5 shrink-0 text-dimmer" aria-label="viewed" /> : null}
      </button>
    </li>
  )
}
