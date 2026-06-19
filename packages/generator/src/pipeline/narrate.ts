// Skipper narration — the Anthropic (claude-opus-4-8) call.
//
// The SYSTEM message is the static, hardened SKIPPER_SYSTEM_PROMPT. For each stop
// we send ONE user message: the grounded FACT SHEET plus the region/corridor,
// stop type, and joke notch. The model returns ONLY the words the Skipper says.
//
// Grounding is the cardinal invariant: persona lives in DELIVERY, never in FACTS.
// So the only place-facts that reach the model are the ones we put on the sheet
// (story stops). Scenic and break stops carry NO place-facts by construction —
// naming a peak/town/business is itself a fact the model was not given.
//
// Model constraints (Opus 4.8): adaptive thinking only — NO temperature / top_p /
// top_k / budget_tokens (all 400). We pass adaptive below. Output is modest (a story stop now targets a
// Shaka-length ~2 min telling, ~300 spoken words ≈ ~450 output tokens), so a single
// non-streaming messages.create is right; max_tokens is generous because adaptive
// thinking tokens count against it AND a long-form grounded telling reasons harder.
// A refusal or a max_tokens truncation is a HARD failure — we never persist a
// truncated or empty script (quality invariant), so size for the worst case.

import Anthropic from '@anthropic-ai/sdk'
import type { JokeLevel, StopType } from '@skipper/shared'
import { getAnthropic, NARRATION_MODEL } from '../models'
import { recordModelUsage } from './spend'
import { WORDS_PER_SECOND } from '../config'

/**
 * Generous ceiling. A long-form story script (~2 min ≈ ~300 words ≈ ~450 output
 * tokens) leaves the rest as adaptive-thinking headroom — and high-effort thinking
 * on a rich, grounded fact sheet can be substantial. A truncation throws (we never
 * persist a half script), so we size well above the worst plausible thinking+output.
 */
const NARRATION_MAX_TOKENS = 16000

export interface NarrationRequest {
  /** e.g. "Lake Tahoe". Naming the region is allowed without the sheet. */
  region: string
  /** e.g. "Emerald Bay Run". Naming/framing the corridor is allowed without the sheet. */
  corridor: string
  stopType: StopType
  jokeLevel: JokeLevel
  /** Required for STORY and BREAK (the curated, stable name + kind). OPTIONAL for SCENIC: a
   *  NAMED natural feature (a bay/beach) — its name + kind are sayable like a break's, no facts. */
  place?: { name: string; kind?: string | null }
  /** Grounded fact lines (STORY only). The entire well of facts the model may use. */
  facts?: string[]
  /** Coordinate-keyed geology facts (the rock underfoot). Grounded like `facts`; allowed on STORY and SCENIC. */
  geology?: string[]
  /** STORY only: why geology is here — 'sparse' (thin facts, round it out) or 'iconic' (rich stop, the rock is the headline). */
  geologyContext?: 'sparse' | 'iconic'
  /** STORY only: discrete Wikidata facts (a date, an elevation, a namesake). Grounded like `facts`. */
  wikidata?: string[]
  /** STORY only: co-located landmarks merged into this stop — each {name, facts}. Grounded;
   *  the narrator may name them and weave them into ONE telling of the place. */
  mergedFeatures?: { name: string; facts: string[] }[]
  /** Only when actually known from the route geometry. */
  sideOfRoad?: 'left' | 'right'
  /** Short reminders of earlier stops, for earned callbacks. */
  priorStops?: string[]
  /** How the last few stops OPENED — so this stop can open differently (each call is independent). */
  recentOpeners?: string[]
  /** How the last few stops CLOSED — so this stop can close differently (each call is independent). */
  recentClosers?: string[]
  /** Personal-kit beats used in the last few stops (e.g. "the mechanic") — so this stop can avoid repeating them. */
  recentKitBeats?: string[]
  /** Recurring frames / self-deprecation flavors already used THIS DRIVE (cumulative) — one-time bits, never reuse. */
  recentMotifs?: string[]
  /** Pacing target; honored but never padded past the facts. */
  targetSeconds?: number
  /** Hard upper cap on spoken length (s). A fact-rich place must not sprawl into a lecture; this
   *  only ever SHORTENS, so it composes with "never pad" (targetSeconds = the aim, this = the
   *  ceiling). Omit for a single-point target. */
  maxSeconds?: number
  /** Re-narration notes from the diversity lint — concrete things THIS take must avoid. */
  avoid?: string[]
  /** FREE-ROAM encounter framing (generate-narrations.ts): the telling is a one-off roadside
   *  encounter on an unplanned drive — fully self-contained, route-agnostic, no tour shape.
   *  Adds the encounter block to the sheet; all grounding rules are unchanged. */
  encounterFrame?: boolean
}

export interface NarrationResult {
  script: string
  stopReason: string | null
  usage: { inputTokens: number; outputTokens: number }
}

/**
 * The GEOLOGY block — coordinate-keyed bedrock facts (Macrostrat). These ARE on the
 * sheet, so they are sayable like any other fact (this is what makes "this point is
 * granite" grounded instead of invented). Allowed on STORY and, uniquely among fact
 * categories, on SCENIC — the rock underfoot is plainly there, names no landmark, and
 * is the one true thing an otherwise-factless stop may speak.
 */
function geologyLines(
  geology: string[] | undefined,
  stopType: StopType,
  context?: 'sparse' | 'iconic',
  namedScenic = false,
): string[] {
  const geo = (geology ?? []).map((g) => g.trim()).filter(Boolean)
  if (geo.length === 0) return []
  const out: string[] = [
    '',
    'GEOLOGY UNDERFOOT (grounded, from geologic maps — the rock you are driving through; treat these as facts on the sheet, sayable like any other):',
  ]
  for (const g of geo) out.push(`- ${g}`)
  if (stopType === 'scenic') {
    out.push(
      namedScenic
        ? '(On a SCENIC stop this is the ONE extra fact you may state. Beyond the named feature on your sheet you still name no OTHER peak, town, or island — only this feature, the rock, and its rough age, exactly as given. Invent nothing beyond these lines; speak the age as the rough range it is.)'
        : '(On a SCENIC stop this is the ONE thing you may state as fact. You still name no peak, town, island, or landmark — only the rock and its rough age, exactly as given. Invent nothing beyond these lines; speak the age as the rough range it is.)',
    )
  } else if (context === 'iconic') {
    // An allowlisted RICH stop where the rock IS the headline (Emerald Bay's granite): do NOT
    // tell it it's "light on facts" (it isn't) — tell it the geology is genuinely notable.
    out.push(
      '(The rock here is a genuinely notable part of what this place IS, so give it a real mention — woven into the telling, in your own words. Two rules: do NOT make it your closing line, and do NOT reach for the "deep time versus our brief human lives" reflection — that frame gets old fast. Land it mid-telling and end the stop on something else.)',
    )
  } else {
    // The default STORY case: supporting texture. The cue asserts nothing about the sheet's
    // thinness — the enrichment scout may attach supporting geology to a rich telling too,
    // and a "you're light on facts" premise would then be false. Same two bans, to kill the
    // monotony seen when every stop got geology.
    out.push(
      '(The rock here is good supporting material — work a little of it in where it fits, in your own words. Two rules: do NOT make it your closing line, and do NOT reach for the "deep time versus our brief human lives" reflection — that frame gets old fast. Land it mid-telling and end the stop on something else.)',
    )
  }
  return out
}

/**
 * The KEY FACTS block — discrete, verified Wikidata statements (a date, an elevation, a
 * namesake). These ARE on the sheet, so they are sayable like any other fact. STORY-only
 * (a date/elevation/namesake identifies the place, so it can't ride a SCENIC stop the way
 * geology — which names no landmark — can). They are handed over BECAUSE the stop's own
 * prose is thin, so the model is nudged to weave them in rather than leave them optional.
 */
function wikidataLines(wikidata: string[] | undefined): string[] {
  const wd = (wikidata ?? []).map((w) => w.trim()).filter(Boolean)
  if (wd.length === 0) return []
  const out: string[] = [
    '',
    'KEY FACTS (grounded, from Wikidata — discrete, verified facts about this place; treat these as facts on the sheet, sayable like any other):',
  ]
  for (const w of wd) out.push(`- ${w}`)
  out.push(
    '(These are exact, dependable facts the rest of your sheet is thin on — a date, an elevation, a namesake. Work any that fit naturally into your telling, in your own words; do not invent beyond them, and do not let them become your closing line.)',
  )
  return out
}

/**
 * The ALSO-AT-THIS-STOP block — landmarks that sit right here with the main place (folded in
 * from the co-located cluster). Each is grounded by its own facts, so the narrator MAY name it
 * and weave it in — the whole point is to cover the highlight (e.g. Emerald Bay AND its castle,
 * island, and falls) as ONE flowing telling, not several stops. Same grounding rule: only what
 * is listed here is known.
 */
function mergedFeatureLines(features: { name: string; facts: string[] }[] | undefined): string[] {
  const fs = (features ?? []).filter((f) => f.name && f.facts.length > 0)
  if (fs.length === 0) return []
  const out: string[] = [
    '',
    'ALSO RIGHT HERE — landmarks at this same stop (grounded; you MAY name each and weave them into ONE telling of this place, not separate asides — only what is listed is known):',
  ]
  for (const f of fs) {
    out.push(`• ${f.name}:`)
    for (const fact of f.facts) out.push(`    - ${fact}`)
  }
  out.push(
    '(Cover these as part of the SAME stop — the place plus its notable features — in one flowing pass. Name them freely; invent nothing beyond their facts above.)',
  )
  return out
}

/** Build the per-stop USER fact sheet, matching the system prompt's "Reading the fact sheet" contract. */
export function buildFactSheet(req: NarrationRequest): string {
  const lines: string[] = []
  lines.push(`REGION: ${req.region}`)
  lines.push(`CORRIDOR: ${req.corridor}`)
  lines.push(`STOP TYPE: ${req.stopType.toUpperCase()}`)
  lines.push(`JOKE NOTCH: ${req.jokeLevel.toUpperCase()}`)
  lines.push('')

  if (req.stopType === 'story') {
    lines.push(`PLACE: ${req.place?.name ?? '(unnamed)'}`)
    if (req.place?.kind) lines.push(`KIND: ${req.place.kind}`)
    if (req.sideOfRoad) lines.push(`SIDE OF ROAD: on the ${req.sideOfRoad}`)
    lines.push('')
    const facts = (req.facts ?? []).map((f) => f.trim()).filter(Boolean)
    if (facts.length > 0) {
      lines.push(
        'FACT SHEET (the entire well of facts you may draw from — if it is not here, you do not know it):',
      )
      for (const f of facts) lines.push(`- ${f}`)
    } else {
      // STORY requested but nothing groundable arrived: the system prompt tells the
      // Skipper to treat this as a scenic moment rather than invent a story.
      lines.push(
        'FACT SHEET: (none — no real facts available. Treat this as a scenic moment; do not invent a story.)',
      )
    }
    for (const l of geologyLines(req.geology, 'story', req.geologyContext)) lines.push(l)
    for (const l of wikidataLines(req.wikidata)) lines.push(l)
    for (const l of mergedFeatureLines(req.mergedFeatures)) lines.push(l)
  } else if (req.stopType === 'scenic') {
    const namedScenic = Boolean(req.place?.name)
    if (namedScenic) {
      lines.push(`PLACE: ${req.place!.name}`)
      if (req.place!.kind) lines.push(`KIND: ${req.place!.kind}`)
      if (req.sideOfRoad) lines.push(`SIDE OF ROAD: on the ${req.sideOfRoad}`)
      lines.push('')
      lines.push(
        'SCENIC stop, NAMED — a natural feature you are passing. You MAY name the PLACE above and say',
      )
      lines.push(
        'what KIND it is (a bay, a beach, a cove — plainly), and which side it is on. That is ALL the',
      )
      lines.push(
        'name buys you: no history, no how it got its name, no size/depth/temperature, no "famous",',
      )
      lines.push(
        '"popular", "hidden gem", or "local favorite", no who owns it, no events. Naming it is not',
      )
      lines.push(
        'license to assert what the name implies, and you cannot see THIS feature, so do not hand it a',
      )
      lines.push(
        "specific (its sand, its boulders, its crowds): the water's general blue and the light are",
      )
      lines.push(
        "everyone's to see; this named feature's particulars are not. Name it, gesture at it, react to the",
      )
      lines.push('plain look of the water and sky in your own voice, and stop — a glance, not a story.')
    } else {
      lines.push(
        'SCENIC stop — delivery only, NO place-facts. Point only at what is plainly, visibly there',
      )
      lines.push(
        '(light, water color, sky, the road). Do not name any peak, town, island, or landmark.',
      )
    }
    for (const l of geologyLines(req.geology, 'scenic', undefined, namedScenic)) lines.push(l)
  } else {
    // break — the curated name + kind ARE given and sayable; everything volatile is not.
    lines.push(`PLACE: ${req.place?.name ?? '(unnamed)'}`)
    if (req.place?.kind) lines.push(`KIND: ${req.place.kind}`)
    lines.push('')
    lines.push(
      'BREAK stop — a rest/food spot is coming up. You MAY name the PLACE above and say what KIND',
    )
    lines.push(
      'it is (plainly). You may NOT add anything else about THIS spot — no hours, prices, rating,',
    )
    lines.push(
      'popularity, menu, quality, character adjectives (cozy/charming/little/family-run), or physical',
    )
    lines.push(
      'features (where it sits, its deck, its view). Naming it is not license to assert what the name',
    )
    lines.push(
      'describes (a Lakeview Café gets no view). Name it, give a generic invitation (pull over, stretch,',
    )
    lines.push(
      'fuel, a bite), and stop there. Live details resolved fresh at tour-load. No side of the road.',
    )
  }

  if (req.encounterFrame) {
    lines.push('')
    lines.push(
      'FREE-ROAM ENCOUNTER — this is NOT a tour stop. The rider is out on their OWN drive (an errand, a wander — no planned route), and you are riding shotgun, piping up because you are passing a place you know. The telling must be fully SELF-CONTAINED: no welcome-aboard, no tour framing, no "next stop" or "later on this drive", no promising anything else, no callbacks to other stops. You do NOT know the direction of travel or which side of the road the place is on — never name a side, never say "behind us" or "up ahead on the left"; "coming up", "just out there", and "right about here" are fine. Open on the place or its best fact, land your best bit, and get out clean — a good minute, not a chapter.',
    )
  }

  if (req.priorStops && req.priorStops.length > 0) {
    lines.push('')
    lines.push('EARLIER STOPS (for earned callbacks only — never a fact you were not given):')
    for (const p of req.priorStops) lines.push(`- ${p}`)
  }

  if (req.recentOpeners && req.recentOpeners.length > 0) {
    lines.push('')
    lines.push(
      'YOUR LAST FEW OPENERS (do NOT begin like any of these — open this stop a different way):',
    )
    for (const o of req.recentOpeners) lines.push(`- "${o}..."`)
  }

  if (req.recentClosers && req.recentClosers.length > 0) {
    lines.push('')
    lines.push(
      'YOUR LAST FEW CLOSINGS (do NOT end like any of these — close this stop a different way, and not on the personal kit if these did):',
    )
    for (const c of req.recentClosers) lines.push(`- "...${c}"`)
  }

  if (req.recentKitBeats && req.recentKitBeats.length > 0) {
    lines.push('')
    lines.push(
      'PERSONAL-KIT BEATS USED RECENTLY (spent — do NOT reuse these; the default stop mentions none of the kit at all):',
    )
    for (const k of req.recentKitBeats) lines.push(`- ${k}`)
  }

  if (req.recentMotifs && req.recentMotifs.length > 0) {
    lines.push('')
    lines.push(
      'BITS ALREADY SPENT ON THIS DRIVE (a worn frame or a self-deprecation flavor an earlier stop used — each is a ONE-TIME bit; do NOT reach for any of these again, even reworded. If your facts hand you one of these, state the fact plainly and find your joke elsewhere, or skip the joke):',
    )
    for (const m of req.recentMotifs) lines.push(`- ${m}`)
  }

  if (req.targetSeconds && req.targetSeconds > 0) {
    const words = Math.round(req.targetSeconds * WORDS_PER_SECOND)
    lines.push('')
    if (req.maxSeconds && req.maxSeconds > req.targetSeconds) {
      const maxWords = Math.round(req.maxSeconds * WORDS_PER_SECOND)
      lines.push(
        `TARGET LENGTH: aim for about ${req.targetSeconds} seconds read aloud (~${words} words), and NEVER exceed ${req.maxSeconds} seconds (~${maxWords} words) — once the facts are spent, stop. A shorter, fully-grounded telling beats a stretched one; never pad past the facts to reach the aim.`,
      )
    } else {
      lines.push(
        `TARGET LENGTH: about ${req.targetSeconds} seconds read aloud (~${words} words). Honor it, but never pad past the facts.`,
      )
    }
  }

  if (req.avoid && req.avoid.length > 0) {
    lines.push('')
    lines.push(
      'REVISION NOTES — this is a re-narration to break up tour-wide repetition. Same facts, fresh take. You MUST:',
    )
    for (const a of req.avoid) lines.push(`- ${a}`)
  }

  return lines.join('\n')
}

/**
 * Shared narration call — a system prompt + ONE user message → the script. Throws on
 * refusal, truncation, or empty output (callers must NEVER persist a bad script). The
 * system prompt is cached (cache_control) so a run's later calls read it cheaply.
 */
async function runNarration(
  system: string,
  userMessage: string,
  label: string,
): Promise<NarrationResult> {
  const client = getAnthropic('run via dotenvx -f .env.development')
  const response = await client.messages.create({
    model: NARRATION_MODEL,
    max_tokens: NARRATION_MAX_TOKENS,
    thinking: { type: 'adaptive' }, // grounding adherence benefits from reasoning; effort defaults to high
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userMessage }],
  })
  recordModelUsage(NARRATION_MODEL, response.usage)

  if (response.stop_reason === 'refusal') {
    throw new Error(`Narration refused for ${label}: ${JSON.stringify(response.stop_details ?? {})}`)
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error(`Narration hit max_tokens (truncated) for ${label} — raise NARRATION_MAX_TOKENS.`)
  }

  const script = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()

  if (!script) {
    throw new Error(`Narration produced no text for ${label} (stop_reason=${response.stop_reason}).`)
  }

  return {
    script,
    stopReason: response.stop_reason,
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
  }
}

/** Narrate one stop with the persona's stop system prompt. Throws on refusal/truncation —
 *  callers must not persist a bad script. */
export async function narrateStop(
  req: NarrationRequest,
  systemPrompt: string,
): Promise<NarrationResult> {
  return runNarration(systemPrompt, buildFactSheet(req), describe(req))
}

function describe(req: NarrationRequest): string {
  return req.stopType === 'scenic'
    ? 'SCENIC stop'
    : `${req.stopType.toUpperCase()} "${req.place?.name ?? '?'}"`
}

/* -------------------------------------------------------------------------- */
/*  Intro / outro frames (Option B: the drive's FRAME, not stops)            */
/*                                                                             */
/*  Persona-only, NO fact sheet — they assert no place-fact (they NAME + FRAME  */
/*  the region/endpoints only). The personal KIT, banned from stops, lives in   */
/*  the intro; the sentimental bow lives in the outro. Persistence is to         */
/*  `tour_frames` (placeless), never a segment/track.                           */
/* -------------------------------------------------------------------------- */

export interface IntroRequest {
  /** e.g. "Lake Tahoe". Named + framed, never asserted as a fact. */
  region: string
  /** Descriptive START endpoint, e.g. "Tahoe City" (for destination + direction framing). */
  startAnchor: string
  /** Descriptive END endpoint, e.g. "South Lake Tahoe". */
  endAnchor: string
  jokeLevel: JokeLevel
  /** Optional: what this drive is "about" (the family headline, e.g. "Emerald Bay"). */
  headline?: string
  /** Optional: the host's display name, for "meet your host" (e.g. "Skipper"). */
  hostName?: string
}

export interface OutroRequest {
  region: string
  /** The arrival endpoint to name, e.g. "South Lake Tahoe". */
  endAnchor: string
  jokeLevel: JokeLevel
}

/** Build the INTRO frame's user message (position-agnostic; destination + direction). */
export function buildIntroSheet(req: IntroRequest): string {
  const lines: string[] = []
  lines.push('FRAME: INTRO (the welcome — plays when the drive STARTS; position-agnostic)')
  lines.push(`REGION: ${req.region}`)
  if (req.headline) lines.push(`THIS DRIVE: ${req.headline}`)
  lines.push(`FROM: ${req.startAnchor}`)
  lines.push(`TO: ${req.endAnchor}`)
  lines.push(`JOKE NOTCH: ${req.jokeLevel.toUpperCase()}`)
  if (req.hostName) lines.push(`YOUR NAME: ${req.hostName}`)
  lines.push('')
  lines.push(
    'Welcome the folks aboard and set the trip\'s shape by DESTINATION + DIRECTION (from where, to where, descriptively — NEVER "you are now at ..."; they may be anywhere). Land ONE big standalone personal KIT joke — this doubles as "meet your host". End pointing down the road; no bow. Assert NO place-fact: name and frame only.',
  )
  return lines.join('\n')
}

/** Build the OUTRO frame's user message (arrive + warm sign-off). */
export function buildOutroSheet(req: OutroRequest): string {
  const lines: string[] = []
  lines.push('FRAME: OUTRO (the sign-off — plays on arrival / tour-end)')
  lines.push(`REGION: ${req.region}`)
  lines.push(`ARRIVING AT: ${req.endAnchor}`)
  lines.push(`JOKE NOTCH: ${req.jokeLevel.toUpperCase()}`)
  lines.push('')
  lines.push(
    'Bring the drive in: name the arrival anchor, give the warm SIGN-OFF (the sentimental bow lives HERE, and only here), and land a notch-scaled closing groaner. Send them off warm. Assert NO place-fact: name and frame only.',
  )
  return lines.join('\n')
}

/** Narrate the INTRO frame with the persona's frame prompt. Persona-only, no fact sheet. */
export async function narrateIntro(
  req: IntroRequest,
  framePrompt: string,
): Promise<NarrationResult> {
  return runNarration(framePrompt, buildIntroSheet(req), `INTRO (${req.region})`)
}

/** Narrate the OUTRO frame with the persona's frame prompt. Persona-only, no fact sheet. */
export async function narrateOutro(
  req: OutroRequest,
  framePrompt: string,
): Promise<NarrationResult> {
  return runNarration(framePrompt, buildOutroSheet(req), `OUTRO (${req.region})`)
}
