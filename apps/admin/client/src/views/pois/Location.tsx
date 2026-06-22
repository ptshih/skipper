import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Locate, MapPin, RefreshCw, Trash2 } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { errMsg } from '@/lib/format'
import { qk } from '@/lib/queryKeys'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ErrorCallout } from '@/components/ui/error-callout'
import { Skeleton } from '@/components/ui/skeleton'
import { AnchorMap } from '@/components/ui/google-map'
import { useConfirm } from '@/components/ui/confirm-dialog'

// The POI's LOCATION surface: its pin + an optional SPEAKABLE ANCHOR (the vantage side-of-road content
// speaks from, when the POI's own centroid is misleading). Anchor edits take effect on the NEXT
// generate/regeneration — they don't rewrite existing audio. Reads/writes the same poi-corrections
// endpoint as the Corrections tab (the anchor rides in the corrections payload).
export function Location({ poiId, poiLat, poiLng }: { poiId: string; poiLat?: number; poiLng?: number }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [validationErr, setValidationErr] = useState<string | null>(null)
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')

  const { data, isLoading: loading, error: loadErr } = useQuery({
    queryKey: qk.poiCorrections(poiId),
    queryFn: () => api.poiCorrections(poiId),
  })
  const saveMut = useMutation({
    mutationFn: (input: Parameters<typeof api.saveCorrection>[1]) => api.saveCorrection(poiId, input),
    onSuccess: (updated) => { qc.setQueryData(qk.poiCorrections(poiId), updated); setValidationErr(null) },
  })
  const saving = saveMut.isPending
  const err = validationErr ?? (loadErr ? errMsg(loadErr) : saveMut.error ? errMsg(saveMut.error) : null)

  // The draggable marker must reflect the PENDING edit (the lat/lng inputs), not the saved anchor —
  // otherwise dragging fires onAnchor (which only fills the inputs) while the controlled marker snaps
  // back. Drag → fills inputs → inputs drive the marker. Empty/non-numeric inputs fall back to the saved
  // speakable anchor, then to the POI pin.
  const latNum = Number(lat), lngNum = Number(lng)
  const pendingAnchor =
    lat.trim() !== '' && lng.trim() !== '' && Number.isFinite(latNum) && Number.isFinite(lngNum)
      ? { lat: latNum, lng: lngNum }
      : null

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
      // The server rejects an anchor implausibly far from the pin (likely a typo). Offer to override for
      // the rare genuinely-distant vantage; any other error stays surfaced via `err`.
      if (e instanceof ApiError && e.code === 'speakable_too_far') {
        const ok = await confirm({
          title: 'Anchor looks far from the pin',
          body: `${e.message} Set it anyway?`,
          confirmLabel: 'Set anyway',
        })
        // Declining is a handled choice, not a failure — clear the rejected mutation so the error banner
        // doesn't keep showing the (intentional) "too far" message behind the dismissed dialog.
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
    if (saving) return
    saveMut.mutate({ kind: 'speakable', lat: null })
  }

  // Discard the in-progress edit (a drag or typed coords) and revert the marker to the saved anchor (or
  // the POI pin if none) — does NOT touch the saved speakable anchor. "Clear" above removes that.
  function resetAnchor() {
    setLat('')
    setLng('')
    setValidationErr(null)
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4 pt-3" aria-hidden>
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-44 w-full rounded-lg" />
        <Skeleton className="h-10 w-full rounded-md" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 pt-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold">
        <MapPin className="h-3.5 w-3.5" /> Location
      </div>

      {err && <ErrorCallout error={err} className="rounded-lg px-3 py-2 text-xs" />}

      {/* Speakable anchor */}
      <div className="flex flex-col gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Speakable anchor</div>
        <div className="text-xs leading-relaxed text-muted-foreground">
          The vantage point side-of-road content speaks from — only needed when the POI's own centroid is misleading.
          Drag the amber marker to set it; the coords fill below, then hit Set anchor. Takes effect on the{' '}
          <strong className="text-foreground">next generate / regeneration</strong>; it doesn't rewrite existing audio.
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
            <Label htmlFor="loc-lat" className="text-xs">Lat</Label>
            <Input id="loc-lat" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="38.9540" inputMode="decimal" />
          </div>
          <div className="w-32 space-y-1.5">
            <Label htmlFor="loc-lng" className="text-xs">Lng</Label>
            <Input id="loc-lng" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="-120.0950" inputMode="decimal" />
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
