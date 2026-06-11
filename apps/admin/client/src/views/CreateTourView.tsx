import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Map, Wand2 } from 'lucide-react'
import { api, ApiError, type Proposal, type Region } from '@/lib/api'
import { WaypointMap, type MapWaypoint } from '@/components/WaypointMap'

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
  const [proposing, setProposing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [createdId, setCreatedId] = useState<string | null>(null)

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
      setStep(2)
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
  const ungeocoded = waypoints.filter((w) => w.lat == null).length
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
      setCreatedId(tour.id)
      setStep(3)
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  const mapWaypoints: MapWaypoint[] = waypoints

  const STEPS: [number, string][] = [[1, 'Prompt'], [2, 'Review & approve'], [3, 'Draft']]

  return (
    <div>
      <div className="pagehead">
        <div>
          <h1 className="pagehead__title">Create a tour</h1>
          <p className="pagehead__desc">The skipper proposes the rails; you approve them on the map; then it freezes into a draft you can generate.</p>
        </div>
      </div>

      <div className="stepper">
        {STEPS.map(([n, label], i) => (
          <div key={n} style={{ display: 'flex', alignItems: 'center' }}>
            {i > 0 && <span className={`step__line${step > i ? ' is-done' : ''}`} />}
            <div className={`step${step === n ? ' is-active' : step > n ? ' is-done' : ''}`}>
              <span className="step__num">
                {step > n ? <Check size={14} /> : n}
              </span>
              <span className="step__label">{label}</span>
            </div>
          </div>
        ))}
      </div>

      {err && (
        <div className="badge badge--bad" style={{ display: 'block', marginBottom: 14, padding: '10px 14px', borderRadius: 'var(--radius)' }}>
          {err}
        </div>
      )}

      {step === 1 && (
        <div className="card" style={{ padding: 20, maxWidth: 720 }}>
          <div className="grid-2">
            <div className="field">
              <label className="field__label">Region</label>
              <div className="selectbox">
                <select value={prompt.regionSlug} onChange={setP('regionSlug')}>
                  <option value="">Select a region…</option>
                  {regions.map((r) => (
                    <option key={r.slug} value={r.slug}>{r.displayName}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <label className="field__label">Shape</label>
              <div className="selectbox">
                <select value={prompt.loopOrDirection} onChange={setP('loopOrDirection')}>
                  {['one-way (A → B)', 'loop (return to start)'].map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <label className="field__label">Start near</label>
              <input value={prompt.roughStart} onChange={setP('roughStart')} placeholder="South Lake Tahoe" />
            </div>
            <div className="field">
              <label className="field__label">End near</label>
              <input value={prompt.roughEnd} onChange={setP('roughEnd')} placeholder="Tahoe City" />
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <div className="field">
              <label className="field__label">Vibe (optional)</label>
              <span className="field__hint">A nudge for tone, length, or what to feature.</span>
              <input value={prompt.vibe} onChange={setP('vibe')} placeholder="scenic west shore, ~45 min" />
            </div>
          </div>
          <hr className="rule" />
          <button
            className="btn btn--primary"
            onClick={() => void doPropose()}
            disabled={proposing || !prompt.regionSlug || !prompt.roughStart || !prompt.roughEnd}
          >
            <Wand2 size={15} />
            {proposing ? 'Skipper is plotting…' : 'Propose route'}
          </button>
        </div>
      )}

      {step === 2 && proposal && (
        <div className="grid-create">
          <div>
            <div className="seclabel">Draft details</div>
            <div className="grid-2">
              <div className="field">
                <label className="field__label">Slug</label>
                <input value={slug} onChange={(e) => setSlug(e.target.value)} className="mono" />
              </div>
              <div className="field">
                <label className="field__label">Headline</label>
                <input value={headline} onChange={(e) => setHeadline(e.target.value)} />
              </div>
              <div className="field">
                <label className="field__label">Start anchor</label>
                <input value={startName} onChange={(e) => setStartName(e.target.value)} />
              </div>
              <div className="field">
                <label className="field__label">End anchor</label>
                <input value={endName} onChange={(e) => setEndName(e.target.value)} />
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <div className="field">
                <label className="field__label">Summary</label>
                <textarea value={summary} onChange={(e) => setSummary(e.target.value)} />
              </div>
            </div>

            <div className="seclabel">
              Waypoints{' '}
              <span className="muted" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
                · drag pins on the map to adjust
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {waypoints.map((w, i) => (
                <div key={i} className="row-flex" style={{ gap: 9 }}>
                  <span className="leader" style={{ width: 24, height: 24, borderRadius: 6, fontSize: 11 }}>{i + 1}</span>
                  <input
                    value={w.label}
                    onChange={(e) => setWaypointLabel(i, e.target.value)}
                    style={{ flex: 1, height: 32, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', font: 'inherit', fontSize: 13, background: 'var(--panel)', color: 'var(--ink)', outline: 'none' }}
                  />
                  {w.lat == null && <span className="badge badge--warn">no coords</span>}
                  <button
                    className="iconbtn"
                    style={{ width: 30, height: 30 }}
                    onClick={() => removeWaypoint(i)}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            {ungeocoded > 0 && (
              <p style={{ fontSize: 12, color: 'var(--warn)', marginTop: 8 }}>
                {ungeocoded} waypoint didn't geocode — place it on the map or drop it before creating.
              </p>
            )}

            <hr className="rule" />
            <div className="row-flex" style={{ gap: 9 }}>
              <button className="btn btn--ghost" onClick={() => setStep(1)}>Back</button>
              <span style={{ flex: 1 }} />
              <button className="btn btn--default" onClick={() => void doPropose()} disabled={proposing}>
                <Wand2 size={13} />
                Re-propose
              </button>
              <button className="btn btn--primary" onClick={() => void doCreate()} disabled={creating || !canCreate}>
                <Check size={13} />
                {creating ? 'Creating draft…' : 'Create draft'}
              </button>
            </div>
          </div>

          <div>
            <div className="seclabel">Route preview</div>
            <WaypointMap waypoints={mapWaypoints} onMove={moveWaypoint} />
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="card" style={{ padding: 40, maxWidth: 560, textAlign: 'center' }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--ok-bg)', color: 'var(--ok)', display: 'grid', placeItems: 'center', margin: '0 auto 16px' }}>
            <Check size={26} />
          </div>
          <h2 style={{ fontSize: 19, fontWeight: 600, margin: 0 }}>Draft created</h2>
          <p className="muted" style={{ fontSize: 13.5, marginTop: 8, lineHeight: 1.5 }}>
            <b style={{ color: 'var(--ink)' }}>{headline}</b> is frozen as a draft with {waypoints.length} waypoints. Generate it to script and synthesize the audio.
          </p>
          <div className="row-flex" style={{ justifyContent: 'center', marginTop: 20, gap: 9 }}>
            <button
              className="btn btn--default"
              onClick={() => { setStep(1); setProposal(null); setSlug(''); setHeadline(''); setSummary(''); setStartName(''); setEndName(''); setWaypoints([]) }}
            >
              Create another
            </button>
            {createdId && (
              <button className="btn btn--primary" onClick={() => nav(`/tours/${createdId}`)}>
                <Map size={14} />
                Open tour
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
