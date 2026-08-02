import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Compass } from 'lucide-react'
import { api } from '@/lib/api'
import { errMsg } from '@/lib/format'
import { qk } from '@/lib/queryKeys'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PendingButton } from '@/components/ui/pending-button'
import { Callout } from '@/components/ui/callout'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type RegionRef = { slug: string; displayName: string }

/* ── DISCOVER POIs (per region; FREE — no LLM/TTS spend) ──
 *
 * Sweeps every Wikidata-pinned place in each region's bbox and upserts the shared POI corpus. Free
 * (no model/TTS), so no confirm gate. Launches one discover_pois run PER region — each lands on the
 * Jobs page. Preview dry-runs the sweep (counts candidates); Discover upserts.
 *
 * Two ways in: pass `regions` for a fixed scope (the Regions page — a row's Discover button or a bulk
 * row-selection), or pass `options` to let the operator pick which region(s) to sweep right here (the
 * POIs page, which has no region row-selection of its own).
 */
export function DiscoverPoisDialog({
  open,
  onOpenChange,
  onSubmitted,
  regions,
  options,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmitted: () => void
  regions?: RegionRef[]
  options?: RegionRef[]
}) {
  const qc = useQueryClient()
  const picker = regions === undefined
  const [picked, setPicked] = useState<Set<string>>(new Set())

  // A fresh open starts the picker empty (the fixed-scope path ignores this).
  useEffect(() => { if (open) { setPicked(new Set()); setOutcomes(null) } }, [open])

  const scope: RegionRef[] = picker ? (options ?? []).filter((r) => picked.has(r.slug)) : (regions ?? [])

  const [outcomes, setOutcomes] = useState<{ slug: string; ok: boolean; message?: string }[] | null>(null)

  // ⚠ allSettled, not all. This fans out one job per region, and Promise.all rejects on the FIRST
  // failure — so onSuccess never ran even though the other regions' jobs had been created and their
  // Cloud Run executions triggered. The runs cache went un-invalidated, the dialog never closed, and a
  // single un-attributed error made the screen read as "nothing happened" while paid work was already
  // under way. Every region now reports its own outcome, and the cache is refreshed either way.
  const submitMut = useMutation({
    mutationFn: async (apply: boolean) => {
      const settled = await Promise.allSettled(
        scope.map((r) => api.createJob({ kind: 'discover_pois', region: r.slug, apply })),
      )
      return settled.map((res, i) => ({
        slug: scope[i]!.slug,
        ok: res.status === 'fulfilled',
        message: res.status === 'rejected' ? errMsg(res.reason) : undefined,
      }))
    },
    onSuccess: (rows) => {
      void qc.invalidateQueries({ queryKey: qk.runs() })
      const failed = rows.filter((r) => !r.ok)
      if (failed.length === 0) {
        onSubmitted()
        return
      }
      // Some queued, some didn't — stay put and show which, rather than navigating away from the news.
      setOutcomes(rows)
    },
  })

  function toggle(slug: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!submitMut.isPending) onOpenChange(o) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Compass className="h-4 w-4" /> Discover POIs</DialogTitle>
          <DialogDescription>
            Discovers every Wikidata-pinned place in each region's bbox and upserts the shared POI corpus —
            drives select their stops from it. Free — no LLM or TTS spend.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {picker ? (
            (options ?? []).length === 0 ? (
              <Callout variant="info" className="rounded-lg px-3 py-2">
                No regions yet — add one on the Regions page first.
              </Callout>
            ) : (
              <div className="space-y-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm">
                <div className="font-medium text-foreground">Pick region(s) to discover</div>
                <div className="space-y-1.5">
                  {(options ?? []).map((r) => (
                    <label key={r.slug} className="flex cursor-pointer items-center gap-2">
                      <Checkbox
                        checked={picked.has(r.slug)}
                        onCheckedChange={() => toggle(r.slug)}
                        aria-label={`Select ${r.displayName}`}
                      />
                      <span>{r.displayName}</span>
                    </label>
                  ))}
                </div>
              </div>
            )
          ) : (
            <div className="space-y-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm">
              <div className="font-medium text-foreground">
                Discovering {scope.length} region{scope.length === 1 ? '' : 's'}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {scope.map((r) => (
                  <Badge key={r.slug} variant="secondary" className="font-normal">{r.displayName}</Badge>
                ))}
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Free — no spend, no deletion. <span className="font-medium text-foreground">Preview</span> dry-runs the
            sweep (counts candidates); <span className="font-medium text-foreground">Discover</span> upserts the corpus.
            One job per region lands on the Jobs page.
          </p>
        </div>

        {outcomes && (
          <Callout variant="error" className="rounded-lg px-3 py-2 text-sm">
            <div className="font-medium">
              {outcomes.filter((o) => o.ok).length} of {outcomes.length} regions queued — the rest did not start.
            </div>
            <ul className="mt-1 space-y-0.5 text-xs">
              {outcomes.map((o) => (
                <li key={o.slug}>
                  <span className="font-mono">{o.slug}</span> — {o.ok ? 'queued' : (o.message ?? 'failed')}
                </li>
              ))}
            </ul>
          </Callout>
        )}
        {submitMut.error && (
          <Callout variant="error" className="rounded-lg px-3 py-2">{errMsg(submitMut.error)}</Callout>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitMut.isPending}>Cancel</Button>
          <Button variant="outline" onClick={() => submitMut.mutate(false)} disabled={submitMut.isPending || scope.length === 0}>
            Preview
          </Button>
          <PendingButton
            onClick={() => submitMut.mutate(true)}
            pending={submitMut.isPending}
            disabled={scope.length === 0}
            icon={<Compass className="h-4 w-4" />}
            idleLabel="Discover"
            pendingLabel="Queuing…"
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
