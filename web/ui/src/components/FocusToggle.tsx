import { MoonIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useFocus, type FocusState } from '@/hooks/useFocus'
import { useNow } from '@/hooks/useNow'
import { cn } from '@/lib/utils'

/** Minutes left, rounded up ("42m"); null when off. */
function left(focus: FocusState, now: number): string | null {
  const s = focus.status
  if (!s?.active || s.endsAt == null) return null
  return `${Math.max(1, Math.ceil((s.endsAt - now) / 60000))}m`
}

function label(focus: FocusState, remaining: string | null): string {
  return remaining ? `Focus on — ${remaining} left on ${focus.host} (click to stop)` : `Focus mode on ${focus.host}: Do Not Disturb, distracting apps quit`
}

async function toggle(focus: FocusState) {
  const on = !focus.status?.active
  try {
    await focus.toggle()
    toast.success(on ? 'Focus on' : 'Focus off')
  } catch (err) {
    toast.error(`Focus: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** The Focus mode button (the desktop sidebar, the rail): nothing when no host runs `focus`. */
export function FocusToggle({ size = 'icon', className }: { size?: 'icon' | 'icon-sm'; className?: string }) {
  const focus = useFocus()
  const now = useNow(30 * 1000)
  if (!focus.host) return null
  const remaining = left(focus, now)
  return (
    <Button
      variant="ghost"
      size={remaining ? 'sm' : size}
      aria-label="Focus mode"
      aria-pressed={Boolean(remaining)}
      title={label(focus, remaining)}
      disabled={focus.busy}
      onClick={() => void toggle(focus)}
      className={cn('text-dimmer hover:text-foreground', remaining && 'h-7 gap-1 px-1.5 text-primary hover:text-primary', className)}
    >
      <MoonIcon className={cn(remaining && 'fill-current')} />
      {remaining ? <span className="text-xs tabular-nums">{remaining}</span> : null}
    </Button>
  )
}

/** The same as a menu item (the mobile ⋯ menu). */
export function FocusMenuItem() {
  const focus = useFocus()
  const now = useNow(30 * 1000)
  if (!focus.host) return null
  const remaining = left(focus, now)
  return (
    <DropdownMenuItem disabled={focus.busy} onSelect={() => void toggle(focus)}>
      <MoonIcon className={cn(remaining && 'fill-current text-primary')} />
      {remaining ? `Focus on · ${remaining}` : 'Focus mode'}
    </DropdownMenuItem>
  )
}
