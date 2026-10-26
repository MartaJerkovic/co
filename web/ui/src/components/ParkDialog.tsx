import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { api, ApiError } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useNotesHosts } from '@/hooks/useNotes'
import type { ParkKind } from '@/api/types'
import { useSettings } from '@/hooks/useSettings'
import { appendLine, onPark, PARK_LINE } from '@/lib/park'

/** One sentence into ~/notes (ideas or to-dos) without leaving what you are doing. */
export function ParkDialog() {
  const host = useNotesHosts()[0]?.name ?? null
  const targets = useSettings().park
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<ParkKind>('idea')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => onPark(() => setOpen(true)), [])

  const save = async () => {
    const t = text.trim()
    if (!t || !host || busy) return
    const target = targets[kind]
    setBusy(true)
    try {
      // A missing file starts with its heading.
      const f = await api.noteFile(host, target.file).catch((err) => {
        if (err instanceof ApiError && err.status === 404) return null
        throw err
      })
      await api.saveNote(host, target.file, appendLine(f?.text || target.heading, PARK_LINE[kind](t)), f?.mtime ?? null, { create: !f })
      toast.success(kind === 'idea' ? 'Idea saved' : 'To-do saved', { duration: 1800 })
      setText('')
      setOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Not saved')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Park a thought</DialogTitle>
          <DialogDescription>One sentence, then back to work.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <ToggleGroup type="single" value={kind} onValueChange={(v) => v && setKind(v as ParkKind)} aria-label="Save as" className="justify-start">
            <ToggleGroupItem value="idea" className="h-8 rounded-full px-3 text-sm">
              Idea
            </ToggleGroupItem>
            <ToggleGroupItem value="todo" className="h-8 rounded-full px-3 text-sm">
              To-do
            </ToggleGroupItem>
          </ToggleGroup>
          <Input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={kind === 'idea' ? 'e.g. assistant summarises a thread' : 'e.g. reply to Tina by Friday'} aria-label="Thought" />
          <div className="flex justify-end">
            <Button type="submit" disabled={!text.trim() || !host || busy}>
              Save
            </Button>
          </div>
        </form>
        {!host ? <p className="text-xs text-destructive">Notes are not set up (web.notes.root).</p> : null}
      </DialogContent>
    </Dialog>
  )
}
