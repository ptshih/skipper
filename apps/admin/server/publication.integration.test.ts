import { RELEASE_ASSESSMENT_MODEL, RELEASE_ASSESSMENT_POLICY } from '@skipper/shared'
import { listeningAssessmentFingerprint } from '@skipper/db/hash'
import { expect, test } from 'bun:test'
import { SQL as BunSQL } from 'bun'
import { sql, type SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { buildPublicationQuery, buildReleaseQuery, buildApprovalQuery, publicationLock } from './publication'

// Explicitly opt into a disposable local database. Never load dotenv: development is production here.
const url = process.env.LISTENING_TEST_DATABASE_URL
if (url && !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Listening tests require a local disposable database')
const integration = url ? test : test.skip
integration('Postgres: multi-box set, overlapping cluster, stale additions and membership, atomic release and retry', async () => {
  const db = new BunSQL(url!)
  const dialect = new PgDialect()
  const execute = (query: SQL) => {
    const q = dialect.sqlToQuery(query)
    return db.unsafe(q.sql, q.params)
  }
  const region = { slug: `review-test-${crypto.randomUUID()}`, bbox: '-121,36,-120,37;-119,38,-118,39' }
  const p1 = crypto.randomUUID(), p2 = crypto.randomUUID(), p3 = crypto.randomUUID(), cluster = crypto.randomUUID()
  const n1 = crypto.randomUUID(), n2 = crypto.randomUUID(), n3 = crypto.randomUUID(), review = crypto.randomUUID()
  try {
    await db`insert into regions (slug, display_name, bbox, released_at) values (${region.slug}, 'Test', ${region.bbox}, now())`
    await db`insert into poi_clusters (id, title, treatment) values (${cluster}, 'Combined', 'cluster')`
    for (const [id, lat, lng, c] of [[p1, 36.5, -120.5, null], [p2, 38.5, -118.5, cluster], [p3, 40, -117, cluster]] as const)
      await db`insert into pois (id,qid,source,source_id,name,lat,lng,cluster_id) values (${id},${id},'wikidata',${id},${id},${lat},${lng},${c})`
    await db`insert into narrations (id,poi_id,form,script,audio_url,audio_duration_ms) values (${n1},${p1},'scenic','one','one.m4a',1000)`
    await db`insert into narrations (id,cluster_id,form,script,audio_url,audio_duration_ms) values (${n2},${cluster},'scenic','combined','two.m4a',1000)`
    const query = buildPublicationQuery(region)
    const [initial] = await execute(sql`${query} select * from publication`)
    expect(initial.value.clips.map((c: { narration: { id: string } }) => c.narration.id).sort()).toEqual([n1,n2].sort())
    expect(initial.value.clips.find((c: { narration: { id: string } }) => c.narration.id === n2).members).toHaveLength(2)
    const one = buildPublicationQuery(region, n2)
    expect((await execute(sql`${one} select * from publication`))[0].value.clips.map((c: { narration: { id: string } }) => c.narration.id)).toEqual([n2])
    await db`insert into listening_reviews (id,region_slug,fingerprint,snapshot,reviewer,approved_at) values
      (${review},${region.slug},${initial.fingerprint},${JSON.stringify(initial.value)}::jsonb,'test',null)`
    for (const [id, queue] of [[n1, 'reel'], [n2, 'additional']])
      await db`insert into listening_review_items (review_id,narration_id,fingerprint,queue) values (${review},${id},'test',${queue})`
    expect(await execute(buildApprovalQuery(query, review, 'test'))).toHaveLength(0)
    await db`update listening_review_items set technical='{"ok":true}'::jsonb, verdict='good', notes='Heard the full clip' where review_id=${review}`
    await db`update listening_review_items set verdict='needs_work' where review_id=${review} and narration_id=${n2}`
    expect(await execute(buildApprovalQuery(query, review, 'test'))).toHaveLength(0)
    await db`update listening_review_items set verdict='unreviewed' where review_id=${review} and narration_id=${n2}`
    expect(await execute(buildApprovalQuery(query, review, 'test'))).toHaveLength(0)
    await db`update listening_review_items set verdict='good' where review_id=${review} and narration_id=${n2}`
    expect(await execute(buildApprovalQuery(query, review, 'test'))).toHaveLength(1)
    expect((await db`select notes from listening_review_items where review_id=${review} limit 1`)[0].notes).toBe('Heard the full clip')
    // Model acceptance is version-bound even after approval: policy changes and note edits
    // must block publication, while the same exact assessment remains reusable.
    const assessment = crypto.randomUUID()
    await db`insert into release_assessments (id,input_fingerprint,model,policy_version,status) values
      (${assessment},${listeningAssessmentFingerprint('test', 'Heard the full clip')},${RELEASE_ASSESSMENT_MODEL},${RELEASE_ASSESSMENT_POLICY},'complete')`
    await db`update listening_review_items set reviewer=${`model:${RELEASE_ASSESSMENT_MODEL}`},assessment_id=${assessment} where review_id=${review} and narration_id=${n2}`
    expect(await execute(buildApprovalQuery(query, review, 'test'))).toHaveLength(1)
    await db`update release_assessments set policy_version='obsolete-policy' where id=${assessment}`
    expect(await execute(buildApprovalQuery(query, review, 'test'))).toHaveLength(0)
    expect((await execute(buildReleaseQuery(query, region.slug, review)))[0]).toMatchObject({ count: 0, approved: false })
    await db`update release_assessments set policy_version=${RELEASE_ASSESSMENT_POLICY} where id=${assessment}`
    await db`update listening_review_items set notes='Changed context' where review_id=${review} and narration_id=${n2}`
    expect(await execute(buildApprovalQuery(query, review, 'test'))).toHaveLength(0)
    await db`update listening_review_items set reviewer='test',notes='Heard the full clip',assessment_id=null where review_id=${review}`
    await db`delete from release_assessments where id=${assessment}`

    await db`insert into narrations (id,poi_id,form,script,audio_url,audio_duration_ms) values (${n3},${p2},'scenic','new','new.m4a',1000)`
    const [stale] = await execute(buildReleaseQuery(query, region.slug, review))
    expect(stale.approved).toBe(false); expect(stale.count).toBe(0)
    await db`delete from narrations where id = ${n3}`
    await db`update pois set speakable_lat = 38.7 where id = ${p3}`
    expect((await execute(buildReleaseQuery(query, region.slug, review)))[0].approved).toBe(false)
    await db`update pois set speakable_lat = null, cluster_id = null where id = ${p3}`
    expect((await execute(buildReleaseQuery(query, region.slug, review)))[0].approved).toBe(false)
    await db`update pois set cluster_id = ${cluster} where id = ${p3}`
    const [current] = await execute(sql`${query} select * from publication`)
    await db`update listening_reviews set fingerprint=${current.fingerprint} where id=${review}`
    // Hold an edit transaction open while release waits for its table locks. Its next statement
    // must see the committed new audio rather than the approval's earlier snapshot.
    let enter!: () => void, commit!: () => void
    const entered = new Promise<void>(resolve => { enter = resolve })
    const commitAllowed = new Promise<void>(resolve => { commit = resolve })
    const edit = db.begin(async tx => {
      await tx`update narrations set audio_url='concurrent.m4a' where id=${n1}`
      enter(); await commitAllowed
    })
    await entered
    const blockedRelease = db.begin(async tx => {
      const lock = dialect.sqlToQuery(publicationLock); await tx.unsafe(lock.sql, lock.params)
      const q = dialect.sqlToQuery(buildReleaseQuery(query, region.slug, review))
      return tx.unsafe(q.sql, q.params)
    })
    await new Promise(resolve => setTimeout(resolve, 30))
    commit(); await edit
    expect((await blockedRelease)[0]).toMatchObject({ count: 0, approved: false })
    const [afterEdit] = await execute(sql`${query} select * from publication`)
    await db`update listening_reviews set fingerprint=${afterEdit.fingerprint} where id=${review}`
    const result = await db.begin(async tx => {
      const lock = dialect.sqlToQuery(publicationLock); await tx.unsafe(lock.sql, lock.params)
      const q = dialect.sqlToQuery(buildReleaseQuery(query, region.slug, review))
      return tx.unsafe(q.sql, q.params)
    })
    expect(result[0]).toMatchObject({ count: 2, fused: 1, approved: true })
    expect((await execute(buildReleaseQuery(query, region.slug, review)))[0]).toMatchObject({ count: 0, approved: true })
    expect((await db`select count(*)::int as count from narrations where id in (${n1},${n2}) and released_at is not null`)[0].count).toBe(2)
  } finally {
    await db`delete from listening_reviews where id=${review}`
    await db`delete from pois where id in (${p1},${p2},${p3})`
    await db`delete from poi_clusters where id=${cluster}`
    await db`delete from regions where slug=${region.slug}`
    await db.close()
  }
})
