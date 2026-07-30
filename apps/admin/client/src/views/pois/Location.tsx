import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Locate, MapPin, RefreshCw, Trash2 } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { errMsg } from '@/lib/format'
import { qk } from '@/lib/queryKeys'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ErrorCallout } from '@/components/ui/error-callout'
import { Skeleton } from '@/components/ui/skeleton'
import { AnchorMap } from '@/components/ui/google-map'

// Through-roads — the classes a tour is plausibly driven on. Mirrors MAJOR in
// packages/studio/src/snap-speakable-anchors.ts, which is what WRITES the class; kept as a literal
// here rather than imported because the admin client must not pull in a studio (node-only) module.
const MAJOR_ROAD = /^(motorway|trunk|primary|secondary|tertiary)(_link)?$/
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
  const [exclReason, setExclReason] = useState('')

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
  // Exclude / restore. Same corrections endpoint as the anchor edits (cheap, reversible, no spend),
  // so no confirm dialog — the required reason is the deliberation.
  function exclude() {
    const reason = exclReason.trim()
    if (!reason) return
    saveMut.mutate({ kind: 'exclude', reason }, { onSuccess: () => setExclReason('') })
  }
  function restore() {
    saveMut.mutate({ kind: 'exclude', clear: true })
  }

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
          {data?.speakableRoadClass && (
            // The class the anchor was snapped to. A minor-layer road (residential/unclassified/
            // living_street) is real pavement the drive almost certainly does NOT take, so the stop
            // triggers from a street nobody is on — worth flagging amber rather than hiding.
            <Badge variant={MAJOR_ROAD.test(data.speakableRoadClass) ? 'secondary' : 'warning'}>
              {data.speakableRoadClass.replace(/_/g, ' ')}
              {!MAJOR_ROAD.test(data.speakableRoadClass) && ' — minor road'}
            </Badge>
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

      {/* The GROUP this place belongs to. Read-only: membership is decided in bulk by
          `classify-treatments` (one model call per group), not per-POI in the console — a hand edit here
          would be silently overwritten by the next classification re-baseline. */}
      {data?.cluster && (
        <div className="flex flex-col gap-2 border-t pt-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Grouping</div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{data.cluster.treatment}</Badge>
            <span className="text-xs font-semibold">{data.cluster.title}</span>
            {data.cluster.isSubject && <Badge variant="outline">this place IS the subject</Badge>}
          </div>
          <div className="text-xs leading-relaxed text-muted-foreground">
            {/* A null subject is a real answer, not missing data — plenty of honest groups (a casino
                strip) are not themselves a place, and the old model's mistake was electing a stand-in. */}
            Subject:{' '}
            {data.cluster.subjectName ? (
              <span className="text-foreground">{data.cluster.subjectName}</span>
            ) : (
              <span className="italic">none — no single place names this group</span>
            )}
          </div>
          {data.cluster.others.length > 0 && (
            <div className="text-xs leading-relaxed text-muted-foreground">
              Told together with: {data.cluster.others.map((m) => m.name).join(', ')}
            </div>
          )}
          <div className="text-xs leading-relaxed text-muted-foreground">
            Grouping is recorded but <strong className="text-foreground">not yet acted on</strong> — every
            place still has its own clip until the fused tellings are generated. Change it by re-running
            <span className="font-mono"> classify-treatments</span>, not here.
          </div>
        </div>
      )}

      {/* Eligibility as a STOP — lives beside the anchor because both answer the same operator
          question: will this place trigger properly, and will it be picked at all? */}
      <div className="flex flex-col gap-2 border-t pt-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Eligibility</div>
        {data?.excludedReason ? (
          <>
            <div className="text-xs leading-relaxed">
              <span className="font-semibold text-foreground">Hidden from new drives and from roam.</span>{' '}
              <span className="text-muted-foreground">
                Existing saved drives keep it — a drive's stops are frozen at build, so nobody loses a stop
                they spent a credit on. Audio is untouched, so restoring needs no regeneration.
              </span>
            </div>
            <div className="rounded-md bg-muted px-3 py-2 font-mono text-xs">{data.excludedReason}</div>
            <div>
              <Button variant="outline" size="sm" disabled={saving} onClick={restore}>
                <RefreshCw className="h-3 w-3" /> Restore to the corpus
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="text-xs leading-relaxed text-muted-foreground">
              Eligible. Exclude a place that EXISTS but can't be told as a stop — a numbered highway
              (its coordinate is an arbitrary point on a line you're on for miles), or an administrative
              boundary. Takes effect immediately for new drives and roam; audio is kept.
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-56 flex-1 space-y-1.5">
                <Label htmlFor="loc-excl" className="text-xs">Reason (required)</Label>
                <Input
                  id="loc-excl"
                  value={exclReason}
                  onChange={(e) => setExclReason(e.target.value)}
                  placeholder="linear feature: no meaningful point trigger"
                />
              </div>
              <Button variant="outline" size="sm" disabled={saving || !exclReason.trim()} onClick={exclude}>
                Exclude
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
