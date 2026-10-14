import { Loader2Icon, SquareIcon, Volume2Icon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useSpeechPlayer } from '@/hooks/useSpeechPlayer'
import { cn } from '@/lib/utils'

/** Read a message aloud (tap again to stop). Hidden where nothing can speak. */
export function SpeakButton({ text, id, className }: { text: string; id: string; className?: string }) {
  const player = useSpeechPlayer()
  if (!player.available || !text.trim()) return null
  const mine = player.activeKey === id
  const label = mine ? 'Stop reading' : 'Read aloud'
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      title={label}
      onClick={() => {
        if (mine) return player.stop()
        player.unlock()
        void player.speak(text, id)
      }}
      className={cn('text-dimmer hover:text-foreground', mine && 'text-foreground', className)}
    >
      {mine && player.state === 'loading' ? <Loader2Icon className="animate-spin" /> : mine ? <SquareIcon className="fill-current" /> : <Volume2Icon />}
    </Button>
  )
}
