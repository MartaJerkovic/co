import { useEffect, useState, type ReactNode } from 'react'

import { api } from '@/api/client'
import { DEFAULT_PARK, DEFAULT_SETTINGS, SettingsContext, type SettingsState } from '@/hooks/useSettings'
import { normalizeModels } from '@/lib/models'
import type { ParkTargets, PromptButton, Space } from '@/api/types'

/** A server's prompt buttons, or null (none configured, or malformed) for the built-in ones. */
function promptButtons(v: unknown): PromptButton[] | null {
  if (!Array.isArray(v)) return null
  const list = v.filter((b): b is PromptButton => !!b && typeof b.label === 'string' && typeof b.text === 'string' && !!b.text)
  return list.length ? list : null
}

/** A server's spaces; older servers send none. */
function spaces(v: unknown): Space[] {
  return Array.isArray(v) ? v.filter((s): s is Space => !!s && typeof s.id === 'string' && typeof s.label === 'string') : []
}

/** A server's park targets, kind by kind; the default for a kind it does not send. */
function park(v: unknown): ParkTargets {
  const t = (v ?? {}) as Partial<ParkTargets>
  const ok = (x: unknown): x is ParkTargets['idea'] => !!x && typeof (x as { file?: unknown }).file === 'string'
  return { idea: ok(t.idea) ? t.idea : DEFAULT_PARK.idea, todo: ok(t.todo) ? t.todo : DEFAULT_PARK.todo }
}

/** Loads /api/settings once; the app renders with defaults until (or if never) it answers. */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS)

  useEffect(() => {
    const controller = new AbortController()
    api
      .settings({ signal: controller.signal })
      .then((data) => {
        const quickReplies = Array.isArray(data?.quickReplies)
          ? data.quickReplies.filter((q) => q && typeof q.text === 'string' && q.text)
          : DEFAULT_SETTINGS.quickReplies
        setSettings({
          self: typeof data?.self === 'string' ? data.self : null,
          hosts: Array.isArray(data?.hosts) ? data.hosts : [],
          quickReplies,
          prPrompts: promptButtons(data?.prPrompts),
          taskPrompts: promptButtons(data?.taskPrompts),
          spaces: spaces(data?.spaces),
          park: park(data?.park),
          uploadMaxMB: typeof data?.uploads?.maxMB === 'number' ? data.uploads.maxMB : null,
          models: normalizeModels(data?.models),
          voice: data?.transcribe?.enabled === true,
          speak: data?.speak?.enabled === true,
          operator: data?.operator?.enabled === true,
          memos: data?.memos?.enabled === true,
          focusHost: typeof data?.focus?.host === 'string' ? data.focus.host : null,
          loaded: true,
        })
      })
      .catch(() => {
        if (!controller.signal.aborted) setSettings((s) => ({ ...s, loaded: true }))
      })
    return () => controller.abort()
  }, [])

  return <SettingsContext.Provider value={settings}>{children}</SettingsContext.Provider>
}
