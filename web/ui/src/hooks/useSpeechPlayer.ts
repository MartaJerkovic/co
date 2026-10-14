import { createContext, useContext } from 'react'

import type { SpeechState } from '@/hooks/useSpeech'

/** The app's one reader (providers/SpeechProvider.tsx): a new reading always stops the last. */
export interface SpeechPlayer {
  /** Replies can be read aloud here: the server's OpenAI voice, else this device's voice. */
  available: boolean
  state: SpeechState
  /** What is being read (the `key` given to `speak`), null when nothing is. */
  activeKey: string | null
  /** Read `text` aloud; `key` names it so its button can show it playing. */
  speak: (text: string, key?: string) => Promise<void>
  stop: () => void
  /** From a tap: lets a reading that starts later play (iOS). */
  unlock: () => void
  rate: number
  setRate: (rate: number) => void
}

export const SpeechContext = createContext<SpeechPlayer>({
  available: false,
  state: 'idle',
  activeKey: null,
  speak: async () => {},
  stop: () => {},
  unlock: () => {},
  rate: 1,
  setRate: () => {},
})

export const useSpeechPlayer = () => useContext(SpeechContext)
