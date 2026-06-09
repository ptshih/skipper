// The M1 generator pipeline — assemble ONE tour for ONE corridor.
//
//   corridor (DB)
//     -> Wikipedia geosearch + extracts      (grounded story facts)
//     -> Google Places searchAlongRoute       (food/rest BREAK anchors)
//     -> select stops by drive TIME           (pace, not distance)
//     -> Skipper narration (Anthropic)        (story + scenic + break)
//     -> TTS (Google Cloud, Gemini-TTS) -> R2 (audio + duration)
//     -> tours + ordered tour_stops (Neon)    (atomic ready-gate)
//
// Invariants honored here:
//   - Persona lives in delivery, never in facts: story stops get a fact sheet;
//     scenic stops carry none; break stops carry only the curated NAME + KIND
//     (sayable), never volatile data (hours/rating/features — live at tour-load).
//   - Story attribution (CC BY-SA) is snapshotted on every story clip.
//   - EVERY stop — story, scenic, AND break — gets a poi_content row with non-null
//     audio; a tour reaches `ready` only via the atomic batch, after every stop has it.
// M1 scope: no cache reuse, no dedup beyond the (source,source_id) upsert, no
// feedback. Break narration names the curated Places anchor; the volatile live data
// (open-now/rating) is still fetched fresh at tour-load (and "ask the skipper" later).

import type { BracketKind, DurationBucket } from '@skipper/shared'
import type { AttributionSnapshot } from '@skipper/db/schema'
import {
  ANTHROPIC_READY,
  GEOLOGY_ENRICHMENT,
  GEOLOGY_ICONIC_STOPS,
  GEOLOGY_STORY_MAX_FACT_CHARS,
  GOOGLE_TTS_READY,
  FALLBACK_SPEED_MPS,
  GEOSEARCH_STEP_M,
  GOOGLE_READY,
  PACING,
  R2_READY,
  WIKIDATA_ENRICHMENT,
  WIKIDATA_STORY_MAX_FACT_CHARS,
  requireEnv,
} from '../config'
import { personaForRegion } from '../persona'
import { cumulativeMeters, encodePolyline, sampleAlong, totalMeters } from './geo'
import type { LngLat } from './geo'
import { discoverWikipediaPois, fetchDeepExtracts } from './wikipedia'
import { geologyFacts } from './macrostrat'
import { wikidataFacts } from './wikidata'
import { searchBreakStops, spokenKind } from './places'
import type { BreakAnchor } from './places'
import { selectStops, toFacts } from './select'
import type { StopPlan } from './select'
import { narrateIntro, narrateOutro, narrateStop } from './narrate'
import type { NarrationRequest } from './narrate'
import { lintScripts } from './lint'
import type { LintFinding } from './lint'
import { judgeCloserDiversity } from './judge'
import { synthesize } from './tts'
import { bracketKey, clipKey, uploadAudio } from './storage'
import {
  finalizeTourReady,
  hashFacts,
  loadTour,
  markTourFailed,
  markTourGenerating,
  upsertPoi,
} from './persist'
import type { FinalBracket, FinalStop } from './persist'

export interface GenerateOptions {
  slug: string
  durationBucket?: DurationBucket
  /** Narrate + print scripts only; skip TTS, R2, and all DB writes. */
  dryRun?: boolean
  /** Flag this tour as the anonymous-playable sample (tours.isPreview). */
  preview?: boolean
  /** Run the optional semantic-closer judge (one extra model call) after the lint. */
  judgeClosers?: boolean
}

export interface StopSummary {
  seq: number
  stopType: StopPlan['stopType']
  name: string
  alongSec: number
  /** STORY only: which side of the road the place is on, when the geometry called it. */
  sideOfRoad?: 'left' | 'right'
  script?: string
  /** STORY only: the grounded fact sheet the model was given — emitted on dry-run so
   *  the script can be audited against its exact well of facts (grounding invariant). */
  facts?: string[]
  /** STORY + SCENIC: the geology lines (Macrostrat) the model was given — part of the audited well. */
  geology?: string[]
  /** STORY only: the Wikidata structured facts the model was given — part of the audited well. */
  wikidata?: string[]
  durationMs?: number
  audioUrl?: string
}

export interface BracketSummary {
  kind: BracketKind
  script?: string
  durationMs?: number
}

export interface GenerateResult {
  tourId?: string
  slug: string
  /** Display label for the drive (the tour's headline, e.g. "Emerald Bay"). */
  tourName: string
  region: string
  durationBucket: DurationBucket
  totalSec: number
  dryRun: boolean
  stops: StopSummary[]
  brackets: BracketSummary[]
}

const firstSentence = (facts: string[]): string | null => facts[0] ?? null

export async function generateTour(opts: GenerateOptions): Promise<GenerateResult> {
  const durationBucket: DurationBucket = opts.durationBucket ?? 'standard'
  const dryRun = Boolean(opts.dryRun)
  const judgeClosers = Boolean(opts.judgeClosers)

  if (!ANTHROPIC_READY()) throw new Error('ANTHROPIC_API_KEY is not set (narration requires it).')
  if (!dryRun) {
    if (!GOOGLE_TTS_READY())
      throw new Error(
        'Google Cloud TTS is not configured — set GOOGLE_CLOUD_PROJECT and provide ADC ' +
          '(GOOGLE_APPLICATION_CREDENTIALS=<service-account.json>, or `gcloud auth application-default login` ' +
          'plus GOOGLE_TTS_USE_ADC=1). Use --dry-run to skip TTS.',
      )
    if (!R2_READY()) {
      throw new Error('R2_* env (ACCOUNT_ID, ACCESS_KEY_ID, SECRET_ACCESS_KEY, BUCKET) is not set.')
    }
  }

  // 1. Tour shell: route geometry + drive time (the pacing clock) + endpoints/region.
  const shell = await loadTour(opts.slug)
  // The generation persona (prompts/voice/style/kit) is resolved from the tour's REGION;
  // the notch is the tour's own (set by the seed) — not a persona trait.
  const persona = personaForRegion(shell.regionSlug)
  const jokeLevel = shell.jokeLevel
  const polyline = shell.polyline as LngLat[]
  const cumulative = cumulativeMeters(polyline)
  const totalM = totalMeters(cumulative)
  const totalSec = shell.durationSeconds ?? Math.round(totalM / FALLBACK_SPEED_MPS)
  console.log(
    `Tour "${shell.headline}" (${shell.regionName}): ${(totalM / 1609.344).toFixed(1)} mi, ~${Math.round(totalSec / 60)} min` +
      (shell.durationSeconds ? '' : ' [estimated drive time]'),
  )

  // 2. Grounded POIs from Wikipedia.
  const samples = sampleAlong(polyline, cumulative, GEOSEARCH_STEP_M)
  console.log(`Probing Wikipedia at ${samples.length} points along the route...`)
  const wikiPois = await discoverWikipediaPois(samples)
  console.log(`Found ${wikiPois.length} unique Wikipedia POIs.`)

  // 3. Break-stop anchors from Places (non-fatal — breaks are a nicety).
  let breakAnchors: BreakAnchor[] = []
  if (GOOGLE_READY()) {
    try {
      breakAnchors = await searchBreakStops(
        encodePolyline(polyline),
        requireEnv('GOOGLE_MAPS_API_KEY'),
      )
      console.log(`Found ${breakAnchors.length} break-stop anchors.`)
    } catch (e) {
      console.warn(`Break-stop search failed (continuing without breaks): ${(e as Error).message}`)
    }
  } else {
    console.warn('GOOGLE_MAPS_API_KEY not set — skipping break stops.')
  }

  // 4. Select + time-pace stops.
  const plan = selectStops({
    polyline,
    totalSec,
    wikiPois,
    breakAnchors,
    pacing: PACING[durationBucket],
  })
  const narratedCount = plan.filter((s) => s.stopType !== 'break').length
  if (narratedCount === 0) throw new Error(`No narratable stops found for "${opts.slug}".`)
  console.log(
    `Planned ${plan.length} stops: ${plan.filter((s) => s.stopType === 'story').length} story, ` +
      `${plan.filter((s) => s.stopType === 'scenic').length} scenic, ` +
      `${plan.filter((s) => s.stopType === 'break').length} break.`,
  )

  // Deepen the fact sheets for the CHOSEN story stops. Selection ranked + classified
  // candidates on the cheap batched LEAD extract; a fuller, longer telling needs more
  // than the lead, so we now pull the full article (capped, meta-trimmed) for each
  // story stop and use it as the fact well. Grounding is unchanged — still only that
  // POI's Wikipedia text — and any per-POI failure falls back to its lead facts.
  const storyStops = plan.filter(
    (s): s is StopPlan & { wikiPageId: number } =>
      s.stopType === 'story' && s.wikiPageId !== undefined,
  )
  if (storyStops.length > 0) {
    console.log(
      `Deepening fact sheets for ${storyStops.length} story stops (full-article extracts)...`,
    )
    const deep = await fetchDeepExtracts(storyStops.map((s) => s.wikiPageId))
    for (const s of storyStops) {
      const text = deep.get(s.wikiPageId)
      if (text && text.length > s.facts.join(' ').length) s.facts = toFacts(text)
    }
    console.log(`Deepened ${deep.size}/${storyStops.length} story fact sheets.`)
  }

  // Geology enrichment (Macrostrat, CC BY 4.0): a coordinate-keyed fact layer — the rock
  // you are driving through, grounded from geologic maps. Unlike Wikipedia it is keyed on
  // the POINT, so it can light up a stop that has no article at all. It does NOT change a
  // stop's type (geology is a separate channel, never counted toward STORY_MIN_FACT_CHARS),
  // so the scenic↔story classification — and the M4 cache key — are untouched.
  //   WHO gets it: SCENIC always (it carries no Wikipedia facts, so geology is the one true
  //   thing it can say — geology's highest-leverage win); STORY only when SPARSE (fact sheet
  //   below GEOLOGY_STORY_MAX_FACT_CHARS) — on a rich story geology piles on as a repetitive
  //   deep-time closer — UNLESS the stop is on the per-corridor ICONIC allowlist (the rock IS
  //   the headline there, e.g. Emerald Bay's granite). Sparse vs iconic picks the narration cue.
  // Per-stop failures are non-fatal (the stop just gets no geology). Set SKIPPER_GEOLOGY=off.
  if (GEOLOGY_ENRICHMENT()) {
    const iconic = new Set(GEOLOGY_ICONIC_STOPS[shell.slug] ?? [])
    const geoReasonOf = (s: StopPlan): 'scenic' | 'sparse' | 'iconic' | null => {
      if (s.stopType === 'scenic') return 'scenic'
      if (s.stopType !== 'story') return null
      if (iconic.has(s.name)) return 'iconic'
      if (s.facts.join(' ').length < GEOLOGY_STORY_MAX_FACT_CHARS) return 'sparse'
      return null
    }
    const geoStops = plan
      .map((s) => ({ s, reason: geoReasonOf(s) }))
      .filter((x) => x.reason !== null)
    const countOf = (r: string) => geoStops.filter((x) => x.reason === r).length
    console.log(
      `Enriching ${geoStops.length} stops with Macrostrat geology ` +
        `(${countOf('scenic')} scenic, ${countOf('sparse')} sparse story, ${countOf('iconic')} iconic; rich stories skipped)...`,
    )
    let geoHits = 0
    for (const { s, reason } of geoStops) {
      // WHICH coordinate: for SPARSE/SCENIC stops, the TRIGGER point (POI snapped onto the
      // road) — literally "the rock under your tires," always on LAND (dodges the fine map's
      // "water" units that force a coarse fallback), matching the narrator's "ground we're
      // rolling over" framing. For ICONIC stops we want the rock that MAKES the place, so we
      // query the POI/landmark point itself (e.g. Emerald Bay's granite cliffs read as the
      // Mesozoic intrusive batholith there, where the road below snaps onto valley alluvium).
      const [glat, glng] = reason === 'iconic' ? [s.lat, s.lng] : [s.triggerLat, s.triggerLng]
      const geo = await geologyFacts(glat, glng)
      if (geo) {
        s.geology = geo.facts
        s.geologyAttribution = geo.attribution
        if (reason === 'sparse' || reason === 'iconic') s.geologyReason = reason
        geoHits++
      }
    }
    console.log(`Geology grounded ${geoHits}/${geoStops.length} stops.`)
  }

  // Wikidata enrichment (CC0): a QID-keyed layer of discrete facts (inception, elevation,
  // named-after, heritage designation) joined from the Wikipedia page's `wikibase_item`.
  // Like geology it is a SEPARATE channel — never counted toward STORY_MIN_FACT_CHARS, so
  // it can't flip a stop's type or disturb the M4 cache key.
  //   WHO gets it: STORY stops with a linked QID, but only when SPARSE (fact sheet below
  //   WIKIDATA_STORY_MAX_FACT_CHARS). A date/elevation/namesake identifies the place, so —
  //   unlike geology — it can NOT ride a SCENIC stop without breaking the "no place-facts"
  //   invariant; and a fact-rich story already states these things in prose (piling on is
  //   the monotony the geology sparse-gate avoids). A thin story is exactly where an exact
  //   year or elevation rounds it out.
  // Per-stop failures are non-fatal (the stop just gets no Wikidata). Set SKIPPER_WIKIDATA=off.
  if (WIKIDATA_ENRICHMENT()) {
    const wdStops = plan.filter(
      (s) =>
        s.stopType === 'story' &&
        s.wikidataQid &&
        s.facts.join(' ').length < WIKIDATA_STORY_MAX_FACT_CHARS,
    )
    console.log(
      `Enriching ${wdStops.length} sparse story stops with Wikidata structured facts ` +
        `(rich stories + scenic skipped)...`,
    )
    let wdHits = 0
    for (const s of wdStops) {
      const wd = await wikidataFacts(s.wikidataQid!)
      if (wd) {
        s.wikidata = wd.facts
        s.wikidataAttribution = wd.attribution
        wdHits++
      }
    }
    console.log(`Wikidata grounded ${wdHits}/${wdStops.length} stops.`)
  }

  // Each stop is an independent narration call, so the model can't see its own
  // prior output. We feed it (a) recent place names for earned callbacks and
  // (b) how the last few stops OPENED, so it can vary its entry instead of
  // reusing "coming up off the bow" every time.
  const priorStops: string[] = []
  const recentOpeners: string[] = []
  const recentClosers: string[] = []
  const recentKit: string[][] = [] // personal-kit beats used per remembered stop
  const recentMotifs: string[][] = [] // recurring frames / invented self-deprecation flavors per stop
  const openerOf = (script: string) => script.trim().split(/\s+/).slice(0, 8).join(' ')
  const closerOf = (script: string) => script.trim().split(/\s+/).slice(-8).join(' ')
  // Detect which personal-kit beats a script leaned on, so later (independently
  // generated) stops can be told they're spent — the load-bearing fix for kit
  // overuse, since each stop is narrated in isolation with no view of its siblings.
  // The kit is per-PERSONA (persona.kit.beats) — the SAME source the diversity lint
  // bans in stops, so the two can never desync.
  const kitBeatsOf = (script: string) =>
    persona.kit.beats.filter((b) => b.match.test(script)).map((b) => b.label)
  // Recurring DEVICES beyond the fixed personal kit — the same-shape gags the charm
  // judge keeps flagging on a new vector each run (every town's post office, the
  // name-change rundown, "was nothing"; and self-deprecation flavors the model invents
  // fresh — the one-room apartment, the handyman who won't show). Same isolation problem
  // as the kit, so detect them and tell later stops the bit is SPENT. Unlike the kit
  // (which has a 1/3 budget), a frame is a one-time bit — the spent list is CUMULATIVE.
  const MOTIF_BEATS: [RegExp, string][] = [
    [/post ?office/i, 'the post-office (opened/closed/reopened) bit'],
    [
      /could ?(n'?t| not) (decide|pick|settle|make up)|make up (your|his|its|their|my)? ?mind|answered to .{0,30}names|changed (its )?names?|(a few|a couple of?|several|different|two|three) names?\b|gone by .{0,15}names?|used to be called|(went|gone) by\b/i,
      'the "place that changed / could not pick its name" rundown',
    ],
    [
      /(patch|place|stretch|spot|valley|lot) (of |that was )?nothing|was (just )?nothing\b|nobody (could|would) (name|picture)|undeveloped|empty .{0,15}(valley|patch|mountain)/i,
      'the "was nothing, now something" frame',
    ],
    [
      /the distance from .{0,30}(dock|hat|boat)|surveyed .{0,20}inch|down to the (quarter section|inch|foot)|tape measure|the kind of precision|some poor soul/i,
      'the surveyed-to-the-inch / tape-measure-precision gag',
    ],
    [
      /one good word|use(d)? it twice|used twice|why (pay|reach|use|go) (for )?two\b|one (word|idea|name).{0,18}(twice|do the|hold the|float)|covering all (your|his) bases|wearing every hat|every hat (the|this|it)|all three (jobs|hats)|namesake.{0,25}(same|are the same)/i,
      'the "economy of naming / one man did it all and named it after himself" riff',
    ],
    [
      /my (one[- ]room |whole )?apartment|lose my keys|keys? in (it|there)/i,
      'the one-room-apartment self-deprecation',
    ],
    [
      /(get|find) (a|my) (guy|handyman|fellow).{0,25}(wrench|show|fix)|with a wrench/i,
      'the handyman-with-a-wrench self-deprecation',
    ],
    [/I do this for a living/i, 'the "I do this for a living" self-deprecation'],
  ]
  const motifBeatsOf = (script: string) =>
    MOTIF_BEATS.filter(([re]) => re.test(script)).map(([, label]) => label)
  const baseReq = (s: StopPlan): NarrationRequest => ({
    region: shell.regionName,
    corridor: shell.headline,
    stopType: s.stopType,
    jokeLevel,
    targetSeconds: s.targetSeconds,
    // STORY: name + facts (+ side of road, when geometry calls it). BREAK: the curated
    // name + kind (no facts). SCENIC: neither.
    ...(s.stopType === 'story'
      ? {
          place: { name: s.name, kind: s.kind },
          facts: s.facts,
          ...(s.sideOfRoad ? { sideOfRoad: s.sideOfRoad } : {}),
          ...(s.geology?.length
            ? {
                geology: s.geology,
                ...(s.geologyReason ? { geologyContext: s.geologyReason } : {}),
              }
            : {}),
          ...(s.wikidata?.length ? { wikidata: s.wikidata } : {}),
        }
      : s.stopType === 'break'
        ? { place: { name: s.name, kind: spokenKind(s.kind) } } // normalize raw primaryType
        : // SCENIC: no place-facts — but geology, when present, is the one grounded thing it may say.
          s.geology?.length
          ? { geology: s.geology }
          : {}),
  })
  // First-pass narration: thread the trailing-3 window of cross-stop context.
  const narrate = (s: StopPlan) =>
    narrateStop(
      {
        ...baseReq(s),
        priorStops: priorStops.slice(-3),
        recentOpeners: recentOpeners.slice(-3),
        recentClosers: recentClosers.slice(-3),
        recentKitBeats: [...new Set(recentKit.slice(-3).flat())],
        // CUMULATIVE (all prior stops): a frame/flavor is a one-time bit, not a budget.
        recentMotifs: [...new Set(recentMotifs.flat())],
      },
      persona.systemPrompt,
    )
  const rememberStop = (s: StopPlan, script: string) => {
    // Story names the real place (callback-able); break + scenic push a GENERIC token so
    // a later stop can't call back to a transient food spot and characterize it ("that
    // nice café back there" = volatile/opinion the break rule forbids).
    priorStops.push(
      s.stopType === 'story' ? s.name : s.stopType === 'break' ? 'a rest stop' : 'a quiet stretch',
    )
    recentOpeners.push(openerOf(script))
    recentClosers.push(closerOf(script))
    // Breaks are invisible to kit accounting (a café break inviting "a coffee" is a
    // generic cue, not the coffee-opinion kit) AND don't occupy a slot in the trailing-3
    // window, so they can't flush a real narrated kit beat out of it early.
    if (s.stopType !== 'break') {
      recentKit.push(kitBeatsOf(script))
      recentMotifs.push(motifBeatsOf(script))
    }
  }

  // Narrate every stop up front — cheap (no TTS yet), so the lint can see the whole
  // tour and regenerate outliers BEFORE we pay to synthesize. Breaks are narrated too
  // (named, mandatory audio) with cross-stop opener/closer context, but they're kept
  // OUT of the diversity lint + kit accounting below (short generic cues).
  const narratedRecs: { s: StopPlan; script: string }[] = []
  for (const s of plan) {
    console.log(`Narrating stop ${s.seq} (${s.stopType}) "${s.name}"...`)
    const { script } = await narrate(s)
    rememberStop(s, script)
    narratedRecs.push({ s, script })
  }

  // Post-assembly diversity lint: regenerate cross-stop outliers (Anthropic only,
  // still no TTS). Each flagged stop is re-narrated with the finding's `avoid` notes
  // plus FULL awareness of every OTHER stop's opener/closer/kit (not just the
  // trailing-3 window). A regen failure or a stubborn finding falls back to the
  // current script, so the lint can never block a valid tour.
  // Breaks are excluded from the diversity lint — short generic cues, and the kit
  // detector's /coffee/ would misfire on a café break inviting a coffee.
  const lintInputs = () =>
    narratedRecs
      .filter((r) => r.s.stopType !== 'break')
      .map((r) => ({ seq: r.s.seq, stopType: r.s.stopType, script: r.script }))
  const regenForFindings = async (findings: LintFinding[]) => {
    for (const f of findings) {
      const rec = narratedRecs.find((r) => r.s.seq === f.seq)
      if (!rec) continue
      console.log(`  regen stop ${f.seq} (${rec.s.name}): ${f.reasons.join('; ')}`)
      const others = narratedRecs.filter((r) => r.s.seq !== f.seq)
      try {
        const { script } = await narrateStop(
          {
            ...baseReq(rec.s),
            recentOpeners: others.map((r) => openerOf(r.script)),
            recentClosers: others.map((r) => closerOf(r.script)),
            recentKitBeats: [
              ...new Set(
                others.filter((r) => r.s.stopType !== 'break').flatMap((r) => kitBeatsOf(r.script)),
              ),
            ],
            recentMotifs: [
              ...new Set(
                others.filter((r) => r.s.stopType !== 'break').flatMap((r) => motifBeatsOf(r.script)),
              ),
            ],
            avoid: f.avoid,
          },
          persona.systemPrompt,
        )
        // Accept the regen ONLY if it doesn't INCREASE this stop's deterministic lint
        // findings. A later round or the closer-judge pass must never trade one tic for
        // another (observed: a closer-fix regen reintroducing a banned wind-up). This
        // makes "kept best available" actually keep the cleaner take, not just the latest.
        const inputs = lintInputs()
        const before = lintScripts(inputs, persona.kit).filter((x) => x.seq === rec.s.seq).length
        const candidate = inputs.map((r) => (r.seq === rec.s.seq ? { ...r, script } : r))
        const after = lintScripts(candidate, persona.kit).filter((x) => x.seq === rec.s.seq).length
        if (after <= before) rec.script = script
        else
          console.warn(
            `  stop ${f.seq} regen would add findings (${before}→${after}) — keeping previous take.`,
          )
      } catch (e) {
        console.warn(`  stop ${f.seq} regen failed (${(e as Error).message}) — keeping original.`)
      }
    }
  }

  // 4 rounds (was 2): long-form stops surface more per-stop findings (tic-stacking,
  // list shape, tidy bows) that can take extra regens to fully clear, and the
  // accept-only-if-not-worse guard above can hold a take across a round. Still cheap
  // (Anthropic only, no TTS) and each round is a no-op once the lint comes back clean.
  const LINT_ROUNDS = 4
  for (let round = 0; round < LINT_ROUNDS; round++) {
    const findings = lintScripts(lintInputs(), persona.kit)
    if (findings.length === 0) break
    console.log(`Diversity lint (round ${round + 1}): ${findings.length} stop(s) flagged.`)
    await regenForFindings(findings)
  }

  // Optional semantic-closer judge (one extra model call): catches closing-move
  // monotony the deterministic lint can't see — e.g. several stops personifying the
  // place in different words. Best-effort (a judge error never blocks the tour);
  // any regen it triggers is re-checked by one more deterministic lint pass.
  if (judgeClosers) {
    try {
      const judged = await judgeCloserDiversity(
        narratedRecs.map((r) => ({ seq: r.s.seq, script: r.script })),
      )
      if (judged.length > 0) {
        console.log(`Closer judge: ${judged.length} stop(s) flagged for closing-move monotony.`)
        await regenForFindings(judged)
        const after = lintScripts(lintInputs(), persona.kit)
        if (after.length > 0) await regenForFindings(after)
      } else {
        console.log('Closer judge: closers are varied.')
      }
    } catch (e) {
      console.warn(`Closer judge skipped (${(e as Error).message}).`)
    }
  }
  const stillFlagged = lintScripts(lintInputs(), persona.kit)
  console.log(
    stillFlagged.length === 0
      ? 'Diversity lint: clean.'
      : `Diversity lint: ${stillFlagged.length} finding(s) remain after ${LINT_ROUNDS} rounds (kept best available).`,
  )
  const scriptBySeq = new Map(narratedRecs.map((r) => [r.s.seq, r.script]))

  // Intro + outro brackets — the drive's FRAME (persona-only, no fact sheet). The
  // personal KIT, banned from stops, lives in the intro; the sentimental bow in the
  // outro. Mandatory (the ready-gate requires both), so a narration failure aborts.
  console.log('Narrating intro + outro brackets...')
  const introScript = (
    await narrateIntro(
      {
        region: shell.regionName,
        startAnchor: shell.startAnchorName,
        endAnchor: shell.endAnchorName,
        jokeLevel,
        headline: shell.headline,
        hostName: persona.hostName,
      },
      persona.bracketPrompt,
    )
  ).script
  const outroScript = (
    await narrateOutro(
      {
        region: shell.regionName,
        endAnchor: shell.endAnchorName,
        jokeLevel,
      },
      persona.bracketPrompt,
    )
  ).script
  const bracketPlan: { kind: BracketKind; script: string }[] = [
    { kind: 'intro', script: introScript },
    { kind: 'outro', script: outroScript },
  ]

  // ---- Dry run: print finalized scripts, no writes. -----------------------
  if (dryRun) {
    // Every stop now has a script (breaks included) — print them all so the named
    // break narration can be eyeballed before any TTS spend.
    const stops: StopSummary[] = plan.map((s) => ({
      seq: s.seq,
      stopType: s.stopType,
      name: s.name,
      alongSec: s.alongSec,
      ...(s.sideOfRoad ? { sideOfRoad: s.sideOfRoad } : {}),
      script: scriptBySeq.get(s.seq),
      // STORY carries the exact (deepened) fact sheet so the dry-run artifact can be
      // audited script-vs-sheet; SCENIC/BREAK have no Wikipedia facts by construction.
      ...(s.stopType === 'story' ? { facts: s.facts } : {}),
      // Geology (story + scenic) and Wikidata (story) are part of the well too — surface for the audit.
      ...(s.geology?.length ? { geology: s.geology } : {}),
      ...(s.wikidata?.length ? { wikidata: s.wikidata } : {}),
    }))
    return {
      slug: shell.slug,
      tourName: shell.headline,
      region: shell.regionName,
      durationBucket,
      totalSec,
      dryRun: true,
      stops,
      brackets: bracketPlan.map((b) => ({ kind: b.kind, script: b.script })),
    }
  }

  // ---- Full run: narrate -> TTS -> R2 -> persist -> atomic ready-gate. -----
  // The tour SHELL already exists (seeded draft); we FILL it. Stop clip ids are
  // generated up front so the key (clips/<tourId>/<stopId>) is known before upload,
  // and the fully-populated rows land in one atomic ready-gate batch.
  const tourId = shell.id
  await markTourGenerating(tourId, Boolean(opts.preview))
  try {
    const finalStops: FinalStop[] = []
    const finalBrackets: FinalBracket[] = []
    const summaries: StopSummary[] = []

    for (const s of plan) {
      // Every stop anchors to a POI (break stops included). Story stops carry facts;
      // the facts_hash is the narration's grounding fingerprint (staleness detector).
      const facts =
        s.stopType === 'story'
          ? { extract: s.facts.join(' '), title: s.wikiTitle, url: s.wikiUrl, pageId: s.wikiPageId }
          : null
      const factsHash = hashFacts(facts)
      const poiId = await upsertPoi({
        source: s.source,
        sourceId: s.sourceId,
        name: s.name,
        kind: s.kind,
        lat: s.lat,
        lng: s.lng,
        summary: s.stopType === 'story' ? firstSentence(s.facts) : null,
        facts,
        factsHash,
      })

      // Every stop — break included — now narrates + synthesizes to a TOUR-scoped key.
      // (Break clips name the curated Places anchor; no Wikipedia text, no attribution.)
      const stopId = crypto.randomUUID()
      const script = scriptBySeq.get(s.seq)!
      console.log(`Synthesizing stop ${s.seq} (${s.stopType}) "${s.name}"...`)
      const { audio, durationMs } = await synthesize(script, persona.voice, persona.ttsStyle)
      const audioUrl = await uploadAudio(clipKey(tourId, stopId), audio)

      // Frozen attribution — an ARRAY, one entry per source this clip drew on. Story
      // clips reuse Wikipedia extract text (CC BY-SA, required). Any stop — story OR
      // scenic — that got Macrostrat geology carries a CC BY entry too; a sparse story
      // enriched with Wikidata facts carries a CC0 entry. A scenic/break clip with no
      // geology and no Wikidata draws on no external text, so its attribution stays null.
      const attribution: AttributionSnapshot[] = []
      if (s.stopType === 'story') {
        attribution.push({
          source: 'wikipedia',
          sourceId: String(s.wikiPageId),
          title: s.wikiTitle,
          url: s.wikiUrl,
          license: 'CC BY-SA 4.0',
          retrievedAt: new Date().toISOString(),
        })
      }
      if (s.geologyAttribution) attribution.push(s.geologyAttribution)
      if (s.wikidataAttribution) attribution.push(s.wikidataAttribution)

      finalStops.push({
        id: stopId,
        seq: s.seq,
        poiId,
        stopType: s.stopType,
        script,
        audioUrl,
        audioDurationMs: durationMs,
        attribution: attribution.length > 0 ? attribution : null,
        // Only fact-grounded (story) stops carry a facts_hash → only they can go fact-stale.
        factsHash: s.stopType === 'story' ? factsHash : null,
        triggerRadiusM: s.triggerRadiusM,
        triggerLat: s.triggerLat,
        triggerLng: s.triggerLng,
        approachHeadingDeg: s.approachHeadingDeg,
      })
      summaries.push({
        seq: s.seq,
        stopType: s.stopType,
        name: s.name,
        alongSec: s.alongSec,
        ...(s.sideOfRoad ? { sideOfRoad: s.sideOfRoad } : {}),
        script,
        // Carry the STORY fact sheet so the SERVED tour's scripts can be audited
        // (grounding) straight from the result JSON, same as the dry-run artifact.
        ...(s.stopType === 'story' ? { facts: s.facts } : {}),
        ...(s.geology?.length ? { geology: s.geology } : {}),
        ...(s.wikidata?.length ? { wikidata: s.wikidata } : {}),
        durationMs,
        audioUrl,
      })
    }

    // Synthesize the brackets to their fixed tour-scoped keys (clips/<tourId>/intro|outro).
    const bracketSummaries: BracketSummary[] = []
    for (const b of bracketPlan) {
      console.log(`Synthesizing ${b.kind} bracket...`)
      const { audio, durationMs } = await synthesize(b.script, persona.voice, persona.ttsStyle)
      const audioUrl = await uploadAudio(bracketKey(tourId, b.kind), audio)
      finalBrackets.push({ kind: b.kind, script: b.script, audioUrl, audioDurationMs: durationMs })
      bracketSummaries.push({ kind: b.kind, script: b.script, durationMs })
    }

    // Ready-gate guard: EVERY stop must have audio before we flip — breaks included
    // (break audio is mandatory; a tour never goes ready with a silent stop). The
    // intro/outro bracket audio is enforced inside finalizeTourReady.
    for (const fs of finalStops) {
      if (!fs.audioUrl) {
        throw new Error(
          `Stop ${fs.seq} (${fs.stopType}) has no audio — refusing to mark tour ready.`,
        )
      }
    }

    await finalizeTourReady(tourId, finalStops, finalBrackets)
    console.log(
      `Tour ${tourId} is READY (${finalStops.length} stops, ${finalBrackets.length} brackets).`,
    )
    return {
      tourId,
      slug: shell.slug,
      tourName: shell.headline,
      region: shell.regionName,
      durationBucket,
      totalSec,
      dryRun: false,
      stops: summaries,
      brackets: bracketSummaries,
    }
  } catch (e) {
    await markTourFailed(tourId).catch(() => {})
    throw e
  }
}
