import { createContext, useContext } from 'react'

import type { ModelOption, ParkTargets, PromptButton, QuickReply, SessionKey, Space } from '@/api/types'
import { DEFAULT_MODELS } from '@/lib/models'

export interface SettingsState {
  /** This host's name (null until /api/settings answered). */
  self: string | null
  /** Every configured host name (self + peers). */
  hosts: string[]
  /** Composer text chips (config `web.quickReplies`). */
  quickReplies: QuickReply[]
  /** PR / task dialog buttons (config `web.prPrompts` / `web.taskPrompts`; null: built-in). */
  prPrompts: PromptButton[] | null
  taskPrompts: PromptButton[] | null
  /** Config `web.spaces` ([]: none). */
  spaces: Space[]
  /** Config `web.park`. */
  park: ParkTargets
  /** This server's `web.uploads.maxMB` (null: unknown — the target host enforces its own). */
  uploadMaxMB: number | null
  /** New session model picker (config `web.models`). */
  models: ModelOption[]
  /** This server transcribes voice prompts (the composer's mic). */
  voice: boolean
  /** This server reads replies aloud (POST /api/speak) and runs the voice operator. */
  speak: boolean
  operator: boolean
  /** This server keeps voice memos (/api/memos). */
  memos: boolean
  /** Where the Focus toggle runs `focus` (config `web.focus.host`; null: no toggle). */
  focusHost: string | null
  loaded: boolean
}

export const DEFAULT_QUICK_REPLIES: QuickReply[] = [
  { label: 'Continue', text: 'Continue.' },
  { label: 'Yes', text: 'Yes' },
  { label: 'No', text: 'No' },
  { label: '1', text: '1' },
  { label: '2', text: '2' },
]

/** Key chips are built in (not configurable). */
export const QUICK_KEYS: { label: string; key: SessionKey }[] = [
  { label: 'Esc', key: 'Escape' },
  { label: '↵', key: 'Enter' },
  { label: '↑', key: 'Up' },
  { label: '↓', key: 'Down' },
]

/** As the server's default (lib/config.mjs DEFAULT_PARK). */
export const DEFAULT_PARK: ParkTargets = { idea: { file: 'ideas.md', heading: '# Ideas' }, todo: { file: 'todos.md', heading: '# To-dos' } }

export const DEFAULT_SETTINGS: SettingsState = { self: null, hosts: [], quickReplies: DEFAULT_QUICK_REPLIES, prPrompts: null, taskPrompts: null, spaces: [], park: DEFAULT_PARK, uploadMaxMB: null, models: DEFAULT_MODELS, voice: false, speak: false, operator: false, memos: false, focusHost: null, loaded: false }

export const SettingsContext = createContext<SettingsState>(DEFAULT_SETTINGS)

export function useSettings(): SettingsState {
  return useContext(SettingsContext)
}
