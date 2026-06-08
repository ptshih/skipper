// Voice & charm harness — the "is the persona actually charming?" check.
//
// "THE PERSONA IS THE PRODUCT," yet the Skipper's CHARM (writing + the Sulafat TTS
// voice) has never been judged. This reads a generate-result JSON (`run.ts --json=...`)
// and produces ONE markdown report with two verdicts:
//   1. WRITING (automated) — an LLM charm-judge (Opus) scores every stop's SCRIPT for
//      charm and flags where it sags. Charm only; grounding is a separate gate.
//   2. VOICE (your ears) — each clip is paired with a playable presigned link + a
//      blank rating line, because a script can be charming on the page and the TTS can
//      flatten it. Only a human can judge the voice.
//
// Usage (env via dotenvx — ANTHROPIC_API_KEY for the judge, R2_* to presign audio):
//   # writing-only (cheap, no audio — works on a --dry-run JSON):
//   dotenvx run -f .env.development -- bun packages/generator/src/run.ts emerald-bay-run --dry-run --json=/tmp/tour.json
//   dotenvx run -f .env.development -- bun packages/generator/src/judge-voice.ts /tmp/tour.json --out=/tmp/voice.md
//   # writing + voice (full run gives audioUrls to presign):
//   dotenvx run -f .env.development -- bun packages/generator/src/run.ts emerald-bay-run --json=/tmp/tour.json
//   dotenvx run -f .env.development -- bun packages/generator/src/judge-voice.ts /tmp/tour.json --out=/tmp/voice.md

import Anthropic from '@anthropic-ai/sdk'
import { NARRATION_MODEL } from './models'
import type { GenerateResult, StopSummary } from './pipeline/generate'
import { presignGet } from './pipeline/storage'

interface StopVerdict {
  seq: number
  charm: number // 1-10
  best: string // the beat that works (short quote/paraphrase)
  sag: string // where it falls flat (short)
}
interface CharmVerdict {
  stops: StopVerdict[]
  overall: number // 1-10
  verdict: string
  recommendation: 'ship' | 'tune' | 'rework'
  weakestStops: number[]
  biggestRisk: string
}

const CHARM_SYSTEM = `You are a tough, tasteful editor judging an AI-narrated road-trip tour for ONE thing: CHARM. The product's whole thesis is "the persona is the product" — the voice is a warm, corny road-trip tour guide with the soul of a Jungle-Cruise ride skipper — a deadpan, pun-cracking showman narrating a drive (he is NOT a boat captain; the car-as-boat framing is retired, so flag nautical conceits as off-persona). The default joke notch is "dadpocalypse" (dense, proud dad jokes). You are reading the WORDS of each stop (the TTS voice is judged separately, by ear).

Judge CHARM, not accuracy — grounding is a different gate; assume the facts are fine. Be HONEST and skeptical: competent is NOT charming. The bar is a real passenger reaction — a smile, a fond eye-roll/groan, a "huh, really" — versus the failure mode of a capable AI reading Wikipedia with a captain's hat glued on. Reward: genuine warmth and earnestness that means it, dad jokes that land the right GROAN (corny on purpose, not clever), surprise, a distinct human voice, fresh openers/closers. Penalize: travel-brochure voice, AI-chatbot tics, the encyclopedia shape (topic sentence → facts → reflective bow), jokes that try too hard or don't land or are absent where the notch calls for them, sameyness across stops, and anything that sounds generated rather than spoken by a specific man.

Judge each stop appropriately for its TYPE: STORY is the showcase (it should charm); SCENIC is a short mood beat with no facts (judge the feeling, not jokes); BREAK is a brief named "good spot to pull off" cue (judge warmth + a light groan, keep expectations low).

For each stop give: a charm score 1-10, the single BEST beat (quote or tight paraphrase), and where it SAGS (the weakest beat — be specific). Then for the whole tour: an overall 1-10, an honest 2-3 sentence verdict, a recommendation, the weakest stops, and the SINGLE biggest charm risk. recommendation: "ship" = charming enough to bet the player on; "tune" = good bones, specific fixes needed; "rework" = reads as competent AI, not the skipper. Default toward "tune"/"rework" unless it genuinely delights — a generous score here is a disservice. Call the report tool.`

const REPORT_TOOL: Anthropic.Tool = {
  name: 'report',
  description: 'Report per-stop charm scores and the tour-level verdict.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['stops', 'overall', 'verdict', 'recommendation', 'weakestStops', 'biggestRisk'],
    properties: {
      stops: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['seq', 'charm', 'best', 'sag'],
          properties: {
            seq: { type: 'integer' },
            charm: { type: 'integer', minimum: 1, maximum: 10 },
            best: { type: 'string', description: 'the beat that works (short quote/paraphrase)' },
            sag: { type: 'string', description: 'the weakest beat — specific' },
          },
        },
      },
      overall: { type: 'integer', minimum: 1, maximum: 10 },
      verdict: {
        type: 'string',
        description: '2-3 honest sentences on whether the persona charms',
      },
      recommendation: { type: 'string', enum: ['ship', 'tune', 'rework'] },
      weakestStops: { type: 'array', items: { type: 'integer' } },
      biggestRisk: { type: 'string', description: 'the single biggest charm risk, one line' },
    },
  },
}

async function judgeCharm(stops: StopSummary[]): Promise<CharmVerdict> {
  if (!process.env.ANTHROPIC_API_KEY)
    throw new Error('ANTHROPIC_API_KEY is not set (the charm judge needs it).')
  const userMessage = stops
    .map((s) => `[stop ${s.seq}] ${s.stopType.toUpperCase()} — ${s.name}\n${s.script}`)
    .join('\n\n')

  const response = await new Anthropic().messages.create({
    model: NARRATION_MODEL,
    max_tokens: 8_000,
    system: CHARM_SYSTEM,
    tools: [REPORT_TOOL],
    tool_choice: { type: 'tool', name: 'report' },
    messages: [
      { role: 'user', content: `Every narrated stop on the tour, in order:\n\n${userMessage}` },
    ],
  })
  const call = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  if (!call) throw new Error('Charm judge returned no structured report.')
  return call.input as CharmVerdict
}

const RECO_LABEL: Record<CharmVerdict['recommendation'], string> = {
  ship: '✅ SHIP — charming enough to bet the player on',
  tune: '🛠 TUNE — good bones, specific fixes needed',
  rework: '🔁 REWORK — reads as competent AI, not the skipper',
}

function buildReport(r: GenerateResult, v: CharmVerdict): string {
  const bySeq = new Map(v.stops.map((s) => [s.seq, s]))
  const out: string[] = []
  out.push(`# Voice & charm report — ${r.corridor} (${r.region}) · ${r.durationBucket}`)
  if (r.tourId) out.push(`tour: ${r.tourId}`)
  out.push('')
  out.push('## The bet: is the persona charming enough to build the player on?')
  out.push(`**Judge — the writing (Opus):** ${v.overall}/10 · ${RECO_LABEL[v.recommendation]}`)
  out.push(`> ${v.verdict}`)
  out.push(`- Weakest stops: ${v.weakestStops.length ? v.weakestStops.join(', ') : '—'}`)
  out.push(`- Biggest charm risk: ${v.biggestRisk}`)
  out.push('')
  out.push('**Your call — the VOICE (your ears):**  ⬜ ship  ⬜ tune  ⬜ rework')
  out.push(
    '> The judge graded the WORDS. You grade the SULAFAT VOICE: play each clip and ask — warm corny human, or an AI in a captain’s hat? Do the jokes get room to breathe? Where does it sound robotic / rushed / flat? Rate each clip 1-5 and fill the overall above.',
  )
  out.push('')
  out.push('## Stops')
  for (const s of r.stops) {
    if (!s.script) continue
    const j = bySeq.get(s.seq)
    const len = s.durationMs ? ` · ${(s.durationMs / 1000).toFixed(1)}s` : ''
    const charm = j ? ` · charm ${j.charm}/10` : ''
    out.push(
      `\n### [${String(s.seq).padStart(2, '0')}] ${s.stopType.toUpperCase()} · ${s.name}${len}${charm}`,
    )
    out.push(`> ${s.script.replace(/\n/g, '\n> ')}`)
    if (s.audioUrl) {
      try {
        out.push(`🔊 ${presignGet(s.audioUrl, 12 * 60 * 60)}`) // 12h TTL — time to listen
      } catch {
        out.push(`🔊 (R2 key ${s.audioUrl} — set R2_* env to presign a playable link)`)
      }
    }
    if (j) {
      out.push(`- ✅ best: ${j.best}`)
      out.push(`- ⚠️ sag: ${j.sag}`)
    }
    out.push('- 🎧 VOICE (your ears): __/5 — ________________________________')
  }
  out.push('')
  return out.join('\n')
}

async function main() {
  const args = process.argv.slice(2)
  const jsonPath = args.find((a) => !a.startsWith('--'))
  const outPath = args.find((a) => a.startsWith('--out='))?.split('=')[1]
  if (!jsonPath) {
    throw new Error(
      'Usage: judge-voice.ts <generate-result.json> [--out=<path>]  (json from `run.ts --json=...`)',
    )
  }

  const result = (await Bun.file(jsonPath).json()) as GenerateResult
  const scripted = result.stops.filter((s) => s.script)
  if (scripted.length === 0)
    throw new Error('No narrated scripts in the JSON (did you point at a real run result?).')

  console.error(`Judging charm of ${scripted.length} stops on "${result.corridor}"...`)
  const verdict = await judgeCharm(scripted)
  const report = buildReport(result, verdict)

  if (outPath) {
    await Bun.write(outPath, report)
    console.error(`\nWrote report → ${outPath}`)
    console.error(
      `Judge: ${verdict.overall}/10 · ${verdict.recommendation}. Now LISTEN through it and fill the VOICE lines.`,
    )
  } else {
    console.log(report)
  }
}

main().catch((e) => {
  console.error('\njudge-voice failed:', e instanceof Error ? e.message : e)
  process.exitCode = 1
})
