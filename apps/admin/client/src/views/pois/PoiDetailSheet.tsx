import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { EyeOff, Trash2, X } from 'lucide-react'
import { api } from '@/lib/api'
import { qk } from '@/lib/queryKeys'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { PendingButton } from '@/components/ui/pending-button'
import { ErrorCallout } from '@/components/ui/error-callout'
import { Skeleton } from '@/components/ui/skeleton'
import { Segmented, type SegmentedOption } from '@/components/ui/segmented'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { FactsTab } from './FactsTab'
import { Location } from './Location'
import { NarrationTab } from './NarrationTab'
import { Corrections } from './Corrections'

type DetailTab = 'facts' | 'location' | 'narration' | 'corrections'
const DETAIL_TABS: SegmentedOption<DetailTab>[] = [
  { value: 'facts', label: 'Facts' },
  { value: 'location', label: 'Location' },
  { value: 'narration', label: 'Narration' },
  { value: 'corrections', label: 'Corrections' },
]

export function PoiDetailSheet({ poiId, poiName, canDelete, hasNarration, open, onOpenChange }: {
  poiId: string
  poiName: string
  /** Orphan (no narration) → a hard delete is allowed. Referenced POIs are guarded server-side. */
  canDelete: boolean
  /** Whether a synthesized narration exists for this POI (drives the player vs empty state). */
  hasNarration: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [tab, setTab] = useState<DetailTab>('facts')
  const { data: detail, error: err } = useQuery({
    queryKey: qk.poi(poiId),
    queryFn: async () => (await api.poi(poiId)).poi,
    enabled: open,
  })
  // Legibility state, read here rather than only inside the Location tab so an exclusion is visible on
  // EVERY tab. The whole point of this banner: an excluded poi silently stops appearing in drives and
  // roam, and an operator staring at a normal-looking detail sheet had no way to know why.
  const { data: curation } = useQuery({
    queryKey: qk.poiCorrections(poiId),
    queryFn: () => api.poiCorrections(poiId),
    enabled: open,
  })

  // Hard delete — only surfaced for orphans (canDelete). Closes the sheet + refreshes the corpus.
  const deleteMut = useMutation({
    mutationFn: () => api.deletePoi(poiId),
    onSuccess: () => { onOpenChange(false); void qc.invalidateQueries({ queryKey: qk.pois() }) },
  })

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-[720px] max-w-full flex-col gap-0 p-0 sm:max-w-[720px]">
        <SheetHeader className="justify-between px-6 py-4">
          <SheetTitle className="leading-snug">{poiName}</SheetTitle>
          <button
            onClick={() => onOpenChange(false)}
            className="mt-0.5 shrink-0 rounded-lg p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </SheetHeader>

        {curation?.excludedReason && (
          <div className="border-y border-amber-500/30 bg-amber-500/10 px-6 py-2.5">
            <div className="flex items-start gap-2 text-xs">
              <EyeOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
              <div className="leading-relaxed">
                <span className="font-semibold">Excluded — hidden from new drives and roam.</span>{' '}
                <span className="text-muted-foreground">{curation.excludedReason}</span>{' '}
                <span className="text-muted-foreground">
                  Saved drives keep it; audio is untouched. Restore on the Location tab.
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Tab strip */}
        <div className="border-b px-6 py-3">
          <Segmented options={DETAIL_TABS} value={tab} onChange={setTab} />
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {err && <ErrorCallout error={err} className="rounded-lg px-3 py-2" />}

          {tab === 'facts' && (
            detail ? <FactsTab poi={detail} /> : !err && (
              <div className="space-y-4" aria-hidden>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="space-y-1.5">
                      <Skeleton className="h-3 w-20" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                  ))}
                </div>
                <Skeleton className="h-16 w-full rounded-lg" />
                <Skeleton className="h-32 w-full rounded-lg" />
              </div>
            )
          )}

          {tab === 'location' && <Location poiId={poiId} poiLat={detail?.lat} poiLng={detail?.lng} />}

          {tab === 'narration' && <NarrationTab poiId={poiId} hasNarration={hasNarration} />}

          {tab === 'corrections' && <Corrections poiId={poiId} />}
        </div>

        {canDelete && (
          <div className="border-t px-6 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <PendingButton
                variant="ghost"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                pending={deleteMut.isPending}
                onClick={async () => {
                  if (!(await confirm({
                    title: 'Delete POI?',
                    body: `Permanently delete “${poiName}”. This removes the POI record.`,
                    confirmLabel: 'Delete',
                    tone: 'destructive',
                  }))) return
                  deleteMut.mutate()
                }}
                icon={<Trash2 className="h-4 w-4" />}
                idleLabel="Delete POI"
                pendingLabel="Deleting…"
              />
              <span className="text-xs text-muted-foreground">No narration references this POI.</span>
            </div>
            {deleteMut.error && <ErrorCallout error={deleteMut.error} className="mt-2 rounded-lg px-3 py-2 text-xs" />}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
