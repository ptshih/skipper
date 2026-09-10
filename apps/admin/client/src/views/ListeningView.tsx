import { isHardReviewFinding, type ReleaseAssessmentResult } from '@skipper/shared'
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { listeningQueue, nextListeningItem, saveListeningDecision, DEFAULT_ACCEPTANCE_REASON, type ReviewFilter } from '@/lib/listening-queue'
import { pendingListeningItems } from '@/lib/listening-readiness'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/PageHeader'
import type { PublicationSnapshot } from '../../../server/publication'

type Item = { reviewer: string | null; assessment: { status: string; result: ReleaseAssessmentResult | null; error: string | null } | null; id: string; narrationId: string; queue: string; verdict: string; notes: string; advisoryReason: string;
  technical: { ok: boolean; advisory?: boolean; message: string } | null }
type Review = { assessmentJob?: { id: string; status: string; phase: string | null; error: string | null }; review: { id: string; approvedAt: string | null; publishedAt: string | null; narrationId: string | null }; items: Item[];
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
  const [filter, setFilter] = useState<ReviewFilter>('review')
  const [notice, setNotice] = useState<{ text: string; itemId: string } | null>(null)
  const [audio, setAudio] = useState<{ id: string; url: string } | null>(null)
  const [audioError, setAudioError] = useState('')
  const [audioAttempt, setAudioAttempt] = useState(0)
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
  const items = listeningQueue(allItems, data?.snapshot.clips ?? [], filter)
  const toReview = listeningQueue(allItems, data?.snapshot.clips ?? [], 'review').length
  const needsWork = allItems.filter(i => i.verdict === 'needs_work').length
  const pending = pendingListeningItems(allItems, data?.snapshot.clips ?? [])
  const item = items.find(i => i.id === selectedId) ?? items[0]
  const index = items.findIndex(i => i.id === item?.id)
  const setIndex = (n: number) => { setSelectedId(items[n]?.id ?? '') }
  useEffect(() => {
    if (item && !selectedId) setSelectedId(item.id)
  }, [item, selectedId])
  const clip = data?.snapshot.clips.find(c => c.narration.id === item?.narrationId)
  const open = (id: string) => {
    setReviewId(id); setSelectedId(''); setNotice(null); setFilter('review')
    history.replaceState(null, '', `/listening?region=${encodeURIComponent(region)}&review=${id}`)
  }
  useEffect(() => {
    const latest = sessions.data?.reviews[0]
    if (!reviewId && latest) {
      setReviewId(latest.id)
      history.replaceState(null, '', `/listening?region=${encodeURIComponent(region)}&review=${latest.id}`)
    }
  }, [reviewId, region, sessions.data])
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
  const changeFilter = (value: ReviewFilter) => { setFilter(value); setSelectedId('') }
  const saveVerdict = (body: { verdict: string; notes: string; advisoryReason: string }) => act(async () => {
    if (!item) return
    const currentId = item.id
    const nextId = await saveListeningDecision(items, currentId, () => request(`listening-reviews/${reviewId}/items/${currentId}`, 'PATCH', body))
    setNotice({ text: `${clip?.cluster?.title ?? clip?.members[0]?.name ?? 'Clip'} ${body.verdict === 'good' ? 'accepted' : body.verdict === 'needs_work' ? 'marked needs work' : 'saved'}.`, itemId: currentId })
    setSelectedId(nextId)
  })
  const assessing = ['queued', 'running'].includes(data?.assessmentJob?.status ?? '')
  const locked = busy || !!data?.stale || !!data?.review.publishedAt
    || assessing
  // Loading a recording is read-only and should not invalidate every review query or move focus.
  useEffect(() => {
    if (!reviewId || !item) return
    let canceled = false
    setAudio(null)
    setAudioError('')
    request<{ url: string }>(`listening-reviews/${reviewId}/audio/${item.narrationId}`)
      .then(r => { if (!canceled) setAudio({ id: item.id, url: r.url }) })
      .catch(e => { if (!canceled) setAudioError(e instanceof Error ? e.message : 'Audio unavailable') })
    return () => { canceled = true }
  }, [reviewId, item?.id, item?.narrationId, audioAttempt])
  const snapshot = data?.snapshot ?? readiness.data?.snapshot
  return <div className="space-y-6">
    <PageHeader title="Listening Review" description="Skim the finding, make a decision, move on. Passing clips are already accepted; listening is optional." />
    <div className="flex flex-wrap gap-3">
      <select disabled={busy} aria-label="Region" className="rounded border bg-background p-2" value={region} onChange={e => {
        setRegion(e.target.value); setReviewId(''); setSelectedId(''); setNotice(null)
        history.replaceState(null, '', `/listening?region=${encodeURIComponent(e.target.value)}`)
      }}>{regions.data?.regions.map(r => <option key={r.slug} value={r.slug}>{r.displayName}</option>)}</select>
      <Button disabled={busy} onClick={() => void create()}>New review ($25 cap)</Button>
      {params.get('narration') && <Button disabled={busy} onClick={() => void create(params.get('narration')!)}>Review selected clip in this region</Button>}
      <select disabled={busy} aria-label="Resume review" className="rounded border bg-background p-2" value={reviewId} onChange={e => open(e.target.value)}>
        <option value="">Resume saved review…</option>
        {sessions.data?.reviews.map(r => <option key={r.id} value={r.id}>{new Date(r.createdAt).toLocaleString()} {r.approvedAt ? '— approved' : ''}</option>)}
      </select>
    </div>
    {(error || readiness.error || review.error) && <p role="alert" className="text-destructive">{error || readiness.error?.message || review.error?.message}</p>}
    {snapshot && <section className="space-y-2 rounded border p-4">
      <p>{snapshot.clips.length} staged clips · {snapshot.clips.filter(c => c.narration.cluster_id).length} combined stories · {snapshot.endpoints.length} endpoints</p>

      {(data?.blockers ?? readiness.data?.blockers ?? []).map(b => <p key={b} className="text-destructive">{b}</p>)}
      {data?.stale && <p role="alert" className="font-semibold text-destructive">This review is stale. Create a replacement; unchanged clip verdicts carry forward.</p>}
      {data && <p className="text-lg font-semibold">{allItems.length - pending} accepted · {toReview} to review · {needsWork} marked needs work</p>}
    </section>}
    {data && <>
      {assessing && <p role="status" className="rounded border p-3">Scoring clips… Decisions unlock when assessment completes. {data.assessmentJob?.phase}</p>}
      {data.assessmentJob?.status === 'failed' && <p role="alert" className="text-destructive">Assessment failed: {data.assessmentJob.error ?? 'Open assessment tools to retry.'}</p>}
      <div className="flex flex-wrap items-center gap-2" aria-label="Review queue">
        <Button disabled={busy} variant={filter === 'review' ? 'default' : 'outline'} onClick={() => changeFilter('review')}>Needs review ({toReview})</Button>
        <Button disabled={busy} variant={filter === 'needs_work' ? 'default' : 'outline'} onClick={() => changeFilter('needs_work')}>Marked needs work ({needsWork})</Button>
        <Button disabled={busy} variant={filter === 'all' ? 'default' : 'outline'} onClick={() => changeFilter('all')}>All clips ({allItems.length})</Button>
      </div>
      {notice && <p role="status" className="text-sm">{notice.text} <button disabled={busy} className="underline" onClick={() => { setFilter('all'); setSelectedId(notice.itemId) }}>Revisit</button></p>}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
        {item && clip ? <section className="min-w-0 space-y-4 rounded-lg border bg-card p-5">
          <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>{index + 1} of {items.length} · {clip.narration.cluster_id ? 'Combined story' : 'Individual clip'} · {minutes(clip.narration.audio_duration_ms)}</span>
            <div className="flex gap-2"><Button variant="ghost" disabled={busy || index <= 0} onClick={() => setIndex(index - 1)}>Previous</Button>
              <Button variant="ghost" disabled={busy || items.length < 2} onClick={() => { setSelectedId(nextListeningItem(items, item.id)) }}>Skip →</Button></div>
          </div>
          <h2 className="text-xl font-semibold">{clip.cluster?.title ?? clip.members[0]?.name}</h2>
          <div className="space-y-2">
            <h3 className="font-semibold">{item.verdict === 'good' ? 'Accepted' : 'Why this needs attention'}</h3>
            <p>{item.assessment?.result?.judgment.summary ?? item.assessment?.error ?? 'Automated assessment has not completed yet.'}</p>
            {item.assessment?.result?.judgment.issues.map((issue, n) => <p key={n} className="text-sm"><span className="font-medium">{issue.dimension === 'audioFidelity' ? 'Audio' : issue.dimension === 'roadContext' ? 'Location' : issue.dimension === 'sourceSupport' ? 'Sources' : issue.dimension}:</span> {issue.detail}{issue.atSeconds != null ? ` (${minutes(issue.atSeconds * 1000)})` : ''}</p>)}
          </div>
          {error && <p role="alert" className="text-destructive">{error}</p>}
          {(!item.technical?.ok || clip.findings.some(isHardReviewFinding)) && <p className="text-sm text-destructive">{!item.technical?.ok ? item.technical?.message ?? 'Technical audio check pending.' : ''} {clip.findings.filter(isHardReviewFinding).flatMap(f => f.findings).join(' ')}</p>}
          <QuickVerdictForm key={`${reviewId}:${item.id}:${item.verdict}:${item.notes}:${item.advisoryReason}`} item={item} busy={locked}
            canAccept={!!item.technical?.ok && !clip.findings.some(isHardReviewFinding)} save={saveVerdict} />
          {audio?.id === item.id ? <audio key={audio.url} aria-label="Clip audio" controls preload="metadata" src={audio.url} className="w-full" /> : audioError ? <div role="alert" className="flex items-center gap-3 text-sm"><span>{audioError}</span><Button variant="outline" onClick={() => setAudioAttempt(n => n + 1)}>Retry audio</Button></div> : <p className="text-sm text-muted-foreground">Loading private audio…</p>}
          <details><summary className="cursor-pointer font-medium">Read script</summary><p className="mt-3 whitespace-pre-wrap leading-relaxed">{clip.narration.script}</p></details>
          <details><summary className="cursor-pointer font-medium">Scores, sources and correction tools</summary>
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap gap-3">{scoreColumns.map(([key, label]) => <span key={key} className="rounded border px-2 py-1 text-sm">{label}: {item.assessment?.result?.judgment.scores[key] ?? '—'}/10</span>)}</div>
              <p>{item.technical?.message ?? 'Technical audio check pending'}</p>
              <p>{item.assessment?.result?.judgment.advisoryExplanation}</p>
              <div className="flex flex-wrap gap-3">{clip.members.map(p => <a className="underline" key={p.id} href={`/pois?poi=${p.id}`}>{p.name} · corrections</a>)}</div>
              <pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify({ attribution: clip.narration.attribution, findings: clip.findings }, null, 2)}</pre>
            </div>
          </details>
        </section> : <section className="rounded-lg border p-6">
          <h2 className="text-lg font-semibold">{filter === 'review' ? 'Triage complete' : 'No clips in this queue'}</h2>
          <p>{needsWork ? `${needsWork} clips are marked needs work. Resolve those before approving the release.` : pending ? 'Technical checks or assessment still need attention.' : 'Every clip is accepted. You can approve the release review below.'}</p>
        </section>}
        <details open className="rounded-lg border p-3"><summary className="cursor-pointer font-medium">Queue · {items.length} clips</summary>
          <div className="mt-2 max-h-[65vh] space-y-1 overflow-y-auto">{items.map(i => { const c = data.snapshot.clips.find(c => c.narration.id === i.narrationId)
            return <button disabled={busy} key={i.id} aria-current={item?.id === i.id ? 'true' : undefined} className={`w-full rounded p-2 text-left text-sm ${item?.id === i.id ? 'bg-accent font-semibold' : 'hover:bg-accent'}`}
              onClick={() => { setSelectedId(i.id) }}>{c?.cluster?.title ?? c?.members[0]?.name}<span className="block text-xs text-muted-foreground">{i.verdict === 'good' ? 'Accepted' : i.verdict === 'needs_work' ? 'Marked needs work' : 'Needs review'}</span></button>
          })}</div>
        </details>
      </div>
      <section className="flex flex-wrap items-center gap-3 rounded-lg border p-4">
        <p className="mr-auto">{data.review.publishedAt ? 'Published' : pending ? `${pending} unresolved clips before release` : 'All clip decisions complete'}</p>
        <Button disabled={locked || data.blockers.length > 0 || pending > 0 || allItems.length === 0} onClick={() => void act(() => request(`listening-reviews/${reviewId}/approve`, 'POST'))}>Approve release review</Button>
        <Button disabled={locked || !data.review.approvedAt} onClick={() => void act(async () => {
          if (!window.confirm(`Publish exactly these ${data.snapshot.clips.length} approved clips permanently?`)) return
          await request(`listening-reviews/${reviewId}/release`, 'POST')
        })}>Publish approved set</Button>
      </section>
      <details className="rounded border p-4"><summary className="cursor-pointer">Assessment and technical tools</summary><div className="mt-3 space-y-3">
        <p>{data.assessmentJob?.status === 'succeeded' ? 'Assessment complete' : `Assessment ${data.assessmentJob?.status ?? 'not started'}: ${data.assessmentJob?.phase ?? ''}`}</p>
        {data.assessmentJob?.error && <p role="alert">{data.assessmentJob.error}</p>}
        <p className="text-sm">Creating or retrying a review runs a paid assessment with a $25 cap. Completed current judgments are reused. Playback and technical checks are free.</p>
        <div className="flex gap-3"><Button disabled={locked || ['queued', 'running'].includes(data.assessmentJob?.status ?? '')} onClick={() => void act(() => request(`listening-reviews/${reviewId}/assess`, 'POST'))}>Assess remaining clips</Button>
        <Button variant="outline" disabled={locked} onClick={() => void act(async () => {
          for (const i of allItems) await request(`listening-reviews/${reviewId}/technical/${i.id}`, 'POST')
        })}>Check all audio (free)</Button></div>
      </div></details>
    </>}
    {snapshot && <details className="rounded border p-4"><summary>Exact staged publication set ({snapshot.clips.length})</summary>
      <ul className="space-y-2">{snapshot.clips.map(c => <li key={c.narration.id}>
        {c.cluster?.title ?? c.members[0]?.name} · {c.narration.cluster_id ? 'combined' : 'individual'} · {minutes(c.narration.audio_duration_ms)}
        <Button variant="ghost" disabled={busy} onClick={() => void create(c.narration.id)}>Review only this clip</Button>
      </li>)}</ul>
    </details>}
    <details className="space-y-3 rounded border p-4">
      <summary className="cursor-pointer font-semibold">Corridor evidence</summary>
      <p>Replay a saved drive you own. Record current access sources, routing restrictions, investigated quiet windows, and intentional silence. This replay uses saved geometry and makes no route-provider calls.</p>
      <select aria-label="Corridor" className="rounded border bg-background p-2" value={corridor} onChange={e => setCorridor(e.target.value)}>
        <option value="">Choose corridor…</option>{readiness.data?.requiredCorridors.map(c => <option key={c}>{c}</option>)}
      </select>
      <input aria-label="Saved QA drive ID" className="w-full rounded border bg-background p-2" value={driveId} onChange={e => setDriveId(e.target.value)} placeholder="Saved operator drive ID" />
      <textarea aria-label="Corridor evidence notes" className="w-full rounded border bg-background p-2" value={evidenceNotes} onChange={e => setEvidenceNotes(e.target.value)} placeholder="Access sources and quiet-window investigation" />
      <Button disabled={busy || !corridor || !driveId || !evidenceNotes.trim()} onClick={() => void act(() => request(`regions/${region}/listening-evidence`, 'POST', { driveId, corridor, notes: evidenceNotes, mph: 30 }))}>Save 30 mph replay evidence</Button>
      {readiness.data?.snapshot.evidence.map((e, i) => <details key={i}><summary>{e.corridor}</summary><p>{e.notes}</p><pre className="overflow-auto text-xs">{JSON.stringify(e.report, null, 2)}</pre></details>)}
    </details>
  </div>
}

function QuickVerdictForm({ item, busy, canAccept, save }: { item: Item; busy: boolean; canAccept: boolean;
  save: (body: { verdict: string; notes: string; advisoryReason: string }) => Promise<void> }) {
  const [notes, setNotes] = useState(item.notes)
  const [reason, setReason] = useState(item.advisoryReason || DEFAULT_ACCEPTANCE_REASON)
  const submit = (verdict: string) => save({ verdict, notes, advisoryReason: verdict === 'good' ? reason : item.advisoryReason })
  return <div className="space-y-3 rounded-lg bg-muted/40 p-3">
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy || !canAccept || !reason.trim()} onClick={() => void submit('good')}>Accept & next</Button>
      <Button variant="outline" disabled={busy} onClick={() => void submit('needs_work')}>Needs work & next</Button>
    </div>
    {!canAccept && <p className="text-sm text-destructive">Acceptance is blocked until technical failures are corrected and checks pass.</p>}
    <p className="text-xs text-muted-foreground">Accepting records your acceptance of the displayed findings. It does not say you listened.</p>
    <details><summary className="cursor-pointer text-sm">Notes and acceptance reason</summary>
      <div className="mt-2 space-y-2">
        <label className="block text-sm">Notes<textarea disabled={busy} className="mt-1 w-full rounded border bg-background p-2" value={notes} onChange={e => setNotes(e.target.value)} /></label>
        <label className="block text-sm">Acceptance reason<textarea disabled={busy} className="mt-1 w-full rounded border bg-background p-2" value={reason} onChange={e => setReason(e.target.value)} /></label>
        <Button variant="ghost" disabled={busy} onClick={() => void submit('unreviewed')}>Save as unreviewed & next</Button>
      </div>
    </details>
  </div>
}
