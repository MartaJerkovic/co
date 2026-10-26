import { PlusIcon, XIcon } from 'lucide-react'
import { useLocation } from 'wouter'

import type { Space } from '@/api/types'
import { SpaceIcon } from '@/components/SpaceIcon'
import { Button } from '@/components/ui/button'
import { useFleet } from '@/hooks/useFleet'
import { useJobs } from '@/hooks/useJobs'
import { useSettings } from '@/hooks/useSettings'
import { spaceOf } from '@/lib/spaces'
import { BotList } from '@/screens/JobsScreen'

/**
 * `#/space/<id>` (desktop main pane): a space's start screen — a new session in its
 * directory and its bots, as on the Bots screen. The sidebar lists the space's sessions and bot runs.
 */
export function SpaceScreen({ space, dir, onNew }: { space: Space; dir: string | null; onNew: () => void }) {
  const [, navigate] = useLocation()
  const { fleet } = useFleet()
  const { jobs, patch, reload } = useJobs()
  const { spaces } = useSettings()
  const bots = jobs.filter((j) => spaceOf(spaces, fleet, j.host, j.dir)?.id === space.id)

  return (
    <section aria-label={space.label} className="flex h-full min-w-0 flex-1 flex-col bg-background">
      <header data-tauri-drag-region="deep" className="titlebar titlebar-lead flex shrink-0 items-center gap-1 border-b py-1.5 pr-2 pl-4 [--titlebar-pad:1rem]">
        <h1 className="flex min-w-0 flex-1 items-center gap-1.5 text-[0.9375rem] leading-tight font-bold">
          <SpaceIcon icon={space.icon} className="size-4 text-muted-foreground" /> {space.label}
        </h1>
        <Button variant="ghost" size="icon" aria-label={`Close ${space.label}`} title="Close (Esc)" onClick={() => navigate('/')} className="size-11 shrink-0 rounded-xl">
          <XIcon className="size-5" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-10 md:max-w-2xl">
          <div className="flex flex-col items-center gap-3 text-center">
            <SpaceIcon icon={space.icon} className="size-8 text-dimmer" />
            <p className="max-w-sm text-sm text-muted-foreground">{space.blurb}</p>
            {dir ? (
              <Button onClick={onNew} className="rounded-full">
                <PlusIcon /> {space.action}
              </Button>
            ) : (
              <p className="max-w-sm text-xs text-dimmer">Add a start directory named “{space.label}” in Settings to begin.</p>
            )}
          </div>
          {bots.length ? (
            <div className="space-y-3">
              <BotList jobs={bots} patch={patch} reload={reload} />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
