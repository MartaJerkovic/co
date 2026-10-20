import { useLocation } from 'wouter'

import { NewSessionDialog, NewSessionDrawer } from '@/components/NewSessionDrawer'
import { StackLinkDialog } from '@/components/stack/StackLinkDialog'
import { StackSheet } from '@/components/stack/StackSheet'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { closeSiblingSpawn, closeStackLink, closeStackSheet, useStackUi } from '@/hooks/useStackUi'

/** The app-wide Stack sheet, Spawn sibling form and Link picker (opened through hooks/useStackUi.ts). Mount once, inside the router. */
export function StackUi() {
  const { sheet, sibling, link } = useStackUi()
  const desktop = useIsDesktop()
  const [, navigate] = useLocation()
  const NewSession = desktop ? NewSessionDialog : NewSessionDrawer
  return (
    <>
      <StackSheet target={sheet} onClose={closeStackSheet} onNavigate={navigate} desktop={desktop} />
      <StackLinkDialog target={link} onClose={closeStackLink} />
      <NewSession open={sibling != null} onOpenChange={(o) => !o && closeSiblingSpawn()} onOpenSession={(href) => navigate(href)} sibling={sibling} />
    </>
  )
}
