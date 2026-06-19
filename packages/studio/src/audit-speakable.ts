// Audit every curated speakable "where to look" anchor against its poi's pin. A speakable anchor
// corrects a misleading centroid, but a vantage is still "roughly here" — inside the feature's own
// body, never km away (see @skipper/engine `checkSpeakableAnchor`). A typo'd or hallucinated anchor
// yields a confidently-wrong "look to your right," so this sweep flags any anchor beyond the
// kind-aware bound. Read-only: it never writes — fix a flagged anchor in the admin
// (POST /admin/pois/:id/corrections, kind:'speakable') which enforces the SAME bound at the write
// boundary. Conforms to docs/guides/ops-scripts-sop.md.
//
// Blast radius: READ-ONLY (reads the DB; no writes, no spend). Exits 1 when any anchor is out of
// bounds, so it can gate a check/hook later.
//
//   dotenvx run -f .env.development -- bun packages/studio/src/audit-speakable.ts

import { and, isNotNull } from 'drizzle-orm'
import { db } from '@skipper/db'
import { pois } from '@skipper/db/schema'
import { checkSpeakableAnchor } from '@skipper/engine'

async function main() {
  // Read-only — no --apply mode (the shared `announce` preamble's "pass --apply" hint is for
  // spend/mutate CLIs and would mislead here). Fix a flagged anchor in the admin.
  console.log('\n[audit-speakable] READ-ONLY — checking speakable anchors against their pins\n')

  const rows = await db
    .select({
      name: pois.name,
      source: pois.source,
      sourceId: pois.sourceId,
      kind: pois.kind,
      lat: pois.lat,
      lng: pois.lng,
      speakableLat: pois.speakableLat,
      speakableLng: pois.speakableLng,
    })
    .from(pois)
    .where(and(isNotNull(pois.speakableLat), isNotNull(pois.speakableLng)))

  if (rows.length === 0) {
    console.log('No pois carry a speakable anchor. Nothing to audit.')
    return
  }

  let flaggedCount = 0
  console.log(`Auditing ${rows.length} speakable anchor(s):\n`)
  for (const r of rows) {
    // speakableLat/Lng are non-null by the WHERE; lat/lng are NOT NULL on the table.
    const check = checkSpeakableAnchor([r.lng, r.lat], [r.speakableLng!, r.speakableLat!], r.kind)
    const dist = Math.round(check.distanceM)
    const tag = check.ok ? '  ok ' : 'FLAG '
    console.log(`${tag} ${dist}m / ${check.maxM}m  ${r.source}:${r.sourceId}  ${r.name} (${r.kind ?? 'place'})`)
    if (!check.ok) flaggedCount++
  }

  console.log()
  if (flaggedCount > 0) {
    // The flagged rows are already listed inline above (the FLAG lines) — print only the verdict.
    console.log(
      `${flaggedCount} of ${rows.length} anchor(s) are beyond the kind-aware bound (the FLAG lines above) — ` +
        `likely typo'd or hallucinated. Re-verify each and clear/reset it in the admin (POI → Corrections → ` +
        `Speakable anchor).`,
    )
    process.exitCode = 1
  } else {
    console.log(`All ${rows.length} speakable anchor(s) are within bounds.`)
  }
}

await main()
