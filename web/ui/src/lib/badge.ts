/**
 * The Dock badge in Fleet.app: how many sessions wait for you. No-op in a browser tab (no Tauri
 * bridge) or an older Fleet.app that lacks the permission.
 */
type TauriInternals = { invoke: (cmd: string, args: Record<string, unknown>) => Promise<unknown> }

export function setDockBadge(count: number) {
  const tauri = (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__
  if (!tauri) return
  tauri.invoke('plugin:window|set_badge_count', { label: 'main', value: count > 0 ? count : null }).catch(() => {})
}
