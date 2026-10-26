import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { ContextUsage } from '@/api/types'
import { useSettings } from '@/hooks/useSettings'
import { modelLabel } from '@/lib/format'
import { cn } from '@/lib/utils'

/** Claude Code's `/effort` levels. */
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

/**
 * The session header's model and thinking effort: shows them, and switches them with `/model` and
 * `/effort` sent like any message (`onSend`: the outbox). A bare `/model` in the composer opens it too.
 */
export function ModelMenu({
  context,
  open,
  onOpenChange,
  onSend,
  disabled,
}: {
  context?: ContextUsage | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSend: (text: string) => void
  disabled?: boolean
}) {
  const { models } = useSettings()
  const model = context?.model ?? ''
  const effort = context?.effort ?? ''
  const label = model ? `${modelLabel(model)}${effort ? ` · ${effort}` : ''}` : 'Model'
  return (
    <DropdownMenu open={open && !disabled} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        disabled={disabled}
        title={model ? `${model} — switch model or thinking` : 'Switch model or thinking'}
        className={cn('shrink-0 rounded text-dim outline-none', !disabled && 'hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50')}
      >
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        <DropdownMenuLabel>Model</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={model} onValueChange={(id) => onSend(`/model ${id}`)}>
          {models
            .filter((m) => m.id)
            .map((m) => (
              <DropdownMenuRadioItem key={m.id} value={m.id}>
                {m.label}
              </DropdownMenuRadioItem>
            ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Thinking</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={effort} onValueChange={(e) => onSend(`/effort ${e}`)}>
          {EFFORTS.map((e) => (
            <DropdownMenuRadioItem key={e} value={e}>
              {e}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
