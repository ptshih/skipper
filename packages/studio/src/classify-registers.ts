// classify-registers — assign each enriched POI a `delivery_register` (landscape | story | town |
// civic), which picks its TTS read (`ttsStyleFor`) + length band (`lengthForRegister`). HYBRID,
// founder-chosen 2026-06-19 after external research:
//   1. STRUCTURAL (free): the Wikidata P31/P279* walk (classify-register.ts) — a unanimous single
//      register is trusted (~75% of the live corpus).
//   2. LLM FALLBACK (paid, the tail): a POI whose P31 matched NO register or CONFLICTING ones is
//      handed to a cheap Haiku call over its fact sheet.
// The register is a STABLE place property, classified ONCE and stored on `pois`, shared by roam +
// drives. Conforms to docs/guides/ops-scripts-sop.md (SAFE BY DEFAULT): PREVIEW (the structural
// distribution + the abstain count, NO LLM calls, NO writes) unless --apply.
//
//   preview:  dotenvx run -f .env.development -- bun packages/studio/src/classify-registers.ts
//   apply:    dotenvx run -f .env.development -- bun packages/studio/src/classify-registers.ts --apply
//   --force   re-classify POIs that already have a register (default: only the un-classified).

import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import { db } from '@skipper/db'
import { pois } from '@skipper/db/schema'
import type { FactSheetEntry } from '@skipper/db/schema'
import type { DeliveryRegister } from '@skipper/shared'
import { announce, maxCostFlag, parseFlags } from './pipeline/ops'
import { mapLimit } from './pipeline/concurrency'
import { withRetry } from './pipeline/http'
import { llmSpendLines, llmSpentUsd } from './pipeline/spend'
import { getAnthropic } from './models'
import {
  classifyFromMatches,
  classifyRegisterLLM,
  fetchRegisterMatches,
  makeRegisterCall,
} from './pipeline/classify-register'

const REGISTERS: readonly DeliveryRegister[] = ['landscape', 'story', 'town', 'civic']

type Pending = {
  id: string
  qid: string
  name: string
  kind: string | null
  factSheet: FactSheetEntry[] | null
  register: DeliveryRegister | null
  viaLLM: boolean
}

const distribution = (items: Pending[]): Record<DeliveryRegister, number> => {
  const d: Record<DeliveryRegister, number> = { landscape: 0, story: 0, town: 0, civic: 0 }
  for (const p of items) if (p.register) d[p.register]++
  return d
}
const printDist = (d: Record<DeliveryRegister, number>): void => {
  for (const r of REGISTERS) console.log(`  ${String(d[r]).padStart(4)}  ${r}`)
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2))
  const apply = flags.has('apply')
  const force = flags.has('force')
  const maxCostUsd = maxCostFlag(flags)
  announce({ tool: 'classify-registers', blast: ['SPENDS $', 'MUTATES DB'], apply })
  if (force) console.log('(force: re-classifying POIs that already carry a register)\n')

  // The narratable corpus = enriched POIs with a QID. Skip already-classified unless --force, so a
  // re-run only spends the LLM on the still-unclassified tail.
  const rows = await db
    .select({
      id: pois.id,
      qid: pois.qid,
      name: pois.name,
      kind: pois.kind,
      factSheet: pois.factSheet,
    })
    .from(pois)
    .where(
      and(
        isNotNull(pois.enrichedAt),
        isNotNull(pois.qid),
        force ? undefined : isNull(pois.deliveryRegister),
      ),
    )

  if (rows.length === 0) {
    console.log('Nothing to classify — every enriched POI already has a register (use --force to redo).')
    return
  }
  console.log(`${rows.length} POIs to classify.\n`)

  // 1. STRUCTURAL pass (free): the P31/P279* walk in WDQS → a unanimous register, else abstain.
  const matches = await fetchRegisterMatches(rows.map((r) => r.qid as string))
  const pending: Pending[] = rows.map((r) => {
    const qid = String(r.qid).match(/Q\d+/i)?.[0]?.toUpperCase()
    const res = classifyFromMatches(((qid && matches.get(qid)) || []) as DeliveryRegister[])
    return { id: r.id, qid: r.qid as string, name: r.name, kind: r.kind, factSheet: r.factSheet, register: res.register, viaLLM: res.register === null }
  })
  const abstains = pending.filter((p) => p.register === null)

  console.log('Structural (single-match) distribution:')
  printDist(distribution(pending))
  console.log(`\nStructural: ${pending.length - abstains.length}/${pending.length}  ·  → LLM fallback: ${abstains.length}`)

  if (!apply) {
    console.log(
      `\nPREVIEW — no LLM calls, no writes. Re-run with --apply to classify the ${abstains.length} abstains ` +
        `(Haiku ≈ $${(abstains.length * 0.001).toFixed(2)}) and write all ${pending.length} registers.`,
    )
    return
  }

  // --max-cost ceiling: abort before any spend if the estimate exceeds the cap. The Haiku tail is the
  // only paid step (~$0.001/abstain) — tiny, but keeps this CLI consistent with enrich/generate.
  const estUsd = abstains.length * 0.001
  if (estUsd > maxCostUsd) {
    throw new Error(
      `⛔ Estimated Haiku spend ~$${estUsd.toFixed(2)} exceeds --max-cost=$${maxCostUsd.toFixed(2)} — aborting. Raise --max-cost or narrow the corpus.`,
    )
  }

  // 2+3. CLASSIFY (the paid Haiku tail, abstains only) + WRITE, per-POI in ONE pass. Classifying and
  // writing the SAME poi together means a crash never loses already-paid Haiku work between a classify
  // pass and a separate write pass — each register lands the instant it's resolved. Structural (free)
  // registers write too. withRetry wraps the DB write like every other pipeline write.
  const call = makeRegisterCall(() => getAnthropic('delivery-register fallback'))
  console.log(
    `\nClassifying ${abstains.length} abstains via Haiku + writing ${pending.length} registers (concurrency 8)...`,
  )
  let written = 0
  let llmDone = 0
  await mapLimit(pending, 8, async (p) => {
    if (p.viaLLM) {
      const factSheet =
        (p.factSheet ?? []).map((e) => e.text).join('\n').slice(0, 2000) ||
        `${p.name}${p.kind ? ` (${p.kind})` : ''}`
      p.register = await classifyRegisterLLM({ name: p.name, kind: p.kind, factSheet }, call)
      if (++llmDone % 25 === 0) console.log(`  …${llmDone}/${abstains.length} classified`)
    }
    if (!p.register) return
    await withRetry(
      () => db.update(pois).set({ deliveryRegister: p.register }).where(eq(pois.id, p.id)),
      { label: `register(${p.name})` },
    )
    written++
  })

  console.log('\nFinal distribution:')
  printDist(distribution(pending))
  for (const line of llmSpendLines()) console.log(line)
  console.log(
    `\nDone: ${written} POIs written (${abstains.length} via the LLM fallback, ~$${llmSpentUsd().toFixed(2)} spent).`,
  )
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
