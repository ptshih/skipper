import { createHash } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import { inAnyBbox } from '@skipper/db/bbox'
import { regions, pois, places } from '@skipper/db/schema'
import { groundingHash, clusterFactsHash } from '@skipper/db/hash'
import { RELEASE_ASSESSMENT_MODEL, RELEASE_ASSESSMENT_POLICY, isNarratableStoryPoi } from '@skipper/shared'
import { parseBboxes } from './bbox'
import { requiredCorridors } from './corridors'
import { isHardReviewFinding, type ReviewFinding } from './review-findings'

export interface PublicationClip {
  narration: { id: string; poi_id: string | null; cluster_id: string | null; script: string | null;
    form?: string; audio_url: string; audio_duration_ms: number; attribution: unknown; updated_at: string; facts_hash: string | null }
  members: { id: string; name: string; lat: number; lng: number; speakable_lat: number | null;
    speakable_lng: number | null; excluded_reason: string | null; facts_hash: string | null; sheet_hash?: string | null; source?: string; facts?: unknown; fact_sheet?: unknown[] }[]
  cluster: { title: string; highlights?: string[]; dropped?: string[] } | null
  findings: ReviewFinding[]
}
export interface PublicationSnapshot {
  region: { slug: string; bbox: string; released_at: string | null }
  clips: PublicationClip[]
  evidence: { corridor: string; corpus_fingerprint: string; notes: string; route?: { selection: { seq: number; subjectId: string; subjectKind: string; poiId?: string }[] }; report: { stops: { seq?: number; fired: boolean }[]; missing: unknown[] } }[]
  endpoints: { id: string; lat: number; lng: number; access_lat?: number | null; access_lng?: number | null }[]
}
export const corpusFingerprint = (clips: PublicationClip[]) => createHash('sha256').update(JSON.stringify(clips)).digest('hex')
export const clipFingerprint = (clip: PublicationClip) => createHash('sha256').update(JSON.stringify(clip)).digest('hex')

/** One expression defines the displayed set, review version, and eventual release writes.
 * Full cluster membership is included even when only one member intersects a region box.
 */
export async function publicationQuery(slug: string, narrationId: string | null = null) {
  const [region] = await db.select().from(regions).where(eq(regions.slug, slug)).limit(1)
  if (!region) throw new Error('Region not found')
  return buildPublicationQuery(region, narrationId)
}

export function buildPublicationQuery(region: { slug: string; bbox: string | null }, narrationId: string | null = null) {
  const slug = region.slug
  const boxes = parseBboxes(region.bbox)
  if (!boxes.length) throw new Error('Set valid region geometry before review or release')
  const membership = inAnyBbox(pois.lat, pois.lng, boxes)
  return sql`with selected as (
    select n.* from narrations n where n.released_at is null
    and (${narrationId}::uuid is null or n.id = ${narrationId}::uuid)
    and exists (select 1 from pois where ${membership}
      and (pois.id = n.poi_id or pois.cluster_id = n.cluster_id))
  ), snapshot as (select jsonb_build_object(
    'region', to_jsonb(r),
    'evidence', (select coalesce(jsonb_agg(to_jsonb(e) order by e.id), '[]'::jsonb) from listening_evidence e where e.region_slug = r.slug),
    'clips', coalesce((select jsonb_agg(jsonb_build_object(
      'narration', to_jsonb(n),
      'cluster', (select to_jsonb(c) from poi_clusters c where c.id = n.cluster_id),
      'members', (select coalesce(jsonb_agg(to_jsonb(p) order by p.id), '[]'::jsonb)
        from pois p where p.id = n.poi_id or p.cluster_id = n.cluster_id),
      'findings', (select coalesce(jsonb_agg(to_jsonb(e) order by e.id), '[]'::jsonb)
        from eval_scores e join eval_runs er on er.id = e.run_id where not er.dry_run and (e.poi_id = n.poi_id or e.cluster_id = n.cluster_id)
        and e.created_at >= n.updated_at and (not e.withheld or e.script = n.script))
    ) order by n.id) from selected n), '[]'::jsonb),
    'endpoints', (select coalesce(jsonb_agg(to_jsonb(places) order by places.id), '[]'::jsonb)
      from places where ${inAnyBbox(places.lat, places.lng, boxes)})
    ) as value from regions r where r.slug = ${slug} and r.bbox = ${region.bbox}
  ), publication as (select value, md5(value::text) as fingerprint from snapshot)`
}

export async function loadPublication(slug: string, narrationId: string | null = null) {
  const query = await publicationQuery(slug, narrationId)
  const result = await db.execute(sql`${query} select * from publication`)
  const row = result.rows[0] as { value: PublicationSnapshot; fingerprint: string } | undefined
  if (!row) throw new Error('Region changed; refresh the review')
  return { ...row, query, blockers: structuralBlockers(row.value) }
}

const validPoint = (lat: unknown, lng: unknown): lat is number =>
  typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)
  && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
const invalidOptionalPoint = (lat: unknown, lng: unknown) =>
  !(lat == null && lng == null) && !validPoint(lat, lng)

export function structuralBlockers(snapshot: PublicationSnapshot) {
  const blockers: string[] = []
  const endpoints = snapshot.endpoints.filter(p => {
    if (!validPoint(p.lat, p.lng) || invalidOptionalPoint(p.access_lat, p.access_lng)) {
      blockers.push(`${p.id}: invalid endpoint geometry`)
      return false
    }
    return true
  })
  // Distinct feature pins can route to the same parking lot. Count the vehicle access points
  // that routeWaypoints actually uses, while keeping feature pins as region membership truth.
  if (!snapshot.region.released_at && new Set(endpoints.map(p =>
    `${p.access_lat ?? p.lat}:${p.access_lng ?? p.lng}`,
  )).size < 2) blockers.push('Initial launch needs two usable, distinct endpoints')
  if (!snapshot.clips.length) blockers.push('No staged playable content')
  for (const c of snapshot.clips) {
    if (!c.narration.script?.trim() || !c.narration.audio_url || c.narration.audio_duration_ms <= 0)
      blockers.push(`${c.narration.id}: missing script or playable audio metadata`)
    if (!c.members.length || c.members.some(p => !validPoint(p.lat, p.lng)
      || invalidOptionalPoint(p.speakable_lat, p.speakable_lng))) blockers.push(`${c.narration.id}: invalid subject geometry`)
    const tellable = c.members.filter(p => isNarratableStoryPoi({ source: p.source ?? '', name: p.name,
      excludedReason: p.excluded_reason, hasFacts: p.facts != null, sheetLength: p.fact_sheet?.length ?? 0 }))
    if (c.narration.poi_id && c.members.some(p => p.excluded_reason != null)) blockers.push(`${c.narration.id}: subject is excluded`)
    if (c.narration.cluster_id && !tellable.length) blockers.push(`${c.narration.id}: combined story has no usable members`)
    if (c.narration.form === 'story') {
      const hashOf = (p: PublicationClip['members'][number]) => groundingHash({ factsHash: p.facts_hash, sheetHash: p.sheet_hash ?? null })
      const currentHash = c.narration.cluster_id && c.cluster ? clusterFactsHash({ title: c.cluster.title,
        highlights: c.cluster.highlights ?? [], dropped: c.cluster.dropped ?? [],
        members: tellable.map(p => ({ poiId: p.id, name: p.name, factsHash: hashOf(p) })),
      }) : c.members[0] ? hashOf(c.members[0]) : null
      if (!currentHash || c.narration.facts_hash !== currentHash) blockers.push(`${c.narration.id}: narration facts are stale`)
      if (!Array.isArray(c.narration.attribution) || !c.narration.attribution.length) blockers.push(`${c.narration.id}: missing source attribution`)
    }
    if (c.findings.some(isHardReviewFinding)) blockers.push(`${c.narration.id}: failed generation gate`)
  }
  if (!snapshot.region.released_at) {
    const fingerprint = corpusFingerprint(snapshot.clips)
    for (const corridor of requiredCorridors(snapshot.region.slug)) {
      if (!snapshot.evidence.some(e => e.corridor === corridor && e.corpus_fingerprint === fingerprint
        && e.notes.trim() && e.report.missing.length === 0 && e.report.stops.some(s => s.fired)))
        blockers.push(`Missing current route evidence: ${corridor}`)
    }
  }
  return blockers
}

/** Spread the reel across geography and both subject kinds, deterministically; no paid calls. */
export function reviewQueues(clips: PublicationClip[], target = 12, evidence: PublicationSnapshot['evidence'] = []) {
  const buckets = new Map<string, PublicationClip[]>()
  for (const c of clips) {
    const p = c.members[0]
    const key = `${c.narration.cluster_id ? 'cluster' : 'poi'}:${Math.floor((p?.lat ?? 0) * 10)}:${Math.floor((p?.lng ?? 0) * 10)}`
    const bucket = buckets.get(key) ?? []
    bucket.push(c); buckets.set(key, bucket)
  }
  const reel = new Set<string>()
  for (const kind of ['cluster', 'poi']) {
    const candidate = clips.filter(c => (c.narration.cluster_id ? 'cluster' : 'poi') === kind)
      .sort((a, b) => a.narration.id.localeCompare(b.narration.id))[0]
    if (candidate && reel.size < target) reel.add(candidate.narration.id)
  }
  // Saved drives connect actual played subjects to corridor evidence. Geographic buckets fill
  // remaining capacity when corridor runs do not yet exist (for example the calibration batch).
  const covered = new Set<string>()
  const corridors = new Map<string, Set<string>>()
  for (const e of evidence) {
    const family = e.corridor.match(/Groveland|Mariposa|Oakhurst|Lee Vining|Valley|Wawona Road|Glacier Point Road|Big Oak Flat Road|Tioga Road|El Portal Road|Evergreen\/Hetch Hetchy|Cross-park/)?.[0] ?? e.corridor
    const played = new Set(e.report.stops.filter(s => s.fired).map(s => s.seq))
    for (const selection of e.route?.selection ?? []) {
      if (!played.has(selection.seq)) continue
      const clip = clips.find(c => (c.narration.poi_id ?? c.narration.cluster_id) === (selection.subjectId ?? selection.poiId))
      if (!clip) continue
      const set = corridors.get(clip.narration.id) ?? new Set<string>()
      set.add(family); corridors.set(clip.narration.id, set)
    }
  }
  for (const id of reel) for (const corridor of corridors.get(id) ?? []) covered.add(corridor)
  while (reel.size < Math.min(target, clips.length)) {
    const candidates = clips.filter(c => !reel.has(c.narration.id)).map(c => ({ id: c.narration.id,
      score: [...(corridors.get(c.narration.id) ?? [])].filter(c => !covered.has(c)).length,
    })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    if (!candidates[0]?.score) break
    const id = candidates[0].id; reel.add(id)
    for (const corridor of corridors.get(id) ?? []) covered.add(corridor)
  }
  const groups = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v.sort((a, b) => a.narration.id.localeCompare(b.narration.id)))
  for (let round = 0; reel.size < Math.min(target, clips.length); round++) {
    for (const group of groups) {
      if (group[round]) reel.add(group[round]!.narration.id)
      if (reel.size >= target) break
    }
  }
  return clips.map(c => ({ clip: c, queue: reel.has(c.narration.id) ? 'reel' :
    c.findings.some(f => !f.pass) ? 'flagged' : 'additional' }))
}

// A first statement in the HTTP batch acquires locks BEFORE the next statement takes its snapshot.
// This closes insert phantoms and geometry/member races without holding a transaction while listening.
export const publicationLock = sql`lock table regions, narrations, pois, poi_clusters, places,
  eval_scores, eval_runs, listening_reviews, listening_review_items, listening_evidence in share row exclusive mode`

export async function releaseReviewed(slug: string, reviewId: string, narrationId: string | null = null) {
  const query = await publicationQuery(slug, narrationId)
  const [, result] = await db.batch([
    db.execute(publicationLock),
    db.execute(buildReleaseQuery(query, slug, reviewId, narrationId)),
  ])
  return result.rows[0] as { count: number; fused: number; approved: boolean }
}

export function buildReleaseQuery(query: ReturnType<typeof buildPublicationQuery>, slug: string, reviewId: string, narrationId: string | null = null) {
  return sql`${query}, approved as (
      select p.value from publication p join listening_reviews r on r.fingerprint = p.fingerprint
      where r.id = ${reviewId}::uuid and r.region_slug = ${slug}
      and r.narration_id is not distinct from ${narrationId}::uuid and r.approved_at is not null and r.published_at is null
      ${reviewAcceptancePredicate()}
    ), stamped as (
      update narrations set released_at = now() where released_at is null and id in
      (select (c->'narration'->>'id')::uuid from approved, jsonb_array_elements(value->'clips') c)
      returning id, cluster_id, released_at
    ), opened as (
      update regions set released_at = coalesce(released_at, now())
      where slug = ${slug} and ${narrationId}::uuid is null and exists(select 1 from stamped)
      returning released_at
    ), receipt as (
      update listening_reviews set published_at = now() where id = ${reviewId}::uuid
        and exists(select 1 from stamped) returning id
    ) select (select count(*) from stamped)::int as count,
      (select count(*) from stamped where cluster_id is not null)::int as fused,
      (exists(select 1 from approved) or exists(select 1 from listening_reviews r
        where r.id = ${reviewId}::uuid and r.region_slug = ${slug}
        and r.narration_id is not distinct from ${narrationId}::uuid and r.published_at is not null)) as approved`
}

export function buildApprovalQuery(query: ReturnType<typeof buildPublicationQuery>, reviewId: string, reviewer: string) {
  return sql`${query} update listening_reviews r set approved_at = now(), approved_by = ${reviewer}
      from publication p where r.id = ${reviewId}::uuid and r.fingerprint = p.fingerprint
      ${reviewAcceptancePredicate()} returning r.id`
}

/** Shared by approval and release so policy changes cannot publish through an old approval. */
function reviewAcceptancePredicate() {
  return sql`      and jsonb_array_length(p.value->'clips') > 0
      and (select count(*) from listening_review_items i where i.review_id = r.id) = jsonb_array_length(p.value->'clips')
      and not exists (select 1 from listening_review_items i where i.review_id = r.id and (
        i.verdict <> 'good'
        or (i.reviewer like 'model:%' and not exists(select 1 from release_assessments a
          where a.id = i.assessment_id and a.status = 'complete' and a.model = ${RELEASE_ASSESSMENT_MODEL}
          and a.policy_version = ${RELEASE_ASSESSMENT_POLICY}
          and a.input_fingerprint = encode(sha256(convert_to(i.fingerprint || chr(10) || i.notes, 'UTF8')), 'hex')))
        or coalesce((i.technical->>'ok')::boolean, false) = false
        or (coalesce((i.technical->>'advisory')::boolean, false) and (trim(i.advisory_reason) = '' or i.verdict <> 'good'))
        or (trim(i.advisory_reason) = '' and exists(select 1 from jsonb_array_elements(p.value->'clips') c,
          jsonb_array_elements(c->'findings') f where c->'narration'->>'id' = i.narration_id::text and f->>'pass' = 'false'))
      ))`
}
