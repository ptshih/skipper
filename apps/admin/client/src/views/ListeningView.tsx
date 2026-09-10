import type { ReleaseAssessmentResult } from '@skipper/shared'
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { pendingListeningItems } from '@/lib/listening-readiness'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/PageHeader'
import type { PublicationSnapshot } from '../../../server/publication'

type Item = { reviewer: string | null; assessment: { status: string; result: ReleaseAssessmentResult | null; error: string | null } | null; id: string; narrationId: string; queue: string; verdict: string; notes: string; advisoryReason: string;
  technical: { ok: boolean; advisory?: boolean; message: string } | null }
type Review = { assessmentJob?: { id: string; status: string; phase: string | null; error: string | null }; review: { id: string; approvedAt: string | null; narrationId: string | null }; items: Item[];
  snapshot: PublicationSnapshot; stale: boolean; blockers: string[]; totalListeningMs: number }
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/admin/${path}`, { method, headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.message ?? data.error ?? 'Request failed')
  return data as T
}
const scoreColumns = [['sourceSupport', 'Source support'], ['roadContext', 'Road context'], ['writing', 'Writing'], ['delivery', 'Delivery'], ['audioFidelity', 'Audio fidelity']] as const
const minutes = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`

export function ListeningView() {
  const params = new URLSearchParams(location.search)
  const [region, setRegion] = useState(params.get('region') ?? 'yosemite-national-park')
  const [reviewId, setReviewId] = useState(params.get('review') ?? '')
  const [selectedId, setSelectedId] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [audio, setAudio] = useState<{ id: string; url: string } | null>(null)
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
    queryFn: () => request<Review>(`listening-reviews/${reviewId}`),
    refetchInterval: q => ['queued', 'running'].includes(q.state.data?.assessmentJob?.status ?? '') ? 5000 : false })
  const data = review.data
  const allItems = [...(data?.items ?? [])]
  const items = allItems.filter(i => showAll || pendingListeningItems([i], data?.snapshot.clips ?? []) > 0).sort((a, b) => {
    const order: Record<string, number> = { reel: 0, flagged: 1, additional: 2 }
    return (order[a.queue] ?? 2) - (order[b.queue] ?? 2) || a.narrationId.localeCompare(b.narrationId)
  })
  const pending = pendingListeningItems(allItems, data?.snapshot.clips ?? [])
  const item = allItems.find(i => i.id === selectedId) ?? items[0]
  const index = items.findIndex(i => i.id === item?.id)
  const setIndex = (n: number) => { setSelectedId(items[n]?.id ?? ''); setAudio(null) }
  useEffect(() => {
    if (item && !selectedId) setSelectedId(item.id)
  }, [item, selectedId])
  useEffect(() => { setAudio(null) }, [item?.id])
  const clip = data?.snapshot.clips.find(c => c.narration.id === item?.narrationId)
  const open = (id: string) => {
    setReviewId(id); setSelectedId(''); setAudio(null)
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
    <PageHeader title="Listening Review" description="Audio and scripts are scored automatically. Clear passes are accepted; only exceptions need your attention. Creating or retrying a review runs a paid assessment with a $25 cap; unchanged results are reused." />
    <div className="flex flex-wrap gap-3">
      <select aria-label="Region" className="rounded border bg-background p-2" value={region} onChange={e => {
        setRegion(e.target.value); setReviewId(''); setAudio(null); setSelectedId('')
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
      {data && <p>{allItems.length - pending} accepted · {pending} needing attention · {minutes(data.totalListeningMs)} unresolved audio</p>}
      {data && pending > 0 && <p>{pending} clips await assessment or resolution before approval.</p>}
    </section>}
    {data && <div className="flex flex-wrap gap-3">
      <p>{data.assessmentJob ? data.assessmentJob.status === 'succeeded' ? 'Assessment complete' : `Assessment ${data.assessmentJob.status}: ${data.assessmentJob.phase ?? ''}` : 'No automated assessment yet'}</p>
      {data.assessmentJob?.error && <p role="alert">{data.assessmentJob.error}</p>}
      <Button disabled={busy || data.stale || ['queued', 'running'].includes(data.assessmentJob?.status ?? '')} onClick={() => void act(() => request(`listening-reviews/${reviewId}/assess`, 'POST'))}>Assess remaining clips</Button>
      <Button variant="outline" onClick={() => { setShowAll(!showAll); setIndex(0); setAudio(null) }}>{showAll ? 'Show only exceptions' : 'Browse all clips'}</Button>
      <Button disabled={busy || data.stale} onClick={() => void act(async () => {
        for (const i of allItems) await request(`listening-reviews/${reviewId}/technical/${i.id}`, 'POST')
      })}>Check all audio (free)</Button>
      <Button disabled={busy || data.stale || data.blockers.length > 0 || pending > 0 || allItems.length === 0} onClick={() => void act(() => request(`listening-reviews/${reviewId}/approve`, 'POST'))}>Approve release review</Button>
      <Button disabled={busy || data.stale || !data.review.approvedAt} onClick={() => void act(async () => {
        if (!window.confirm(`Publish exactly these ${data.snapshot.clips.length} approved clips permanently?`)) return
        await request(`listening-reviews/${reviewId}/release`, 'POST')
      })}>Publish approved set</Button>
      {data.review.approvedAt && <p>Explicitly approved {new Date(data.review.approvedAt).toLocaleString()}</p>}
    </div>}
    {data && <div className="overflow-auto"><table className="w-full text-sm"><thead><tr><th className="text-left">Clip</th><th>Status</th>{scoreColumns.map(([key, label]) => <th key={key}>{label} / 10</th>)}</tr></thead><tbody>
      {items.map((i, n) => { const c = data.snapshot.clips.find(c => c.narration.id === i.narrationId); const result = i.assessment?.result
        return <tr key={i.id}><td><button className="p-2 text-left underline" onClick={() => { setIndex(n); setAudio(null) }}>{c?.cluster?.title ?? c?.members[0]?.name}</button></td>
          <td>{i.verdict === 'good' ? (i.reviewer?.startsWith('model:') ? 'AI accepted' : 'Accepted') : i.verdict === 'needs_work' ? 'Flagged by you' : i.assessment?.status === 'complete' ? 'Needs attention' : i.assessment?.status ?? 'Awaiting assessment'}</td>
          {scoreColumns.map(([key]) => <td key={key} className="text-center">{result?.judgment.scores[key] ?? '—'}</td>)}</tr> })}
    </tbody></table>{!items.length && <p>No clips need attention. Browse all clips to inspect scores or listen.</p>}</div>}
    {item && clip && <section className="space-y-4 rounded border p-4">
      <div className="flex items-center gap-3">
        <Button disabled={index <= 0} onClick={() => { setIndex(index - 1); setAudio(null) }}>Previous</Button>
        <span>{index < 0 ? 'Selected accepted clip' : `${index + 1} / ${items.length}`} · {item.queue}</span>
        <Button disabled={index >= items.length - 1} onClick={() => { setIndex(index + 1); setAudio(null) }}>Next</Button>
      </div>
      <h2 className="text-lg font-semibold">{clip.cluster?.title ?? clip.members[0]?.name} · {minutes(clip.narration.audio_duration_ms)}</h2>
      <Button disabled={busy} onClick={() => void act(async () => {
        const r = await request<{ url: string }>(`listening-reviews/${reviewId}/audio/${item.narrationId}`); setAudio({ id: item.id, url: r.url })
      })}>Load private audio</Button>
      {audio?.id === item.id && <audio key={audio.url} controls src={audio.url} className="w-full" />}
      {item.assessment?.result && <div className="space-y-2"><p>{item.assessment.result.judgment.summary}</p>
        <p className="text-sm">{item.assessment.result.model} · {item.assessment.result.policyVersion} · {new Date(item.assessment.result.judgedAt).toLocaleString()}</p>
        {item.assessment.result.judgment.issues.map((issue, n) => <p key={n}>{issue.severity}: {issue.detail}{issue.atSeconds != null ? ` (${issue.atSeconds}s)` : ''}</p>)}
        <p>{item.assessment.result.judgment.advisoryExplanation}</p></div>}
      {item.assessment?.error && <p role="alert">{item.assessment.error}</p>}
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
