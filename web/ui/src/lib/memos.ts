// Voice memos: pure helpers for the Memos screen (lib/memoRecorder.ts records, the server saves).

/** `#/memos` → { id: null }, `#/memos/<id>` → { id }, anything else → null. */
export function parseMemosLocation(location: string): { id: string | null } | null {
  const m = /^\/memos(?:\/([^/?#]+))?\/?$/.exec(location)
  if (!m) return null
  if (!m[1]) return { id: null }
  try {
    return { id: decodeURIComponent(m[1]) }
  } catch {
    return { id: m[1] }
  }
}

export const memoHref = (id: string) => `#/memos/${encodeURIComponent(id)}`

/** `m:ss`, `h:mm:ss` past an hour. */
export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return ''
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** `14:32` today, `Yesterday 14:32`, `Mon 14:32` this week, else `15 Oct 14:32` (+ year when not this one). */
export function memoWhen(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const day = new Date(d)
  day.setHours(0, 0, 0, 0)
  const days = Math.round((today.getTime() - day.getTime()) / 86_400_000)
  if (days === 0) return time
  if (days === 1) return `Yesterday ${time}`
  if (days > 1 && days < 7) return `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${time}`
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })} ${time}`
}

/** The first prompt of a session started from a memo (editable in the New session form). */
export function memoSessionPrompt(memo: { title: string; path: string }): string {
  return [
    `Read the voice memo "${memo.title}" at ${memo.path} — a transcript of a conversation I recorded (speakers are not marked; names and terms may be misheard).`,
    'Give me its key points, the decisions made and the action items (who, what), then ask what I want to do with them.',
  ].join(' ')
}
