import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError, type Proposal, type Region } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { WaypointMap, type MapWaypoint } from '@/components/WaypointMap'
import { PageHeader } from '@/components/PageHeader'

interface EditWaypoint {
  label: string
  rationale?: string
  lat: number | null
  lng: number | null
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export function CreateTourView() {
  const nav = useNavigate()
  const [regions, setRegions] = useState<Region[]>([])
  const [prompt, setPrompt] = useState({
    regionSlug: '',
    regionName: '',
    roughStart: '',
    roughEnd: '',
    loopOrDirection: 'one-way (A → B)',
    vibe: '',
  })
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [proposing, setProposing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // The editable, human-approved draft (seeded from the proposal).
  const [slug, setSlug] = useState('')
  const [headline, setHeadline] = useState('')
  const [summary, setSummary] = useState('')
  const [startName, setStartName] = useState('')
  const [endName, setEndName] = useState('')
  const [waypoints, setWaypoints] = useState<EditWaypoint[]>([])

  useEffect(() => {
    api.regions().then((r) => setRegions(r.regions)).catch(() => {})
  }, [])

  const region = regions.find((r) => r.slug === prompt.regionSlug)
  const setP = (k: keyof typeof prompt) => (e: { target: { value: string } }) =>
    setPrompt((p) => ({ ...p, [k]: e.target.value }))

  async function doPropose() {
    setProposing(true)
    setErr(null)
    try {
      const { proposal } = await api.propose({ ...prompt, regionName: region?.displayName ?? prompt.regionName })
      setProposal(proposal)
      setHeadline(proposal.headline)
      setSummary(proposal.summary)
      setSlug(`${slugify(proposal.headline)}-run`)
      setStartName(proposal.startAnchorName)
      setEndName(proposal.endAnchorName)
      setWaypoints(proposal.waypoints.map((w) => ({ label: w.label, rationale: w.rationale, lat: w.lat, lng: w.lng })))
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e))
    } finally {
      setProposing(false)
    }
  }

  const moveWaypoint = (i: number, lat: number, lng: number) =>
    setWaypoints((ws) => ws.map((w, j) => (j === i ? { ...w, lat, lng } : w)))
  const removeWaypoint = (i: number) => setWaypoints((ws) => ws.filter((_, j) => j !== i))
  const setWaypointLabel = (i: number, label: string) =>
    setWaypoints((ws) => ws.map((w, j) => (j === i ? { ...w, label } : w)))

  const placed = waypoints.filter((w) => w.lat != null && w.lng != null)
  const canCreate =
    !!slug && !!headline && !!startName && !!endName && placed.length >= 2 && placed.length === waypoints.length

  async function doCreate() {
    setCreating(true)
    setErr(null)
    try {
      const first = waypoints[0]!
      const last = waypoints[waypoints.length - 1]!
      const body = {
        slug,
        regionSlug: prompt.regionSlug,
        regionName: region?.displayName ?? prompt.regionName,
        headline,
        summary,
        startAnchor: { name: startName, lat: first.lat, lng: first.lng },
        endAnchor: { name: endName, lat: last.lat, lng: last.lng },
        waypoints: waypoints.map((w) => ({ label: w.label, lat: w.lat, lng: w.lng })),
        authoring: proposal
          ? {
              model: proposal.model,
              prompt: proposal.prompt,
              proposed: proposal.waypoints.map((w) => ({ label: w.label, lat: w.lat, lng: w.lng, rationale: w.rationale })),
            }
          : undefined,
      }
      const { tour } = await api.createTour(body)
      nav(`/tours/${tour.id}`)
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  const mapWaypoints: MapWaypoint[] = waypoints

  return (
    <div className="space-y-5">
      <PageHeader
        title="Create a tour"
        description="The skipper proposes the rails; you approve them on the map; then it freezes into a draft you can generate."
      />

      {/* Phase 1 — prompt */}
      <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
        <Field label="Region">
          <Select value={prompt.regionSlug} onChange={setP('regionSlug')}>
            <option value="">Select a region…</option>
            {regions.map((r) => (
              <option key={r.slug} value={r.slug}>{r.displayName}</option>
            ))}
          </Select>
        </Field>
        <Field label="Shape">
          <Select value={prompt.loopOrDirection} onChange={setP('loopOrDirection')}>
            {['one-way (A → B)', 'loop (return to start)'].map((o) => <option key={o}>{o}</option>)}
          </Select>
        </Field>
        <Field label="Start near"><Input value={prompt.roughStart} onChange={setP('roughStart')} placeholder="South Lake Tahoe" /></Field>
        <Field label="End near"><Input value={prompt.roughEnd} onChange={setP('roughEnd')} placeholder="Tahoe City" /></Field>
        <Field label="Vibe (optional)"><Input value={prompt.vibe} onChange={setP('vibe')} placeholder="scenic west shore, ~45 min" /></Field>
        <div className="flex items-end">
          <Button
            onClick={() => void doPropose()}
            disabled={proposing || !prompt.regionSlug || !prompt.roughStart || !prompt.roughEnd}
          >
            {proposing ? 'Proposing…' : proposal ? 'Re-propose' : 'Propose'}
          </Button>
        </div>
      </div>

      {err && <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{err}</div>}

      {/* Phase 2 — review + approve */}
      {proposal && (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Slug"><Input value={slug} onChange={(e) => setSlug(e.target.value)} /></Field>
              <Field label="Headline"><Input value={headline} onChange={(e) => setHeadline(e.target.value)} /></Field>
              <Field label="Start anchor"><Input value={startName} onChange={(e) => setStartName(e.target.value)} /></Field>
              <Field label="End anchor"><Input value={endName} onChange={(e) => setEndName(e.target.value)} /></Field>
            </div>
            <Field label="Summary"><Textarea value={summary} onChange={(e) => setSummary(e.target.value)} /></Field>

            <div>
              <Label>Waypoints (drag pins on the map to adjust)</Label>
              <ol className="mt-1 space-y-1">
                {waypoints.map((w, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <span className="w-5 text-right font-mono text-xs text-muted-foreground">{i + 1}</span>
                    <Input value={w.label} onChange={(e) => setWaypointLabel(i, e.target.value)} className="h-8" />
                    {w.lat == null && <Badge variant="warning">no coords</Badge>}
                    <Button variant="ghost" size="sm" onClick={() => removeWaypoint(i)}>✕</Button>
                  </li>
                ))}
              </ol>
              {waypoints.some((w) => w.lat == null) && (
                <p className="mt-1 text-xs text-amber-500">Some waypoints didn’t geocode — drop them or place them on the map before creating.</p>
              )}
            </div>

            <Button onClick={() => void doCreate()} disabled={creating || !canCreate}>
              {creating ? 'Creating draft…' : 'Create draft'}
            </Button>
          </div>

          <WaypointMap waypoints={mapWaypoints} onMove={moveWaypoint} />
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  )
}
