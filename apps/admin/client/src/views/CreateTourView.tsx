import { useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Map, Wand2, X } from 'lucide-react'
import { api, type Proposal } from '@/lib/api'
import { errMsg } from '@/lib/format'
import { WaypointMap, type MapWaypoint } from '@/components/WaypointMap'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Callout } from '@/components/ui/callout'
import { SectionLabel } from '@/components/ui/section-label'
import { cn } from '@/lib/utils'

interface EditWaypoint {
  label: string
  rationale?: string
  lat: number | null
  lng: number | null
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {children}
    </div>
  )
}

export function CreateTourView() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [prompt, setPrompt] = useState({
    regionSlug: '',
    regionName: '',
    roughStart: '',
    roughEnd: '',
    loopOrDirection: 'one-way (A → B)',
    vibe: '',
  })
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [createdId, setCreatedId] = useState<string | null>(null)

  const [slug, setSlug] = useState('')
  const [headline, setHeadline] = useState('')
  const [summary, setSummary] = useState('')
  const [startName, setStartName] = useState('')
  const [endName, setEndName] = useState('')
  const [waypoints, setWaypoints] = useState<EditWaypoint[]>([])

  const { data: regions = [] } = useQuery({ queryKey: ['regions'], queryFn: async () => (await api.regions()).regions })

  const region = regions.find((r) => r.slug === prompt.regionSlug)
  const setP = (k: keyof typeof prompt) => (e: { target: { value: string } }) =>
    setPrompt((p) => ({ ...p, [k]: e.target.value }))

  // The skipper proposes a route; on success we seed the editable draft fields + advance the stepper.
  const proposeMut = useMutation({
    mutationFn: () => api.propose({ ...prompt, regionName: region?.displayName ?? prompt.regionName }),
    onSuccess: ({ proposal }) => {
      setProposal(proposal)
      setHeadline(proposal.headline)
      setSummary(proposal.summary)
      setSlug(`${slugify(proposal.headline)}-run`)
      setStartName(proposal.startAnchorName)
      setEndName(proposal.endAnchorName)
      setWaypoints(proposal.waypoints.map((w) => ({ label: w.label, rationale: w.rationale, lat: w.lat, lng: w.lng })))
      setStep(2)
    },
  })

  const moveWaypoint = (i: number, lat: number, lng: number) =>
    setWaypoints((ws) => ws.map((w, j) => (j === i ? { ...w, lat, lng } : w)))
  const removeWaypoint = (i: number) => setWaypoints((ws) => ws.filter((_, j) => j !== i))
  const setWaypointLabel = (i: number, label: string) =>
    setWaypoints((ws) => ws.map((w, j) => (j === i ? { ...w, label } : w)))

  const placed = waypoints.filter((w) => w.lat != null && w.lng != null)
  const ungeocoded = waypoints.filter((w) => w.lat == null).length
  const canCreate =
    !!slug && !!headline && !!startName && !!endName && placed.length >= 2 && placed.length === waypoints.length

  const createMut = useMutation({
    mutationFn: () => {
      const first = waypoints[0]!
      const last = waypoints[waypoints.length - 1]!
      return api.createTour({
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
      })
    },
    onSuccess: ({ tour }) => {
      setCreatedId(tour.id)
      setStep(3)
      qc.invalidateQueries({ queryKey: ['tours'] })
    },
  })

  const err = proposeMut.error ?? createMut.error

  const mapWaypoints: MapWaypoint[] = waypoints

  const STEPS: [number, string][] = [[1, 'Prompt'], [2, 'Review & approve'], [3, 'Draft']]

  return (
    <div>
      <PageHeader
        title="Create a tour"
        description="The skipper proposes the rails; you approve them on the map; then it freezes into a draft you can generate."
      />

      <div className="mb-6 flex items-center">
        {STEPS.map(([n, label], i) => (
          <div key={n} className="flex items-center">
            {i > 0 && <span className={cn('mx-3.5 h-px w-12', step > i ? 'bg-emerald-500' : 'bg-border')} />}
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  'grid h-7 w-7 place-items-center rounded-full border font-mono text-xs font-semibold',
                  step === n
                    ? 'border-primary bg-primary text-primary-foreground'
                    : step > n
                      ? 'border-emerald-500 bg-emerald-500 text-white'
                      : 'border-border bg-card text-muted-foreground',
                )}
              >
                {step > n ? <Check size={14} /> : n}
              </span>
              <span className={cn('text-sm font-medium', step >= n ? 'text-foreground' : 'text-muted-foreground')}>
                {label}
              </span>
            </div>
          </div>
        ))}
      </div>

      {err && <Callout variant="error" className="mb-6">{errMsg(err)}</Callout>}

      {step === 1 && (
        <Card className="max-w-3xl p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Region">
              <Select
                value={prompt.regionSlug || undefined}
                onValueChange={(v) => setPrompt((p) => ({ ...p, regionSlug: v }))}
              >
                <SelectTrigger className="w-full"><SelectValue placeholder="Select a region…" /></SelectTrigger>
                <SelectContent>
                  {regions.map((r) => (
                    <SelectItem key={r.slug} value={r.slug}>{r.displayName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Shape">
              <Select
                value={prompt.loopOrDirection}
                onValueChange={(v) => setPrompt((p) => ({ ...p, loopOrDirection: v }))}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['one-way (A → B)', 'loop (return to start)'].map((o) => (
                    <SelectItem key={o} value={o}>{o}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Start near">
              <Input value={prompt.roughStart} onChange={setP('roughStart')} placeholder="South Lake Tahoe" />
            </Field>
            <Field label="End near">
              <Input value={prompt.roughEnd} onChange={setP('roughEnd')} placeholder="Tahoe City" />
            </Field>
          </div>
          <div className="mt-4">
            <Field label="Vibe (optional)" hint="A nudge for tone, length, or what to feature.">
              <Input value={prompt.vibe} onChange={setP('vibe')} placeholder="scenic west shore, ~45 min" />
            </Field>
          </div>
          <hr className="my-5 border-border" />
          <Button
            onClick={() => proposeMut.mutate()}
            disabled={proposeMut.isPending || !prompt.regionSlug || !prompt.roughStart || !prompt.roughEnd}
          >
            <Wand2 size={15} />
            {proposeMut.isPending ? 'Skipper is plotting…' : 'Propose route'}
          </Button>
        </Card>
      )}

      {step === 2 && proposal && (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <div>
            <SectionLabel className="mb-2.5">Draft details</SectionLabel>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Slug">
                <Input value={slug} onChange={(e) => setSlug(e.target.value)} className="font-mono" />
              </Field>
              <Field label="Headline">
                <Input value={headline} onChange={(e) => setHeadline(e.target.value)} />
              </Field>
              <Field label="Start anchor">
                <Input value={startName} onChange={(e) => setStartName(e.target.value)} />
              </Field>
              <Field label="End anchor">
                <Input value={endName} onChange={(e) => setEndName(e.target.value)} />
              </Field>
            </div>
            <div className="mt-4">
              <Field label="Summary">
                <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} />
              </Field>
            </div>

            <SectionLabel className="mb-2.5 mt-6">
              Waypoints{' '}
              <span className="font-normal normal-case tracking-normal text-muted-foreground">
                · drag pins on the map to adjust
              </span>
            </SectionLabel>
            <div className="flex flex-col gap-1.5">
              {waypoints.map((w, i) => (
                <div key={i} className="flex items-center gap-2.5">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md border bg-muted font-mono text-[11px] text-muted-foreground">
                    {i + 1}
                  </span>
                  <Input value={w.label} onChange={(e) => setWaypointLabel(i, e.target.value)} className="h-8 flex-1" />
                  {w.lat == null && <Badge variant="warning">no coords</Badge>}
                  <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeWaypoint(i)}>
                    <X size={14} />
                  </Button>
                </div>
              ))}
            </div>
            {ungeocoded > 0 && (
              <p className="mt-2 text-xs text-warning">
                {ungeocoded} waypoint didn't geocode — place it on the map or drop it before creating.
              </p>
            )}

            <hr className="my-5 border-border" />
            <div className="flex items-center gap-2.5">
              <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
              <span className="flex-1" />
              <Button variant="outline" onClick={() => proposeMut.mutate()} disabled={proposeMut.isPending}>
                <Wand2 size={13} /> Re-propose
              </Button>
              <Button onClick={() => createMut.mutate()} disabled={createMut.isPending || !canCreate}>
                <Check size={13} /> {createMut.isPending ? 'Creating draft…' : 'Create draft'}
              </Button>
            </div>
          </div>

          <div>
            <SectionLabel className="mb-2.5">Route preview</SectionLabel>
            <WaypointMap waypoints={mapWaypoints} onMove={moveWaypoint} />
          </div>
        </div>
      )}

      {step === 3 && (
        <Card className="mx-auto max-w-xl p-10 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-success/15 text-success">
            <Check size={26} />
          </div>
          <h2 className="text-lg font-semibold">Draft created</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">{headline}</span> is frozen as a draft with {waypoints.length} waypoints. Generate it to script and synthesize the audio.
          </p>
          <div className="mt-5 flex justify-center gap-2.5">
            <Button
              variant="outline"
              onClick={() => { setStep(1); setProposal(null); setSlug(''); setHeadline(''); setSummary(''); setStartName(''); setEndName(''); setWaypoints([]) }}
            >
              Create another
            </Button>
            {createdId && (
              <Button onClick={() => nav({ to: '/tours/$id', params: { id: createdId! } })}>
                <Map size={14} /> Open tour
              </Button>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}
