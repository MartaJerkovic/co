import type { PullRequest, Session, Task, TaskColumn, TaskColumnId, TaskStatus, TasksResponse } from '@/api/types'
import type { PrLinks } from '@/lib/prs'

/** Display order and titles when a server sends no `columns` (and the order it should send). */
export const TASK_COLUMNS: { id: TaskColumnId; title: string }[] = [
  { id: 'due', title: 'Due soon / overdue' },
  { id: 'inProgress', title: 'In progress' },
  { id: 'toDo', title: 'To do' },
]

/** Past this many days without activity a task is idle: hidden unless asked for. */
export const IDLE_DAYS = 60
const DAY_MS = 24 * 3600 * 1000

export interface TaskGroup extends TaskColumn {
  tasks: Task[]
}

/** Days since its last activity (else its last update); null when unknown. */
export function idleDays(t: Pick<Task, 'lastActivityAt' | 'updatedAt'>, now: number): number | null {
  const at = t.lastActivityAt ?? t.updatedAt
  if (!at) return null
  return Math.max(0, Math.floor((now - at) / DAY_MS))
}

/** No activity for [IDLE_DAYS] — what the Idle toggle hides. A due task is never idle. */
export const isIdle = (t: Task, now: number) => t.column !== 'due' && (idleDays(t, now) ?? 0) >= IDLE_DAYS

/**
 * The answer's columns, each with its tasks (in the server's order); unknown columns are kept,
 * last. `filter` matches the title, `#number`, project, task list, status and tags; `project`
 * keeps one project's; `hideIdle` leaves out [isIdle] tasks.
 */
export function groupTasks(
  r: Pick<TasksResponse, 'columns' | 'tasks'> | null,
  filter = '',
  { project = null, hideIdle = false, now = Date.now() }: { project?: string | null; hideIdle?: boolean; now?: number } = {},
): TaskGroup[] {
  if (!r) return []
  const cols = r.columns?.length ? r.columns : TASK_COLUMNS.map((c) => ({ ...c, count: 0 }))
  const q = filter.trim().toLowerCase()
  const hit = (t: Task) =>
    !q ||
    [t.title, `#${t.number}`, t.id, t.project.name, t.taskList ?? '', t.status.name, ...t.tags].some((s) => s.toLowerCase().includes(q))
  const groups: TaskGroup[] = cols.map((c) => ({ ...c, tasks: [] }))
  const byId = new Map(groups.map((g) => [g.id as string, g]))
  for (const t of r.tasks ?? []) {
    if (!hit(t)) continue
    if (project && t.project.id !== project) continue
    if (hideIdle && isIdle(t, now)) continue
    let g = byId.get(t.column)
    if (!g) {
      g = { id: t.column, title: t.column, count: 0, tasks: [] }
      byId.set(t.column, g)
      groups.push(g)
    }
    g.tasks.push(t)
  }
  return groups
}

/** The projects your tasks are in, by name, with how many each. */
export function taskProjects(tasks: Task[]): { id: string; name: string; count: number }[] {
  const m = new Map<string, { id: string; name: string; count: number }>()
  for (const t of tasks) {
    const p = m.get(t.project.id) ?? { ...t.project, count: 0 }
    p.count++
    m.set(t.project.id, p)
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export type DueTone = 'overdue' | 'soon' | 'later'

/** `YYYY-MM-DD` → local midnight (ms); null when it is not a date. */
function localDay(d: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
}

/** The due chip: `overdue 3d` / `today` / `tomorrow` / `in 5d` / a date; red past it, amber within 3 days. */
export function dueInfo(dueDate: string | null, now: number): { label: string; tone: DueTone } | null {
  if (!dueDate) return null
  const day = localDay(dueDate)
  if (day == null) return null
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const days = Math.round((day - today.getTime()) / DAY_MS)
  if (days < 0) return { label: days === -1 ? 'overdue 1d' : `overdue ${-days}d`, tone: 'overdue' }
  if (days === 0) return { label: 'due today', tone: 'soon' }
  if (days === 1) return { label: 'due tomorrow', tone: 'soon' }
  if (days <= 3) return { label: `due in ${days}d`, tone: 'soon' }
  if (days <= 14) return { label: `due in ${days}d`, tone: 'later' }
  return { label: `due ${new Date(day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`, tone: 'later' }
}

export const DUE_TONE: Record<DueTone, string> = {
  overdue: 'font-semibold text-status-error',
  soon: 'text-status-waiting',
  later: 'text-muted-foreground',
}

/** The status badge colour per category (an unknown one: muted). */
export function statusTone(s: Pick<TaskStatus, 'category'>): string {
  if (s.category === 'started') return 'border-status-busy/40 text-status-busy'
  if (s.category === 'closed') return 'border-status-idle/40 text-status-idle'
  return 'border-border text-muted-foreground'
}

/** The statuses a task can move to: its workflow's, open ones by position, closed ones last. */
export function statusOptions(t: Pick<Task, 'workflowId' | 'status'>, statuses: TasksResponse['statuses'] | undefined): TaskStatus[] {
  const list = statuses?.[t.workflowId] ?? []
  const rank = (s: TaskStatus) => (s.category === 'closed' ? 1 : 0)
  const all = list.some((s) => s.id === t.status.id) ? list : [t.status, ...list]
  return [...all].sort((a, b) => rank(a) - rank(b) || a.position - b.position || a.name.localeCompare(b.name))
}

const TASK_LINK_RE = /app\.productive\.io\/\d+-[\w-]+\/tasks?\/(\d+)/g

/** The Productive task ids a text links to (`app.productive.io/<org>/tasks/<id>`), in order, once each. */
export function taskIdsIn(text: string | null | undefined): string[] {
  if (!text) return []
  const ids: string[] = []
  for (const m of text.matchAll(TASK_LINK_RE)) if (!ids.includes(m[1])) ids.push(m[1])
  return ids
}

/** Starting prompts offered for a task, the most likely first. */
export function promptChips(t: Pick<Task, 'status'>): { label: string; text: string }[] {
  const plan = {
    label: 'Plan',
    text: 'Read the task (and its comments) in Productive, look at the code it concerns, and propose a plan before changing anything.',
  }
  const implement = { label: 'Implement', text: 'Read the task in Productive and implement it: a branch, the change, tests, then a pull request that links the task.' }
  const investigate = { label: 'Investigate', text: 'Investigate this task: find where the problem is and what causes it, and report back before fixing anything.' }
  const resume = { label: 'Continue', text: 'Pick up the work on this task: find its branch or pull request, see where it stands and what is left.' }
  return t.status.category === 'started' ? [resume, implement, plan, investigate] : [plan, implement, investigate]
}

/** `#/tasks/<id>`: the tasks screen with that task's dialog open. */
export const taskHref = (t: Pick<Task, 'id'>) => `/tasks/${encodeURIComponent(t.id)}`

/** The task a `#/tasks/<id>` location names; null for plain `/tasks` (or anything else). */
export function parseTaskLocation(location: string): string | null {
  const m = /^\/tasks\/([1-9][0-9]*)$/.exec(location)
  return m ? m[1] : null
}

export const isTasksLocation = (location: string) => location === '/tasks' || location.startsWith('/tasks/')

export interface TaskLinks {
  /** `host/sessionId` → the task it works on. */
  bySession: Map<string, Task>
  /** task id → its sessions. */
  byTask: Map<string, Session[]>
  /** task id → the PRs that link it. */
  prsByTask: Map<string, PullRequest[]>
  /** PR url → the tasks it links (known ones). */
  byPr: Map<string, Task[]>
}

/**
 * Sessions and PRs ↔ tasks. A PR works on the tasks its description links. A session works on a
 * task when its first prompt links it (a session started from the task, or given its link), else
 * when it runs in the worktree of a PR that links one ([PrLinks]). Only tasks in `tasks` link.
 */
export function linkTasks(tasks: Task[], prs: PullRequest[], prLinks: Pick<PrLinks, 'bySession'>, sessions: Session[]): TaskLinks {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const bySession = new Map<string, Task>()
  const byTask = new Map<string, Session[]>()
  const prsByTask = new Map<string, PullRequest[]>()
  const byPr = new Map<string, Task[]>()
  for (const p of prs) {
    const linked = (p.tasks ?? []).map((id) => byId.get(id)).filter((t): t is Task => !!t)
    if (!linked.length) continue
    byPr.set(p.url, linked)
    for (const t of linked) prsByTask.set(t.id, [...(prsByTask.get(t.id) ?? []), p])
  }
  for (const s of sessions) {
    if (!s.session_id) continue
    const key = `${s.host}/${s.session_id}`
    const fromPrompt = taskIdsIn(s.title)
      .map((id) => byId.get(id))
      .find((t): t is Task => !!t)
    const pr = prLinks.bySession.get(key)
    const t = fromPrompt ?? (pr ? byPr.get(pr.url)?.[0] : undefined)
    if (!t) continue
    bySession.set(key, t)
    byTask.set(t.id, [...(byTask.get(t.id) ?? []), s])
  }
  return { bySession, byTask, prsByTask, byPr }
}
