import { FlaskConicalIcon, FolderIcon, LeafIcon, PaletteIcon, SproutIcon, type LucideIcon } from 'lucide-react'

/** The icons a space (config `web.spaces`) can name; anything else is a folder. */
const ICONS: Record<string, LucideIcon> = { flask: FlaskConicalIcon, sprout: SproutIcon, leaf: LeafIcon, palette: PaletteIcon }

export function SpaceIcon({ icon, className }: { icon: string | null; className?: string }) {
  const Icon = (icon && ICONS[icon]) || FolderIcon
  return <Icon className={className} />
}
