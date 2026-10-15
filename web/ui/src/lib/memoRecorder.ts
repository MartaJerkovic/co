// Voice memos: one recorder for the whole app (keep recording while you look at something else).
//
// The mic is recorded in segments of SEGMENT_MS: at each cut a fresh MediaRecorder takes over the
// same stream, so every segment is a complete audio file the server can transcribe on its own,
// and a long conversation never hits the transcription limits. Chunks go to IndexedDB as they
// arrive (lib/memoStore.ts); a finished segment is uploaded right away, so stopping only waits for
// the last one. After the last upload, `finish` makes the server title and save the memo.
// Anything not yet on the server — the app closed, the network down — is retried, and recovered
// by the next app start.
import { ApiError, api } from '@/api/client'
import type { Memo } from '@/api/types'
import { memoStore, type PendingRecording } from '@/lib/memoStore'
import { micUnavailableReason, pickMimeType } from '@/lib/voice'

export const SEGMENT_MS = 5 * 60 * 1000
const CHUNK_MS = 5000
const HEARTBEAT_MS = 5000
/** A recording whose tab has not beaten for this long is recovered (stopped where it ended). */
const STALE_MS = 30 * 1000
const RETRY_MS = [5000, 15000, 30000, 60000, 120000]
const BITRATE = 48000

export type RecorderPhase = 'idle' | 'starting' | 'recording'

export interface RecorderSnapshot {
  phase: RecorderPhase
  recId: string | null
  startedAt: number | null
  /** Recordings on this device not yet saved on the server (incl. the one being recorded). */
  pending: PendingRecording[]
  /** Bumped whenever a memo is saved on the server (lists reload). */
  savedTick: number
  lastSaved: Memo | null
}

type Listener = () => void

const listeners = new Set<Listener>()
let snap: RecorderSnapshot = { phase: 'idle', recId: null, startedAt: null, pending: [], savedTick: 0, lastSaved: null }

function set(patch: Partial<RecorderSnapshot>) {
  snap = { ...snap, ...patch }
  listeners.forEach((l) => l())
}

async function refreshPending() {
  try {
    const all = await memoStore.allRecordings()
    set({ pending: all.sort((a, b) => b.startedAt - a.startedAt) })
  } catch {
    /* no IndexedDB: nothing to show */
  }
}

// ---------------------------------------------------------------- recording

let stream: MediaStream | null = null
let recorder: MediaRecorder | null = null
let current: { recId: string; mimeType: string; seg: number; chunk: number } | null = null
let cutTimer: number | undefined
let beatTimer: number | undefined
let wakeLock: { release(): Promise<void> } | null = null
let audioCtx: AudioContext | null = null
let analyser: AnalyserNode | null = null
// IndexedDB writes in order (a segment is complete only after its last chunk is stored).
let writes: Promise<unknown> = Promise.resolve()
const queue = <T>(fn: () => Promise<T>) => {
  const p = writes.then(fn)
  writes = p.catch((err) => console.error('[memos] store', err))
  return p
}

function newRecId(now: number): string {
  const d = new Date(now)
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  return `${stamp}-${Math.random().toString(36).slice(2, 6).padEnd(4, '0')}`
}

export function recorderUnavailable(): string | null {
  if (typeof window === 'undefined') return 'No browser'
  return micUnavailableReason({
    secure: window.isSecureContext,
    getUserMedia: typeof navigator.mediaDevices?.getUserMedia === 'function',
    recorder: typeof MediaRecorder !== 'undefined',
  })
}

export function micError(err: unknown): string {
  const name = (err as DOMException)?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone access was denied'
  if (name === 'NotFoundError') return 'No microphone found'
  return (err as Error)?.message || 'Could not start recording'
}

async function lockScreen() {
  try {
    const wl = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock
    wakeLock = (await wl?.request('screen')) ?? null
  } catch {
    wakeLock = null
  }
}

function onVisible() {
  // The wake lock is dropped whenever the page is hidden; take it again on return.
  if (document.visibilityState === 'visible' && snap.phase === 'recording') void lockScreen()
  if (document.visibilityState === 'visible') void drainAll()
}

/** Start one segment's MediaRecorder on the open stream. */
function startSegment(seg: number) {
  if (!stream || !current) return
  const { recId, mimeType } = current
  const rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: BITRATE })
  current = { ...current, seg, chunk: 0 }
  rec.ondataavailable = (e) => {
    if (!e.data.size) return
    const i = current && current.recId === recId && current.seg === seg ? current.chunk++ : Date.now()
    void queue(() => memoStore.putChunk({ recId, seg, i, blob: e.data }))
  }
  rec.onstop = () => {
    // After the last dataavailable: the segment is complete once its chunks are stored.
    void queue(async () => {
      await memoStore.updateRecording(recId, { done: seg + 1, heartbeat: Date.now() })
      void drain(recId)
    })
  }
  rec.start(CHUNK_MS)
  recorder = rec
}

export async function startRecording(): Promise<void> {
  if (snap.phase !== 'idle') return
  const reason = recorderUnavailable()
  if (reason) throw new Error(reason)
  set({ phase: 'starting' })
  try {
    const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } })
    const startedAt = Date.now()
    const recId = newRecId(startedAt)
    const mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t))
    await memoStore.putRecording({ recId, startedAt, mimeType: mimeType || 'audio/webm', done: 0, uploaded: [], heartbeat: startedAt })
    stream = media
    current = { recId, mimeType, seg: 0, chunk: 0 }
    // The mic went away (another app took it, a call came in): keep what was recorded.
    media.getAudioTracks().forEach((t) => (t.onended = () => void stopRecording()))
    startSegment(0)
    cutTimer = window.setInterval(() => {
      if (!current || !recorder) return
      const old = recorder
      startSegment(current.seg + 1)
      old.stop()
    }, SEGMENT_MS)
    beatTimer = window.setInterval(() => {
      if (current) void memoStore.updateRecording(current.recId, { heartbeat: Date.now() })
    }, HEARTBEAT_MS)
    try {
      audioCtx = new AudioContext()
      analyser = audioCtx.createAnalyser()
      analyser.fftSize = 512
      audioCtx.createMediaStreamSource(media).connect(analyser)
    } catch {
      analyser = null
    }
    void lockScreen()
    set({ phase: 'recording', recId, startedAt })
    void refreshPending()
  } catch (err) {
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
    current = null
    set({ phase: 'idle' })
    throw new Error(micError(err))
  }
}

/** Stop recording; the rest (last upload, title, save) happens in the background. */
export async function stopRecording(): Promise<void> {
  if (snap.phase !== 'recording' || !current) return
  const { recId } = current
  window.clearInterval(cutTimer)
  window.clearInterval(beatTimer)
  const rec = recorder
  recorder = null
  current = null
  const stoppedAt = Date.now()
  await new Promise<void>((resolve) => {
    if (!rec || rec.state === 'inactive') return resolve()
    rec.addEventListener('stop', () => resolve(), { once: true })
    rec.stop()
  })
  stream?.getTracks().forEach((t) => {
    t.onended = null
    t.stop()
  })
  stream = null
  void audioCtx?.close().catch(() => {})
  audioCtx = null
  analyser = null
  void wakeLock?.release().catch(() => {})
  wakeLock = null
  set({ phase: 'idle', recId: null, startedAt: null })
  // Queued behind the last segment's `done` update.
  await queue(() => memoStore.updateRecording(recId, { stoppedAt }))
  void drain(recId)
}

/** Input level 0…1 (for a meter), 0 when not recording. */
export function inputLevel(): number {
  if (!analyser) return 0
  const buf = new Uint8Array(analyser.fftSize)
  analyser.getByteTimeDomainData(buf)
  let sum = 0
  for (const v of buf) sum += ((v - 128) / 128) ** 2
  return Math.min(1, Math.sqrt(sum / buf.length) * 4)
}

// ---------------------------------------------------------------- uploads

const draining = new Map<string, Promise<void>>()
const retryAt = new Map<string, number>()
const attempts = new Map<string, number>()

function scheduleRetry(recId: string) {
  const n = attempts.get(recId) ?? 0
  attempts.set(recId, n + 1)
  const delay = RETRY_MS[Math.min(n, RETRY_MS.length - 1)]
  window.clearTimeout(retryAt.get(recId))
  retryAt.set(recId, window.setTimeout(() => void drain(recId), delay))
}

/** Upload what is complete; after the last segment of a stopped recording, finish it. */
export function drain(recId: string): Promise<void> {
  const running = draining.get(recId)
  if (running) return running.then(() => drain(recId))
  const p = (async () => {
    try {
      let r = await memoStore.getRecording(recId)
      if (!r) return
      for (let seg = 0; seg < r.done; seg++) {
        if (r.uploaded.includes(seg)) continue
        const blob = await memoStore.segmentBlob(recId, seg, r.mimeType)
        if (!blob.size) {
          // An empty last segment (stopped right after a cut) is simply not part of the memo.
          if (r.stoppedAt != null && seg === r.done - 1) {
            r = (await memoStore.updateRecording(recId, { done: seg })) ?? r
            break
          }
          continue
        }
        await api.putMemoSegment(recId, seg, blob)
        await memoStore.dropSegment(recId, seg)
        r = (await memoStore.updateRecording(recId, { uploaded: [...r.uploaded, seg], error: undefined })) ?? r
      }
      if (r.stoppedAt == null) return
      if (r.done === 0 || !r.uploaded.length) {
        await memoStore.dropRecording(recId)
        return
      }
      const memo = await api.finishMemo(recId, { segments: r.done, startedAt: r.startedAt, durationMs: Math.max(0, r.stoppedAt - r.startedAt) })
      await memoStore.dropRecording(recId)
      attempts.delete(recId)
      set({ savedTick: snap.savedTick + 1, lastSaved: memo })
    } catch (err) {
      const msg = err instanceof ApiError ? err.message || `HTTP ${err.status}` : (err as Error)?.message || String(err)
      console.warn('[memos] upload', recId, msg)
      await memoStore.updateRecording(recId, { error: msg }).catch(() => {})
      scheduleRetry(recId)
    } finally {
      await refreshPending()
    }
  })()
  draining.set(recId, p)
  void p.finally(() => draining.get(recId) === p && draining.delete(recId))
  return p
}

/** Retry every recording on this device now; a stale one (its tab is gone) is stopped where it ended. */
export async function drainAll(): Promise<void> {
  let all: PendingRecording[]
  try {
    all = await memoStore.allRecordings()
  } catch {
    return
  }
  const now = Date.now()
  for (const r of all) {
    if (r.recId === current?.recId) continue
    if (r.stoppedAt == null) {
      if (now - r.heartbeat < STALE_MS) continue
      const last = await memoStore.lastSegment(r.recId)
      await memoStore.updateRecording(r.recId, { done: Math.max(r.done, last + 1), stoppedAt: r.heartbeat })
    }
    attempts.delete(r.recId)
    void drain(r.recId)
  }
  await refreshPending()
}

/** Forget a recording that cannot be saved (its audio is lost). */
export async function discardPending(recId: string): Promise<void> {
  window.clearTimeout(retryAt.get(recId))
  await memoStore.dropRecording(recId)
  await refreshPending()
}

let initialized = false

/** Once per app: recover what an earlier run left behind; retry when the network or the tab comes back. */
export function initMemoRecorder() {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  window.addEventListener('online', () => void drainAll())
  document.addEventListener('visibilitychange', onVisible)
  void drainAll()
}

export const memoRecorder = {
  subscribe(l: Listener) {
    listeners.add(l)
    return () => listeners.delete(l)
  },
  snapshot: () => snap,
}
