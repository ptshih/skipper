import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { RefreshCw } from 'lucide-react'
import { api, type PoiDetail } from '@/lib/api'
import { errMsg, timeAgo } from '@/lib/format'
import { qk } from '@/lib/queryKeys'
import { Button } from '@/components/ui/button'
import { ErrorCallout } from '@/components/ui/error-callout'

export function FactsTab({ poi }: { poi: PoiDetail }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  // Re-fetch facts = a FREE cloud job (MediaWiki only, no LLM/TTS) — re-pulls the article, then jumps to
  // Runs to watch. If the article moved, the facts hash changes + any narration goes stale (clear it from
  // the Narration tab). This is the per-POI home of what the old Retire tab did; staleness still surfaces
  // as a row flag + the corpus "Needs attention" filter, which points the operator here.
  const refetchMut = useMutation({
    mutationFn: () => api.createJob({ kind: 'refetch_facts', poiId: poi.id, apply: true }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: qk.runs() }); navigate({ to: '/jobs' }) },
  })

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Re-pulls this POI’s facts from Wikipedia — <span className="font-medium text-foreground">free</span> (no AI or
          TTS). If the article moved, the facts hash changes and any narration goes stale; regenerate it from the
          Narration tab to clear that.
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={refetchMut.isPending}
          onClick={() => refetchMut.mutate()}
          className="shrink-0"
        >
          <RefreshCw className="h-3 w-3" /> {refetchMut.isPending ? 'Re-fetching…' : 'Re-fetch facts'}
        </Button>
      </div>
      {refetchMut.error && <ErrorCallout error={`Re-fetch failed — ${errMsg(refetchMut.error)}`} className="rounded-lg px-3 py-2 text-xs" />}

      {/* Metadata grid */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Source</dt>
          <dd className="mt-0.5 font-mono text-xs">{poi.source} / {poi.sourceId}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Kind</dt>
          <dd className="mt-0.5">{poi.kind ?? <span className="text-muted-foreground">—</span>}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Coordinates</dt>
          <dd className="mt-0.5 font-mono text-xs">{poi.lat.toFixed(5)}, {poi.lng.toFixed(5)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Facts hash</dt>
          <dd className="mt-0.5 font-mono text-xs">{poi.factsHash ? poi.factsHash.slice(0, 12) : <span className="text-muted-foreground">—</span>}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Facts fetched</dt>
          <dd className="mt-0.5 text-xs">{poi.factsFetchedAt ? timeAgo(poi.factsFetchedAt) : <span className="text-muted-foreground">never</span>}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Added</dt>
          <dd className="mt-0.5 text-xs">{timeAgo(poi.createdAt)}</dd>
        </div>
      </dl>

      {/* Summary */}
      {poi.summary && (
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Summary</div>
          <p className="text-sm leading-relaxed text-muted-foreground">{poi.summary}</p>
        </div>
      )}

      {/* Facts JSON */}
      <div>
        <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Facts JSON {poi.facts ? <span className="normal-case text-muted-foreground">({Object.keys(poi.facts).length} keys)</span> : null}
        </div>
        {poi.facts ? (
          <pre className="overflow-x-auto rounded-lg border bg-muted/40 px-3 py-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all">
            {JSON.stringify(poi.facts, null, 2)}
          </pre>
        ) : (
          <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">No facts fetched yet.</div>
        )}
      </div>
    </div>
  )
}
