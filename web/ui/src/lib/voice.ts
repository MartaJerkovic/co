// Voice prompts: pure helpers for the composer's mic (hooks/useVoice.ts records, the server
// transcribes — web/lib/transcribe.mjs).

/** Recording formats in order of preference: webm/opus (Chrome, Firefox), mp4/aac (Safari, WKWebView). */
const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']

/** The first format this browser records, or '' (let MediaRecorder pick its default). */
export function pickMimeType(isSupported: (type: string) => boolean): string {
  return MIME_TYPES.find((t) => isSupported(t)) ?? ''
}

/** The transcript appended to what is already typed: one space between them, nothing when empty. */
export function appendTranscript(current: string, transcript: string): string {
  const t = transcript.trim()
  if (!t) return current
  if (!current || /\s$/.test(current)) return current + t
  return `${current} ${t}`
}

/** Why the mic cannot work in this page, or null. Insecure origins (plain http to a non-localhost host) have no getUserMedia. */
export function micUnavailableReason(env: { secure: boolean; getUserMedia: boolean; recorder: boolean }): string | null {
  if (!env.secure) return 'The microphone needs HTTPS (or localhost)'
  if (!env.getUserMedia || !env.recorder) return 'This browser cannot record audio'
  return null
}

/** mm:ss */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
