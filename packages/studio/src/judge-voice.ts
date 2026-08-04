// Voice & charm worksheet — the "is the persona actually charming?" pass over the LIVE corpus.
//
// Blast radius: SPENDS $ on --apply (LLM — one Opus charm-judge call per run), READ-ONLY otherwise.
// It never mutates: it selects from `narrations`, writes nothing but a local markdown file, and
// touches no R2 bytes. SOP (docs/guides/ops-scripts-sop.md): it now PREVIEWS by default like
// everything else — the no-flag run counts the queue, presigns every clip and emits the whole by-ear
// worksheet for FREE; only the writing judge is gated behind --apply.
//
// "THE PERSONA IS THE PRODUCT," and this is the only thing in the repo that puts both halves of that
// judgment in one document:
//   1. WRITING (automated, --apply) — an LLM charm-judge (Opus) scores every selected clip's SCRIPT
//      for charm and flags where it sags. Charm only; grounding is a separate gate.
//   2. VOICE (your ears, always) — each clip is paired with a playable presigned link + a blank
//      rating line, because a script can be charming on the page and the TTS can flatten it. Only a
//      human can judge the voice, and nothing else here does it: `audit-corpus --charm` reuses the
//      same judge but grades the WRITING alone.
//
// The charm-judge CORE (system prompt, tool, judgeCharm) lives in ./eval/charm.ts so the eval panel
// and this worksheet share ONE rubric (no drift). This file is the selection + the human-facing
// markdown report + the by-ear worksheet on top of that core.
//
// ⚠ It used to read a run-JSON artifact emitted by the V1 tour entrypoint, which the V1→V2 collapse
// deleted — so for the whole of 1.1 nothing emitted its input and it could only be hand-fed, which
// meant it was never run. It now selects the way the other corpus CLIs do (region bbox XOR an
// explicit id list, plus --limit), so the ids you already have in hand from `audit-corpus` /
// `audit-loudness` feed straight in. (founder call 2026-08-02: repoint it at the corpus, don't retire it.)
//
// Usage (env via dotenvx — R2_* to presign the audio; ANTHROPIC_API_KEY for the --apply judge).
// Prefer --out over a shell redirect: the SOP preamble prints on stdout, so `> file.md` captures it too.
//   dotenvx run -f .env.development -- bun packages/studio/src/judge-voice.ts --out=/tmp/voice.md
//   ... --apply                  also run the Opus charm judge over the writing (SPENDS $)
//   ... --region <slug>          a region's clips (REQUIRED unless --include-ids; → its bbox)
//   ... --include-ids a,b,c      EXACTLY these subjects — poi ids and/or cluster ids
//   ... --query <substr>         narrow to names containing <substr>
//   ... --limit N                at most N clips (default: the judge batch max, below)

import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import { narrations, poiClusters, pois } from '@skipper/db/schema'
import { MODEL_PRICING } from '@skipper/shared'
import { announce, numericFlag, parseFlags } from './pipeline/ops'
import { clusterIdsInBbox, poiIdsInBbox } from './pipeline/diversity-context'
import { requireRegionBbox, requireRegionKey, resolveRegion } from './pipeline/region'
import { withRetry } from './pipeline/http'
import { ANTHROPIC_READY } from './config'
import { JUDGMENT_MODEL } from './models'
import { presignGet } from './pipeline/storage'
import { judgeCharm, type CharmVerdict } from './eval/charm'

/**
 * How long a worksheet's play links stay valid.
 *
 * Narration audio is PRIVATE in R2 and a presigned URL is a bearer token for it, so every link in the
 * file you just wrote plays for anyone the file reaches — and a worksheet is exactly the kind of file
 * that gets pasted into a thread or left in /tmp. Two hours covers one listening sitting and little
 * else, which is all it has to cover.
 *
 * ⚠ The old 12h was buying time you could not cheaply re-buy: refreshing the links meant paying the
 * charm judge again, because the report was one indivisible paid artifact. It isn't now — a no-flag
 * re-run re-signs every link for free — so the TTL only has to outlive the session, not the day.
 */
const LINK_TTL_SEC = 2 * 60 * 60

/**
 * Clips per charm-judge call — and therefore the default `--limit`.
 *
 * ⚠ The judge scores the whole batch in ONE forced-tool call bounded by its own `max_tokens`
 * (eval/charm.ts), and each per-stop verdict costs a seq, a score and two short strings. A big enough
 * queue therefore doesn't fail loudly — it TRUNCATES, and a paid run that quietly reports on a subset
 * is the SOP's "a sample that cannot answer the question should produce no conclusion" with a dollar
 * sign attached. A by-ear pass is a human listening session anyway, so a finite default costs nothing
 * real; a `--limit` raised past this is REFUSED on --apply rather than silently cut.
 */
const JUDGE_BATCH_MAX = 60

// Rough output budget per judged clip, for the preview's spend estimate only.
const JUDGE_OUTPUT_TOKENS_PER_CLIP = 90
// The usual English approximation. This is an ESTIMATE for the preview line, never the bill.
const CHARS_PER_TOKEN = 4

const flags = parseFlags(process.argv.slice(2), {
  valueFlags: ['region', 'include-ids', 'query', 'limit', 'out'],
})
const apply = flags.has('apply')
const outPath = flags.value('out')
const regionRaw = flags.value('region') || null
const query = (flags.value('query') ?? '').trim().toLowerCase()
const includeIds = (flags.value('include-ids') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
// ⚠ numericFlag, not Number(...): a typo'd --limit must not resolve to NaN, which disables the
// comparison below rather than tightening it (see pipeline/ops.ts).
const limit = numericFlag(flags, 'limit', { fallback: JUDGE_BATCH_MAX })
// Region bbox XOR an explicit id list, the same way audit-corpus resolves it. ⚠ Combining them means
// the bbox wins and the ids are DEAD — say so rather than quietly judging a different set than the
// operator named and charging them for it.
const isExplicit = includeIds.length > 0 && !regionRaw && !query
if (includeIds.length > 0 && !isExplicit)
  console.error('⚠ --include-ids is IGNORED alongside --region/--query — drop those to select exactly those ids.')
// ⚠ FAIL HERE, before anything is announced or billed. A FILTER run with no --region used to mean
// "judge lake-tahoe" — judging the wrong region's clips and charging for it. An EXPLICIT run names
// its clips and needs no region.
if (!isExplicit) requireRegionKey(regionRaw)

announce({ tool: 'judge-voice', blast: apply ? ['SPENDS $'] : ['READ-ONLY'], apply })

/** One selected telling, as the worksheet needs to see it. */
interface Clip {
  /** The narration's SUBJECT id — a poi id, or a cluster id for a fused telling. */
  subjectId: string
  fused: boolean
  form: string
  name: string
  script: string
  audioKey: string
  durationMs: number
  released: boolean
}

const RECO_LABEL: Record<CharmVerdict['recommendation'], string> = {
  ship: '✅ SHIP — charming enough to bet the player on',
  tune: '🛠 TUNE — good bones, specific fixes needed',
  rework: '🔁 REWORK — reads as competent AI, not the skipper',
}

/** Estimate the ONE judge call, priced from MODEL_PRICING so the $/MTok rate keeps its single home.
 *  Null = the judgment model has no priced row (honestly unpriced rather than silently guessed). The
 *  shared rubric also rides the input, but at Opus rates a fixed system prompt is noise next to the
 *  scripts, so it isn't modelled here. */
function estimateJudgeUsd(clips: Clip[]): number | null {
  const pricing = MODEL_PRICING[JUDGMENT_MODEL]
  if (!pricing) return null
  const inTok = clips.reduce((n, c) => n + c.script.length, 0) / CHARS_PER_TOKEN
  const outTok = clips.length * JUDGE_OUTPUT_TOKENS_PER_CLIP
  return (inTok * pricing.inputPerMTok + outTok * pricing.outputPerMTok) / 1_000_000
}

/** The worksheet. `verdict` null = the free preview: the by-ear half stands alone, the writing line
 *  says what it would cost to fill in. */
function buildReport(clips: Clip[], scope: string, verdict: CharmVerdict | null): string {
  const bySeq = new Map((verdict?.stops ?? []).map((s) => [s.seq, s]))
  const staged = clips.filter((c) => !c.released).length
  const out: string[] = []
  out.push(`# Voice & charm worksheet — ${scope}`)
  out.push('')
  out.push('## The bet: is the persona charming enough to build the player on?')
  if (verdict) {
    out.push(`**Judge — the writing (Opus):** ${verdict.overall}/10 · ${RECO_LABEL[verdict.recommendation]}`)
    out.push(`> ${verdict.verdict}`)
    out.push(`- Weakest clips: ${verdict.weakestStops.length ? verdict.weakestStops.join(', ') : '—'}`)
    out.push(`- Biggest charm risk: ${verdict.biggestRisk}`)
  } else {
    const est = estimateJudgeUsd(clips)
    out.push(
      `**Judge — the writing (Opus):** not run. Re-run with \`--apply\` to score the writing ` +
        `(${est === null ? 'cost unpriced for this model' : `~$${est.toFixed(2)} estimated`}).`,
    )
  }
  out.push('')
  out.push('**Your call — the VOICE (your ears):**  ⬜ ship  ⬜ tune  ⬜ rework')
  out.push(
    '> The judge graded the WORDS. You grade the Charon VOICE: play each clip and ask — warm corny human, or an AI reading Wikipedia with a tour-guide badge pinned on? Do the jokes get room to breathe? Where does it sound robotic / rushed / flat? Rate each clip 1-5 and fill the overall above.',
  )
  out.push('')
  out.push(
    `_Each clip carries its SUBJECT id: feed a poi id to \`resynth-narration --include-ids\` (a flat or ` +
      `rushed read is usually a TTS re-roll, not a rewrite) or \`generate-narrations\`; a fused cluster id ` +
      `goes to \`generate-cluster-narrations\`. Play links expire in ${LINK_TTL_SEC / 3600}h — a no-flag re-run re-signs them free._`,
  )
  out.push('')
  out.push(`## Clips (${clips.length}${staged ? ` · ${staged} still STAGED` : ''})`)
  clips.forEach((c, seq) => {
    const j = bySeq.get(seq)
    const len = ` · ${(c.durationMs / 1000).toFixed(1)}s`
    const charm = j ? ` · charm ${j.charm}/10` : ''
    // STAGED is worth saying out loud: a by-ear pass is what you do BEFORE a region release, so most
    // of a fresh worksheet is not yet public and the operator should know which lines riders can hear.
    const state = c.released ? '' : ' · STAGED'
    const fused = c.fused ? ' (fused cluster)' : ''
    out.push(`\n### [${String(seq).padStart(2, '0')}] ${c.form.toUpperCase()} · ${c.name}${fused}${len}${charm}${state}`)
    out.push(`\`${c.subjectId}\``)
    out.push(`> ${c.script.replace(/\n/g, '\n> ')}`)
    try {
      out.push(`🔊 ${presignGet(c.audioKey, LINK_TTL_SEC)}`)
    } catch {
      out.push(`🔊 (R2 key ${c.audioKey} — set R2_* env to presign a playable link)`)
    }
    if (j) {
      out.push(`- ✅ best: ${j.best}`)
      out.push(`- ⚠️ sag: ${j.sag}`)
    }
    out.push('- 🎧 VOICE (your ears): __/5 — ________________________________')
  })
  out.push('')
  return out.join('\n')
}

/**
 * Every narrated telling in scope — SOLO AND FUSED.
 *
 * ⚠ The joins are LEFT on purpose. The idiom everywhere else in this package is an inner join to
 * `pois`, which is right for a tool that needs a place — but a fused cluster telling carries
 * `poi_id` NULL (`narrations_subject_xor`), so an inner join drops every one of them without a word.
 * That is the same defect `pipeline/diversity-context.ts` documents, and a voice worksheet is where
 * it would hurt most: fused clips replace their members on the read paths, so the tellings a rider is
 * most likely to hear would be the ones the charm pass never looked at. Region membership resolves
 * per subject kind through the shared bbox helpers — a solo clip by its poi's point, a fused one by
 * whether any MEMBER poi sits in the box (`poi_clusters` stores no coordinates, deliberately).
 */
async function loadClips(): Promise<Clip[]> {
  const region = isExplicit ? null : await resolveRegion(regionRaw)
  const bbox = region ? requireRegionBbox(region) : null
  const scope = isExplicit
    ? // --include-ids takes SUBJECT ids, so a cluster id works the same as a poi id — the operator
      // pastes what `audit-corpus` / the admin handed them without having to know which kind it is.
      or(inArray(narrations.poiId, includeIds), inArray(narrations.clusterId, includeIds))
    : sql`(${narrations.poiId} in ${poiIdsInBbox(bbox!)} or ${narrations.clusterId} in ${clusterIdsInBbox(bbox!)})`

  const rows = await withRetry(
    () =>
      db
        .select({
          poiId: narrations.poiId,
          clusterId: narrations.clusterId,
          form: narrations.form,
          script: narrations.script,
          audioKey: narrations.audioUrl,
          durationMs: narrations.audioDurationMs,
          releasedAt: narrations.releasedAt,
          poiName: pois.name,
          clusterTitle: poiClusters.title,
        })
        .from(narrations)
        .leftJoin(pois, eq(narrations.poiId, pois.id))
        .leftJoin(poiClusters, eq(narrations.clusterId, poiClusters.id))
        .where(and(isNotNull(narrations.script), scope)),
    { label: 'load narrations' },
  )

  const clips: Clip[] = []
  for (const r of rows) {
    const subjectId = r.poiId ?? r.clusterId
    const name = r.poiName ?? r.clusterTitle
    if (!subjectId || !name || !r.script?.trim()) continue
    if (query && !name.toLowerCase().includes(query)) continue
    clips.push({
      subjectId,
      fused: r.poiId === null,
      form: r.form,
      name,
      script: r.script,
      audioKey: r.audioKey,
      durationMs: r.durationMs,
      released: r.releasedAt !== null,
    })
  }
  // Sorted by name so re-running the same selection yields the same seq numbers — the judge's
  // `weakestStops` are seqs, and a worksheet you annotate by hand must not renumber under you.
  return clips.sort((a, b) => a.name.localeCompare(b.name))
}

async function main() {
  const all = await loadClips()
  const clips = all.slice(0, limit)
  const scope = [
    isExplicit ? `${includeIds.length} hand-picked` : `region=${requireRegionKey(regionRaw)}`,
    query ? `query="${query}"` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  console.error(`Found ${all.length} narrated clip(s) (${scope}).`)
  if (clips.length === 0) {
    console.error('Nothing to judge or listen to.')
    return
  }
  if (clips.length < all.length)
    console.error(`⚠ Worksheet covers the first ${clips.length} by name — raise --limit to widen.`)

  let verdict: CharmVerdict | null = null
  if (apply) {
    // Fail fast on a missing key rather than after the selection query, and refuse a batch the judge
    // can only answer by truncating (JUDGE_BATCH_MAX) — both BEFORE anything bills.
    if (!ANTHROPIC_READY())
      throw new Error('ANTHROPIC_API_KEY is not set — `judge-voice --apply` needs it to run the charm judge.')
    if (clips.length > JUDGE_BATCH_MAX)
      throw new Error(
        `⛔ ${clips.length} clips exceeds the ${JUDGE_BATCH_MAX}-clip judge batch — one call cannot score them ` +
          'all without truncating its report. Narrow with --limit/--query/--include-ids and run the batches separately.',
      )
    const est = estimateJudgeUsd(clips)
    console.error(
      `Judging the charm of ${clips.length} clip(s) — one Opus call, ` +
        `${est === null ? 'cost unpriced for this model' : `~$${est.toFixed(2)} estimated (not the bill)`}...`,
    )
    verdict = await judgeCharm(
      clips.map((c, seq) => ({ seq, stopType: c.form, name: c.name, script: c.script })),
    )
  }

  const report = buildReport(clips, scope, verdict)
  if (outPath) {
    await Bun.write(outPath, report)
    console.error(`\nWrote worksheet → ${outPath}`)
  } else {
    console.log(report)
  }

  if (verdict) {
    console.error(
      `Judge: ${verdict.overall}/10 · ${verdict.recommendation}. Now LISTEN through it and fill the VOICE lines ` +
        `(the play links expire in ${LINK_TTL_SEC / 3600}h — a free re-run re-signs them).`,
    )
  } else {
    const est = estimateJudgeUsd(clips)
    console.error(
      `\nDRY RUN — the by-ear worksheet is complete and nothing was spent. Add --apply to also score the ` +
        `WRITING with the Opus charm judge (${est === null ? 'cost unpriced for this model' : `~$${est.toFixed(2)} estimated`}).`,
    )
  }
}

main().catch((e) => {
  console.error('\njudge-voice failed:', e instanceof Error ? e.message : e)
  process.exitCode = 1
})
