import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { pendingListeningItems } from '@/lib/listening-readiness'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/PageHeader'
import type { PublicationSnapshot } from '../../../server/publication'

type Item = { id: string; narrationId: string; queue: string; verdict: string; notes: string; advisoryReason: string;
  technical: { ok: boolean; advisory?: boolean; message: string } | null }
type Review = { review: { id: string; approvedAt: string | null; narrationId: string | null }; items: Item[];
  snapshot: PublicationSnapshot; stale: boolean; blockers: string[]; totalListeningMs: number }
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/admin/${path}`, { method, headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.message ?? data.error ?? 'Request failed')
  return data as T
}
const minutes = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`

export function ListeningView() {
  const params = new URLSearchParams(location.search)
  const [region, setRegion] = useState(params.get('region') ?? 'yosemite-national-park')
  const [reviewId, setReviewId] = useState(params.get('review') ?? '')
  const [index, setIndex] = useState(0)
  const [audio, setAudio] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [driveId, setDriveId] = useState('')
  const [corridor, setCorridor] = useState('')
  const [evidenceNotes, setEvidenceNotes] = useState('')
  const qc = useQueryClient()
  const regions = useQuery({ queryKey: ['listening-regions'], queryFn: api.regions })
  const readiness = useQuery({ queryKey: ['listening-readiness', region], queryFn: () => request<{
    snapshot: PublicationSnapshot; blockers: string[]; requiredCorridors: string[];
  }>(`regions/${region}/readiness`) })
  const sessions = useQuery({ queryKey: ['listening-sessions', region], queryFn: () => request<{
    reviews: { id: string; createdAt: string; approvedAt: string | null }[];
  }>(`regions/${region}/listening-reviews`) })
  const review = useQuery({ queryKey: ['listening-review', reviewId], enabled: !!reviewId,
    queryFn: () => request<Review>(`listening-reviews/${reviewId}`) })
  const data = review.data
  const items = [...(data?.items ?? [])].sort((a, b) => {
    const order: Record<string, number> = { reel: 0, flagged: 1, additional: 2 }
    return (order[a.queue] ?? 2) - (order[b.queue] ?? 2) || a.narrationId.localeCompare(b.narrationId)
  })
  const pending = pendingListeningItems(items, data?.snapshot.clips ?? [])
  const item = items[index]
  const clip = data?.snapshot.clips.find(c => c.narration.id === item?.narrationId)
  const open = (id: string) => {
    setReviewId(id); setIndex(0); setAudio('')
    history.replaceState(null, '', `/listening?region=${encodeURIComponent(region)}&review=${id}`)
  }
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await fn(); await qc.invalidateQueries({ predicate: q => String(q.queryKey[0]).startsWith('listening-') }) }
    catch (e) { setError(e instanceof Error ? e.message : 'Request failed') }
    finally { setBusy(false) }
  }
  const create = (narrationId?: string) => act(async () => {
    const result = await request<{ id: string }>(`regions/${region}/listening-reviews`, 'POST', { narrationId })
    open(result.id)
  })
  const snapshot = data?.snapshot ?? readiness.data?.snapshot
  return <div className="space-y-6">
    <PageHeader title="Listening Review" description="Review staged audio, save your judgment, then explicitly approve the exact release set. No model or TTS calls." />
    <div className="flex flex-wrap gap-3">
      <select aria-label="Region" className="rounded border bg-background p-2" value={region} onChange={e => {
        setRegion(e.target.value); setReviewId(''); setAudio(''); setIndex(0)
        history.replaceState(null, '', `/listening?region=${encodeURIComponent(e.target.value)}`)
      }}>{regions.data?.regions.map(r => <option key={r.slug} value={r.slug}>{r.displayName}</option>)}</select>
      <Button disabled={busy} onClick={() => void create()}>Create release review</Button>
      {params.get('narration') && <Button disabled={busy} onClick={() => void create(params.get('narration')!)}>Review selected clip in this region</Button>}
      <select aria-label="Resume review" className="rounded border bg-background p-2" value={reviewId} onChange={e => open(e.target.value)}>
        <option value="">Resume saved review…</option>
        {sessions.data?.reviews.map(r => <option key={r.id} value={r.id}>{new Date(r.createdAt).toLocaleString()} {r.approvedAt ? '— approved' : ''}</option>)}
      </select>
    </div>
    {(error || readiness.error || review.error) && <p role="alert" className="text-destructive">{error || readiness.error?.message || review.error?.message}</p>}
    {snapshot && <section className="space-y-2 rounded border p-4">
      <p>{snapshot.clips.length} staged clips · {snapshot.clips.filter(c => c.narration.cluster_id).length} combined stories · {snapshot.endpoints.length} endpoints</p>
      <p>Structural readiness and listening approval are separate. Counts alone do not prove a good drive.</p>
      {(data?.blockers ?? readiness.data?.blockers ?? []).map(b => <p key={b} className="text-destructive">{b}</p>)}
      {data?.stale && <p role="alert" className="font-semibold text-destructive">This review is stale. Create a replacement; unchanged clip verdicts carry forward.</p>}
      {data && <p>Required listening: {minutes(data.totalListeningMs)} · {items.filter(i => i.queue === 'reel').length} full reel clips · {items.filter(i => i.queue === 'flagged').length} additional flagged clips</p>}
      {data && pending > 0 && <p>{pending} clips still need listening verdicts, advisory reasons, or technical checks before approval.</p>}
    </section>}
    {data && <div className="flex flex-wrap gap-3">
      <Button disabled={busy || data.stale} onClick={() => void act(async () => {
        for (const i of items) await request(`listening-reviews/${reviewId}/technical/${i.id}`, 'POST')
      })}>Check all audio (free)</Button>
      <Button disabled={busy || data.stale || data.blockers.length > 0 || pending > 0 || items.length === 0} onClick={() => void act(() => request(`listening-reviews/${reviewId}/approve`, 'POST'))}>Approve release review</Button>
      <Button disabled={busy || data.stale || !data.review.approvedAt} onClick={() => void act(async () => {
        if (!window.confirm(`Publish exactly these ${data.snapshot.clips.length} approved clips permanently?`)) return
        await request(`listening-reviews/${reviewId}/release`, 'POST')
      })}>Publish approved set</Button>
      {data.review.approvedAt && <p>Explicitly approved {new Date(data.review.approvedAt).toLocaleString()}</p>}
    </div>}
    {item && clip && <section className="space-y-4 rounded border p-4">
      <div className="flex items-center gap-3">
        <Button disabled={index === 0} onClick={() => { setIndex(index - 1); setAudio('') }}>Previous</Button>
        <span>{index + 1} / {items.length} · {item.queue}</span>
        <Button disabled={index >= items.length - 1} onClick={() => { setIndex(index + 1); setAudio('') }}>Next</Button>
      </div>
      <h2 className="text-lg font-semibold">{clip.cluster?.title ?? clip.members[0]?.name} · {minutes(clip.narration.audio_duration_ms)}</h2>
      <Button disabled={busy} onClick={() => void act(async () => {
        const r = await request<{ url: string }>(`listening-reviews/${reviewId}/audio/${item.narrationId}`); setAudio(r.url)
      })}>Load private audio</Button>
      {audio && <audio key={audio} controls src={audio} className="w-full" />}
      <p>{item.technical?.message ?? 'Technical audio check pending'}</p>
      <p className="whitespace-pre-wrap">{clip.narration.script}</p>
      <details><summary>Source attribution and automated findings</summary><pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify({ attribution: clip.narration.attribution, findings: clip.findings }, null, 2)}</pre></details>
      <div className="flex flex-wrap gap-3">{clip.members.map(p => <a className="underline" key={p.id} href={`/pois?poi=${p.id}`}>{p.name} ({p.lat.toFixed(4)}, {p.lng.toFixed(4)}) · corrections</a>)}</div>
      <VerdictForm key={`${reviewId}:${item.id}:${item.verdict}:${item.notes}:${item.advisoryReason}`} item={item} busy={busy} save={body => act(() => request(`listening-reviews/${reviewId}/items/${item.id}`, 'PATCH', body))} />
    </section>}
    {snapshot && <details className="rounded border p-4"><summary>Exact staged publication set ({snapshot.clips.length})</summary>
      <ul className="space-y-2">{snapshot.clips.map(c => <li key={c.narration.id}>
        {c.cluster?.title ?? c.members[0]?.name} · {c.narration.cluster_id ? 'combined' : 'individual'} · {minutes(c.narration.audio_duration_ms)}
        <Button variant="ghost" disabled={busy} onClick={() => void create(c.narration.id)}>Review only this clip</Button>
      </li>)}</ul>
    </details>}
    <section className="space-y-3 rounded border p-4">
      <h2 className="font-semibold">Corridor evidence</h2>
      <p>Replay a saved drive you own. Record current access sources, routing restrictions, investigated quiet windows, and intentional silence. This replay uses saved geometry and makes no route-provider calls.</p>
      <select aria-label="Corridor" className="rounded border bg-background p-2" value={corridor} onChange={e => setCorridor(e.target.value)}>
        <option value="">Choose corridor…</option>{readiness.data?.requiredCorridors.map(c => <option key={c}>{c}</option>)}
      </select>
      <input aria-label="Saved QA drive ID" className="w-full rounded border bg-background p-2" value={driveId} onChange={e => setDriveId(e.target.value)} placeholder="Saved operator drive ID" />
      <textarea aria-label="Corridor evidence notes" className="w-full rounded border bg-background p-2" value={evidenceNotes} onChange={e => setEvidenceNotes(e.target.value)} placeholder="Access sources and quiet-window investigation" />
      <Button disabled={busy || !corridor || !driveId || !evidenceNotes.trim()} onClick={() => void act(() => request(`regions/${region}/listening-evidence`, 'POST', { driveId, corridor, notes: evidenceNotes, mph: 30 }))}>Save 30 mph replay evidence</Button>
      {readiness.data?.snapshot.evidence.map((e, i) => <details key={i}><summary>{e.corridor}</summary><p>{e.notes}</p><pre className="overflow-auto text-xs">{JSON.stringify(e.report, null, 2)}</pre></details>)}
    </section>
  </div>
}

function VerdictForm({ item, busy, save }: { item: Item; busy: boolean; save: (body: unknown) => Promise<void> }) {
  const [verdict, setVerdict] = useState(item.verdict)
  const [notes, setNotes] = useState(item.notes)
  const [advisoryReason, setReason] = useState(item.advisoryReason)
  return <form className="space-y-3" onSubmit={e => { e.preventDefault(); void save({ verdict, notes, advisoryReason }) }}>
    <select aria-label="Verdict" className="rounded border bg-background p-2" value={verdict} onChange={e => setVerdict(e.target.value)}>
      <option value="unreviewed">Unreviewed</option><option value="good">Good</option><option value="needs_work">Needs work</option>
    </select>
    <textarea aria-label="Review notes" className="w-full rounded border bg-background p-2" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Listening notes" />
    <textarea aria-label="Advisory acceptance reason" className="w-full rounded border bg-background p-2" value={advisoryReason} onChange={e => setReason(e.target.value)} placeholder="Reason for accepting advisory findings (hard failures cannot be waived)" />
    <Button type="submit" disabled={busy}>Save verdict and notes</Button>
  </form>
}
