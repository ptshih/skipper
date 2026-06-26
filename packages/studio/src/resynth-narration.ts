// Re-synthesize narration(s) from the STORED script — for re-mastering audio without changing the
// narration or the poi's facts (e.g. carrying the −14 limiter master + best-of-3 retake across clips
// generated on the OLD linear loudnorm, or fixing a malformed TTS take). Reads each poi's delivery
// register so the re-read matches the original. Writes a FRESH R2 key + repoints audio_url + duration in
// ONE write per clip (the superseded object orphans for sweep-orphans — never an in-place overwrite that
// could serve new audio under the old duration on a crash). A narration is the poi's 1:1 `narrations` row.
//
// Re-synthesis is the ONLY true fix for the old corpus: the master operates on the LOSSLESS take (gone
// after the AAC encode — only the .m4a is in R2), and the tail-collapse fix needs a FRESH take, so a clip
// can't be re-mastered in place. Feed `audit-loudness.ts`'s worklist (the off-spec/clipping/collapsed poi
// ids) straight into --include-ids to fix exactly the defective clips, not a blanket region regen.
//
// SOP (docs/guides/ops-scripts-sop.md): PREVIEWS by default; synthesizes + writes only on --apply.
// Blast radius: SPENDS $ (one TTS synth per clip) + MUTATES DB (updates audioDurationMs).
//
//   dotenvx run -f .env.development -- bun packages/studio/src/resynth-narration.ts <poiId>          # preview one
//   ... <poiId> --apply                          re-synthesize that one clip
//   ... --include-ids a,b,c                       preview a batch
//   ... --include-ids a,b,c --apply              re-synthesize the batch (resilient: a failure skips + continues)
//   ... --include-ids <...> --apply --max-cost N  hard spend ceiling (skips the rest once crossed)

import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { db } from '@skipper/db'
import { narrations, pois } from '@skipper/db/schema'
import type { DeliveryRegister } from '@skipper/shared'
import { announce, assertReady, maxCostFlag, parseFlags } from './pipeline/ops'
import { runJob, type FinishOutcome } from './pipeline/job-progress'
import { personaFromKey } from './persona'
import { ttsStyleFor } from './models'
import { synthesizeWithTailRetake } from './pipeline/tts'
import { narrationClipKey, uploadAudio } from './pipeline/storage'
import { withRetry } from './pipeline/http'
import { mapLimit } from './pipeline/concurrency'
import { estimateTtsUsd, TTS_ESTIMATE_SAFETY } from './pipeline/spend'
import { TTS_CONCURRENCY } from './config'

const flags = parseFlags(process.argv.slice(2), { valueFlags: ['include-ids', 'max-cost'] })
const apply = flags.has('apply')
const maxCostUsd = maxCostFlag(flags)
const parseIds = (v: string | undefined): string[] => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [])
const includeIds = parseIds(flags.value('include-ids'))
// Back-compat: a bare positional poiId still works (the single-clip path); --include-ids is the batch.
const poiIds = includeIds.length > 0 ? includeIds : flags.positionals[0] ? [flags.positionals[0]] : []
// --all re-masters the WHOLE live corpus (every narration with a script + audio) — the master-change path.
// Uses a full-table query, NOT a 460-id IN clause (a neon-http request can't carry that many parameters).
const all = flags.has('all')

if (!all && poiIds.length === 0) {
  console.error('Usage: resynth-narration.ts <poiId> [--apply]   OR   --include-ids a,b,c [--apply]   OR   --all [--apply --yes] [--max-cost N]')
  process.exit(1)
}
// The whole-corpus fan-out is the most destructive combo (re-masters EVERY clip, ~$18, MUTATES DB + R2),
// so a live --all run takes a second confirmation beyond --apply (ops-scripts-sop.md). Preview (no --apply) is free.
if (all && apply && !flags.has('yes')) {
  console.error('⛔ --all --apply re-masters the ENTIRE live corpus (~$18, MUTATES DB + R2). Re-run with --yes to confirm.')
  process.exit(1)
}

announce({ tool: 'resynth-narration', blast: ['SPENDS $', 'MUTATES DB'], apply })
if (apply) assertReady(['tts', 'r2'])

const persona = personaFromKey('skipper')

interface Target {
  poiId: string
  narrationId: string
  audioUrl: string
  audioDurationMs: number
  script: string | null
  poiName: string
  register: DeliveryRegister | null
}

/** Load the narration rows for the requested poi ids (one query; missing ids are reported by the caller). */
async function loadTargets(ids: string[]): Promise<Target[]> {
  return withRetry(
    () =>
      db
        .select({
          poiId: narrations.poiId,
          narrationId: narrations.id,
          audioUrl: narrations.audioUrl,
          audioDurationMs: narrations.audioDurationMs,
          script: narrations.script,
          poiName: pois.name,
          register: pois.deliveryRegister,
        })
        .from(narrations)
        .innerJoin(pois, eq(narrations.poiId, pois.id))
        .where(inArray(narrations.poiId, ids)),
    { label: 'load narrations' },
  )
}

/** Load EVERY live narration (script + audio present) — the --all full-corpus path. A single full-table
 *  query, NOT a giant inArray (a neon-http request can't carry a 460-parameter IN clause). */
async function loadAllTargets(): Promise<Target[]> {
  return withRetry(
    () =>
      db
        .select({
          poiId: narrations.poiId,
          narrationId: narrations.id,
          audioUrl: narrations.audioUrl,
          audioDurationMs: narrations.audioDurationMs,
          script: narrations.script,
          poiName: pois.name,
          register: pois.deliveryRegister,
        })
        .from(narrations)
        .innerJoin(pois, eq(narrations.poiId, pois.id))
        .where(and(isNotNull(narrations.script), isNotNull(narrations.audioUrl))),
    { label: 'load all narrations' },
  )
}

/** Re-synthesize ONE target: fresh TTS take (best-of-3 + the active master) → new R2 key → atomic repoint.
 *  Throws on any failure so the batch driver can isolate it (skip + continue). */
async function resynthOne(t: Target, tag: string): Promise<void> {
  const oldSec = (t.audioDurationMs / 1000).toFixed(1)
  const { audio, durationMs, tail, loudness } = await synthesizeWithTailRetake(
    t.script!,
    persona.voice,
    ttsStyleFor(persona.ttsStyle, t.register ?? 'story'),
    `"${t.poiName}"`,
  )
  // Fresh key + atomic repoint: upload to a NEW key, then repoint audio_url + duration in one write (the
  // old object orphans for sweep-orphans). Avoids the in-place-overwrite window where a crash between the
  // PUT and the duration update would serve new audio under the stale duration.
  const audioUrl = await withRetry(() => uploadAudio(narrationClipKey(t.poiId, crypto.randomUUID()), audio), {
    label: `upload(${t.poiName})`,
  })
  await withRetry(
    () =>
      db
        .update(narrations)
        .set({ audioUrl, audioDurationMs: durationMs, updatedAt: new Date() })
        .where(eq(narrations.id, t.narrationId)),
    { label: `repoint narration(${t.poiName})` },
  )
  const flagsTail = tail?.shippedCollapsed ? ' ⚠ tail still collapsed' : ''
  const flagsLoud =
    loudness && (!loudness.loudnessOk || !loudness.truePeakOk)
      ? ` ⚠ ${[
          loudness.loudnessOk ? null : `${loudness.integratedLufs.toFixed(1)} LUFS`,
          loudness.truePeakOk ? null : `${loudness.truePeakDb.toFixed(1)} dBTP`,
        ]
          .filter(Boolean)
          .join(', ')} off-spec`
      : ''
  console.log(`  ${tag} ${t.poiName} (${oldSec}s → ${(durationMs / 1000).toFixed(1)}s)${flagsTail}${flagsLoud}`)
}

async function main(): Promise<FinishOutcome> {
  const targets = all ? await loadAllTargets() : await loadTargets(poiIds)
  const found = new Set(targets.map((t) => t.poiId))
  const missing = poiIds.filter((id) => !found.has(id))
  if (missing.length > 0)
    console.warn(`⚠ ${missing.length} poiId(s) have no narration (skipped): ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? '…' : ''}`)
  if (targets.length === 0) {
    console.log('Nothing to resynth.')
    return { ok: true }
  }

  const ttsEst = estimateTtsUsd(targets.map((t) => t.script ?? ''), persona.ttsStyle.length)

  // ── PREVIEW (default) ──
  if (!apply) {
    if (targets.length === 1) {
      const t = targets[0]!
      const words = t.script?.split(/\s+/).length ?? 0
      console.log(`\n"${t.poiName}"`)
      console.log(`  Current: ${t.audioDurationMs}ms (${(t.audioDurationMs / 1000).toFixed(1)}s), ${words} words`)
      console.log(`  R2 key:  ${t.audioUrl}`)
      console.log(`  Script:  ${t.script?.slice(0, 120)}...`)
    } else {
      console.log(`\n${targets.length} clip(s) to re-synthesize:`)
      for (const t of targets.slice(0, 40)) console.log(`  • ${t.poiName} (${(t.audioDurationMs / 1000).toFixed(1)}s)`)
      if (targets.length > 40) console.log(`  …and ${targets.length - 40} more.`)
    }
    console.log(
      `\nDRY RUN — nothing synthesized or written. ${targets.length} clip(s) would re-synthesize ` +
        `(best-of-3 + the active master). Est TTS spend ~$${ttsEst.usd.toFixed(2)}. Re-run with --apply.`,
    )
    return { ok: true }
  }

  // ── APPLY: pre-flight spend guard, then a RESILIENT batch (a single clip's failure skips + continues). ──
  const ttsCapEst = ttsEst.usd * TTS_ESTIMATE_SAFETY // honor the cap against the upper bound (the estimate under-counts)
  if (ttsCapEst > maxCostUsd) {
    throw new Error(
      `⛔ Estimated TTS spend ($${ttsCapEst.toFixed(2)}, incl. safety margin) exceeds --max-cost=$${maxCostUsd.toFixed(2)} ` +
        `for ${targets.length} clip(s) — narrow --include-ids or raise the cap.`,
    )
  }

  console.log(`\nRe-synthesizing ${targets.length} clip(s) (concurrency ${TTS_CONCURRENCY()})...`)
  let done = 0
  let ttsSpentUsd = 0
  let costCapped = false
  const failures: { name: string; error: string }[] = []
  const results = await mapLimit(targets, TTS_CONCURRENCY(), async (t): Promise<boolean> => {
    // Running cost cap: skip the rest once actual spend crosses --max-cost (re-run to finish). Checked here,
    // not via a mapLimit throw, so it skips cleanly without aborting the resilient batch.
    if (maxCostUsd !== Infinity && ttsSpentUsd >= maxCostUsd) {
      if (!costCapped) {
        costCapped = true
        console.warn(`  ⛔ --max-cost=$${maxCostUsd.toFixed(2)} reached (~$${ttsSpentUsd.toFixed(2)} spent) — skipping the rest.`)
      }
      return false
    }
    try {
      await resynthOne(t, `[${++done}/${targets.length}]`)
      ttsSpentUsd += estimateTtsUsd([t.script ?? ''], persona.ttsStyle.length).usd
      return true
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      failures.push({ name: t.poiName, error })
      console.warn(`  ⚠ SKIP ${t.poiName}: resynth failed — ${error.slice(0, 160)}`)
      return false
    }
  })

  const ok = results.filter(Boolean).length
  console.log(`\nDone: ${ok}/${targets.length} clip(s) re-synthesized (~$${ttsSpentUsd.toFixed(2)} TTS).`)
  if (failures.length > 0) {
    console.warn(`\n⚠ ${failures.length} clip(s) FAILED and were SKIPPED — re-run to retry:`)
    for (const f of failures) console.warn(`  • ${f.name}: ${f.error.slice(0, 160)}`)
  }
  if (costCapped) console.warn(`\n⛔ Some clips were skipped at the cost cap — re-run (higher --max-cost) to finish.`)
  return { ok: failures.length === 0 }
}

// A single-clip run keys the job on its poiId; a batch leaves targetId NULL (the admin shows it as "All").
await runJob('resynth_narration', { dryRun: !apply, targetId: poiIds.length === 1 ? poiIds[0] : undefined }, main)
