import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Locate, Plus, RefreshCw, Trash2, Wrench } from 'lucide-react'
import { api, ApiError, type CorrectionOverride } from '@/lib/api'
import { errMsg } from '@/lib/format'
import { qk } from '@/lib/queryKeys'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ErrorCallout } from '@/components/ui/error-callout'
import { Skeleton } from '@/components/ui/skeleton'
import { AnchorMap } from '@/components/ui/leaflet-map'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'

// Operator surface for a POI's upstream-fact corrections + speakable anchor. Lazy-loads on
// expand. Corrections take effect on the NEXT generate/regeneration — they don't rewrite audio.
export function Corrections({ poiId, poiLat, poiLng }: { poiId: string; poiLat?: number; poiLng?: number }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [validationErr, setValidationErr] = useState<string | null>(null)

  // Add-correction form
  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')
  const [reason, setReason] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  // Speakable-anchor inputs
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')

  const { data, isLoading: loading, error: loadErr } = useQuery({
    queryKey: qk.poiCorrections(poiId),
    queryFn: () => api.poiCorrections(poiId),
  })
  // A save returns the updated corrections — write it straight into the cache.
  const saveMut = useMutation({
    mutationFn: (input: Parameters<typeof api.saveCorrection>[1]) => api.saveCorrection(poiId, input),
    onSuccess: (updated) => { qc.setQueryData(qk.poiCorrections(poiId), updated); setValidationErr(null) },
  })
  const saving = saveMut.isPending
  const err = validationErr ?? (loadErr ? errMsg(loadErr) : saveMut.error ? errMsg(saveMut.error) : null)

  // The draggable marker must reflect the PENDING edit (the lat/lng inputs), not the saved anchor —
  // otherwise dragging it fires onAnchor (which only fills the inputs) while the controlled marker
  // snaps back to the unchanged saved position. Drag → fills inputs → inputs drive the marker. Empty
  // or non-numeric inputs fall back to the saved speakable anchor, then to the POI pin.
  const latNum = Number(lat), lngNum = Number(lng)
  const pendingAnchor =
    lat.trim() !== '' && lng.trim() !== '' && Number.isFinite(latNum) && Number.isFinite(lngNum)
      ? { lat: latNum, lng: lngNum }
      : null

  // One shared submit path for every correction action. The buttons only disable AFTER the first
  // mutate re-renders, so guard at the top here — a fast double-tap can't double-submit.
  const save = (...args: Parameters<typeof saveMut.mutate>) => {
    if (saving) return
    saveMut.mutate(...args)
  }

  function addCorrection() {
    if (!find.trim() || !reason.trim()) {
      setValidationErr('A find string and a reason are both required.')
      return
    }
    save(
      { kind: 'fact_edit', find, replace, reason: reason.trim(), ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}) },
      { onSuccess: () => { setFind(''); setReplace(''); setReason(''); setSourceUrl('') } },
    )
  }

  function retire(f: string) {
    save({ kind: 'retire', find: f })
  }

  async function setSpeakable() {
    if (saving) return
    const la = Number(lat), ln = Number(lng)
    if (!Number.isFinite(la) || !Number.isFinite(ln) || lat.trim() === '' || lng.trim() === '') {
      setValidationErr('Speakable anchor needs two numeric coordinates.')
      return
    }
    setValidationErr(null)
    try {
      await saveMut.mutateAsync({ kind: 'speakable', lat: la, lng: ln })
      setLat(''); setLng('')
    } catch (e) {
      // The server rejects an anchor that's implausibly far from the pin (likely a typo). Offer to
      // override for the rare genuinely-distant vantage; any other error stays surfaced via `err`.
      if (e instanceof ApiError && e.code === 'speakable_too_far') {
        const ok = await confirm({
          title: 'Anchor looks far from the pin',
          body: `${e.message} Set it anyway?`,
          confirmLabel: 'Set anyway',
        })
        // Declining is a handled choice, not a failure — clear the rejected mutation so the error
        // banner doesn't keep showing the (intentional) "too far" message behind the dismissed dialog.
        if (!ok) {
          saveMut.reset()
          return
        }
        try {
          await saveMut.mutateAsync({ kind: 'speakable', lat: la, lng: ln, force: true })
          setLat(''); setLng('')
        } catch { /* surfaced via saveMut.error → err */ }
      }
    }
  }

  function clearSpeakable() {
    save({ kind: 'speakable', lat: null })
  }

  // Discard the in-progress edit (a drag or typed coords) and revert the marker to the saved anchor
  // (or the POI pin if none) — does NOT touch the saved speakable anchor. "Clear" above removes that.
  function resetAnchor() {
    setLat('')
    setLng('')
    setValidationErr(null)
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4 pt-3" aria-hidden>
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-12 w-full rounded-md" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-14 w-full rounded-md" />
        </div>
        <Skeleton className="h-28 w-full rounded-md" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 pt-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold">
        <Wrench className="h-3.5 w-3.5" /> Corrections
      </div>
      <div className="rounded-md border bg-background px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        Corrections apply on the <strong className="text-foreground">next generate / regeneration</strong> of a
        narration (the studio job loads these overrides + reads the speakable anchor fresh per run). They do{' '}
        <strong className="text-foreground">not</strong> rewrite existing audio.
      </div>

      {err && <ErrorCallout error={err} className="rounded-lg px-3 py-2 text-xs" />}

      {/* Existing fact-edits */}
      <div className="flex flex-col gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Fact edits</div>
        {data && data.overrides.length === 0 && (
          <div className="text-xs text-muted-foreground">No corrections yet.</div>
        )}
        {data?.overrides.map((o: CorrectionOverride, i) => (
          <div
            key={`${o.find ?? '∅'}-${i}`}
            className={cn(
              'flex items-start gap-2 rounded-md border bg-background px-3 py-2',
              !o.active && 'opacity-60',
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="break-words text-xs">
                <code className="font-mono">{o.find ?? '∅'}</code>
                <span className="mx-1.5 text-muted-foreground">→</span>
                <code className="font-mono">{o.replace === '' ? '(deleted)' : o.replace ?? '∅'}</code>
                {!o.active && <Badge variant="secondary" className="ml-2">retired</Badge>}
                {o.upstreamStatus !== 'not_filed' && <Badge variant="outline" className="ml-1.5">{o.upstreamStatus}</Badge>}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{o.reason}</div>
              {o.sourceUrl && (
                <a href={o.sourceUrl} target="_blank" rel="noreferrer" className="break-all text-xs text-primary underline-offset-2 hover:underline">
                  {o.sourceUrl}
                </a>
              )}
            </div>
            {o.active && o.find && (
              <Button variant="ghost" size="sm" disabled={saving} onClick={() => retire(o.find!)} className="shrink-0">
                <Trash2 className="h-3 w-3" /> Retire
              </Button>
            )}
          </div>
        ))}
      </div>

      {/* Add correction */}
      <div className="flex flex-col gap-3 rounded-md border border-dashed px-3 py-3">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Add correction</div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="corr-find" className="text-xs">Find (exact substring)</Label>
            <Input id="corr-find" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Leonard Palme" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="corr-replace" className="text-xs">Replace (blank = delete)</Label>
            <Input id="corr-replace" value={replace} onChange={(e) => setReplace(e.target.value)} placeholder="Lennart Palme" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="corr-reason" className="text-xs">Reason *</Label>
          <Input id="corr-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the source is wrong (required)" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="corr-source" className="text-xs">Source URL (optional)</Label>
          <Input id="corr-source" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://… authoritative source for the fix" />
        </div>
        <div>
          <Button variant="outline" size="sm" disabled={saving} onClick={addCorrection}>
            <Plus className="h-3 w-3" /> {saving ? 'Saving…' : 'Add correction'}
          </Button>
        </div>
      </div>

      {/* Speakable anchor */}
      <div className="flex flex-col gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Speakable anchor</div>
        <div className="text-xs leading-relaxed text-muted-foreground">
          The vantage point side-of-road content speaks from — only needed when the POI's own centroid is misleading.
          Drag the amber marker to set it; the coords fill below, then hit Set anchor.
        </div>
        {poiLat != null && poiLng != null && (
          <AnchorMap
            poi={{ lat: poiLat, lng: poiLng }}
            anchor={pendingAnchor ?? data?.speakable ?? null}
            onAnchor={({ lat: a, lng: o }) => { setLat(a.toFixed(6)); setLng(o.toFixed(6)) }}
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Locate className="h-3.5 w-3.5 text-muted-foreground" />
          {data?.speakable ? (
            <span className="font-mono text-xs">{data.speakable.lat.toFixed(5)}, {data.speakable.lng.toFixed(5)}</span>
          ) : (
            <span className="text-xs text-muted-foreground">not set — speaks from the POI pin</span>
          )}
          {data?.speakable && (
            <Button variant="ghost" size="sm" disabled={saving} onClick={clearSpeakable}>
              <Trash2 className="h-3 w-3" /> Clear
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-32 space-y-1.5">
            <Label htmlFor="corr-lat" className="text-xs">Lat</Label>
            <Input id="corr-lat" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="38.9540" inputMode="decimal" />
          </div>
          <div className="w-32 space-y-1.5">
            <Label htmlFor="corr-lng" className="text-xs">Lng</Label>
            <Input id="corr-lng" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="-120.0950" inputMode="decimal" />
          </div>
          <Button variant="outline" size="sm" disabled={saving} onClick={setSpeakable}>
            {saving ? 'Saving…' : 'Set anchor'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={saving || (lat.trim() === '' && lng.trim() === '')}
            onClick={resetAnchor}
          >
            <RefreshCw className="h-3 w-3" /> Reset
          </Button>
        </div>
      </div>
    </div>
  )
}
