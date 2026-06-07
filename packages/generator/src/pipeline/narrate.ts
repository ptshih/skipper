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
// top_k / budget_tokens (all 400). Output is short (~a 30s script), so a single
// non-streaming messages.create is right; max_tokens is generous because adaptive
// thinking tokens count against it. A refusal or a max_tokens truncation is a HARD
// failure — we never persist a truncated or empty script (quality invariant).

import Anthropic from '@anthropic-ai/sdk'
import type { JokeLevel, StopType } from '@skipper/shared'
import { NARRATION_MODEL } from '../models'
import { SKIPPER_SYSTEM_PROMPT } from '../persona/skipper'

/** Generous ceiling: a 30s script is ~80 words (~120 tokens); the rest is adaptive-thinking headroom. */
const NARRATION_MAX_TOKENS = 8000

/** Spoken narration runs ~2.5 words/second; used only to translate a target duration into a word hint. */
const WORDS_PER_SECOND = 2.5

let cached: Anthropic | undefined

/**
 * Lazily build the Anthropic client on first use, so importing this module is
 * side-effect-free (ANTHROPIC_API_KEY is required only when narration runs) —
 * mirrors the lazy @skipper/db client.
 */
function getClient(): Anthropic {
  if (!cached) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not set (run via dotenvx -f .env.development).')
    }
    cached = new Anthropic()
  }
  return cached
}

export interface NarrationRequest {
  /** e.g. "Lake Tahoe". Naming the region is allowed without the sheet. */
  region: string
  /** e.g. "Emerald Bay Run". Naming/framing the corridor is allowed without the sheet. */
  corridor: string
  stopType: StopType
  jokeLevel: JokeLevel
  /** Required for STORY; omitted for SCENIC/BREAK (naming a place is a fact). */
  place?: { name: string; kind?: string | null }
  /** Grounded fact lines (STORY only). The entire well of facts the model may use. */
  facts?: string[]
  /** Only when actually known from the route geometry. */
  sideOfRoad?: 'left' | 'right'
  /** Pronunciation hint, e.g. "Genoa = JUH-noh-uh". */
  pronunciation?: string
  /** Short reminders of earlier stops, for earned callbacks. */
  priorStops?: string[]
  /** How the last few stops OPENED — so this stop can open differently (each call is independent). */
  recentOpeners?: string[]
  /** How the last few stops CLOSED — so this stop can close differently (each call is independent). */
  recentClosers?: string[]
  /** Personal-kit beats used in the last few stops (e.g. "the dock guy") — so this stop can avoid repeating them. */
  recentKitBeats?: string[]
  /** Pacing target; honored but never padded past the facts. */
  targetSeconds?: number
  /** Re-narration notes from the diversity lint — concrete things THIS take must avoid. */
  avoid?: string[]
}

export interface NarrationResult {
  script: string
  stopReason: string | null
  usage: { inputTokens: number; outputTokens: number }
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
    if (req.pronunciation) lines.push(`PRONUNCIATION: ${req.pronunciation}`)
    lines.push('')
    const facts = (req.facts ?? []).map((f) => f.trim()).filter(Boolean)
    if (facts.length > 0) {
      lines.push('FACT SHEET (the entire well of facts you may draw from — if it is not here, you do not know it):')
      for (const f of facts) lines.push(`- ${f}`)
    } else {
      // STORY requested but nothing groundable arrived: the system prompt tells the
      // Skipper to treat this as a scenic moment rather than invent a story.
      lines.push('FACT SHEET: (none — no real facts available. Treat this as a scenic moment; do not invent a story.)')
    }
  } else if (req.stopType === 'scenic') {
    lines.push('SCENIC stop — delivery only, NO facts. Point only at what is plainly, visibly there')
    lines.push('(light, water color, sky, the road). Do not name any peak, town, island, or landmark.')
  } else {
    // break
    lines.push('BREAK stop — a rest/food stop is coming up. Narrate it generically and timelessly.')
    lines.push('Do NOT name the business, its hours, prices, rating, or popularity; the specific spot is')
    lines.push('resolved fresh when the tour loads. No side of the road is given.')
  }

  if (req.priorStops && req.priorStops.length > 0) {
    lines.push('')
    lines.push('EARLIER STOPS (for earned callbacks only — never a fact you were not given):')
    for (const p of req.priorStops) lines.push(`- ${p}`)
  }

  if (req.recentOpeners && req.recentOpeners.length > 0) {
    lines.push('')
    lines.push('YOUR LAST FEW OPENERS (do NOT begin like any of these — open this stop a different way):')
    for (const o of req.recentOpeners) lines.push(`- "${o}..."`)
  }

  if (req.recentClosers && req.recentClosers.length > 0) {
    lines.push('')
    lines.push('YOUR LAST FEW CLOSINGS (do NOT end like any of these — close this stop a different way, and not on the personal kit if these did):')
    for (const c of req.recentClosers) lines.push(`- "...${c}"`)
  }

  if (req.recentKitBeats && req.recentKitBeats.length > 0) {
    lines.push('')
    lines.push('PERSONAL-KIT BEATS USED RECENTLY (spent — do NOT reuse these; the default stop mentions none of the kit at all):')
    for (const k of req.recentKitBeats) lines.push(`- ${k}`)
  }

  if (req.targetSeconds && req.targetSeconds > 0) {
    const words = Math.round(req.targetSeconds * WORDS_PER_SECOND)
    lines.push('')
    lines.push(
      `TARGET LENGTH: about ${req.targetSeconds} seconds read aloud (~${words} words). Honor it, but never pad past the facts.`,
    )
  }

  if (req.avoid && req.avoid.length > 0) {
    lines.push('')
    lines.push('REVISION NOTES — this is a re-narration to break up tour-wide repetition. Same facts, fresh take. You MUST:')
    for (const a of req.avoid) lines.push(`- ${a}`)
  }

  return lines.join('\n')
}

/** Narrate one stop. Throws on refusal or truncation — callers must not persist a bad script. */
export async function narrateStop(req: NarrationRequest): Promise<NarrationResult> {
  const client = getClient()
  const userMessage = buildFactSheet(req)

  const response = await client.messages.create({
    model: NARRATION_MODEL,
    max_tokens: NARRATION_MAX_TOKENS,
    thinking: { type: 'adaptive' }, // grounding adherence benefits from reasoning; effort defaults to high
    // System prompt is identical across every stop in a run — cache it so the
    // ~dozen stops after the first read it cheaply (no-op if under the cache min).
    system: [{ type: 'text', text: SKIPPER_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userMessage }],
  })

  if (response.stop_reason === 'refusal') {
    throw new Error(`Narration refused for ${describe(req)}: ${JSON.stringify(response.stop_details ?? {})}`)
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error(`Narration hit max_tokens (truncated) for ${describe(req)} — raise NARRATION_MAX_TOKENS.`)
  }

  const script = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()

  if (!script) {
    throw new Error(`Narration produced no text for ${describe(req)} (stop_reason=${response.stop_reason}).`)
  }

  return {
    script,
    stopReason: response.stop_reason,
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
  }
}

function describe(req: NarrationRequest): string {
  return req.stopType === 'story' ? `STORY "${req.place?.name ?? '?'}"` : `${req.stopType.toUpperCase()} stop`
}
