// Voice & charm harness — the "is the persona actually charming?" check.
//
// SPEND NOTE: this is an analysis-only report CLI (NOT in the admin job registry; touches no live
// data/R2/corpus) — but it DOES spend one Opus charm-judge call per stop whenever run, so it has no
// --apply gate by design (running it IS the request). Don't fold it into the gated SOP CLIs.
//
// "THE PERSONA IS THE PRODUCT," yet the Skipper's CHARM (writing + the Charon TTS
// voice) has never been judged. This reads a narration-run JSON artifact (a dumped
// generation result — stops with scripts + audioUrls) and produces ONE markdown report
// with two verdicts:
//   1. WRITING (automated) — an LLM charm-judge (Opus) scores every stop's SCRIPT for
//      charm and flags where it sags. Charm only; grounding is a separate gate.
//   2. VOICE (your ears) — each clip is paired with a playable presigned link + a
//      blank rating line, because a script can be charming on the page and the TTS can
//      flatten it. Only a human can judge the voice.
//
// The charm-judge CORE (system prompt, tool, judgeCharm) now lives in ./eval/charm.ts so
// the eval panel and this report share one rubric (no drift). This file is the human-facing
// markdown report + the by-ear VOICE worksheet on top of that core.
//
// ⚠ NOTHING EMITS ITS INPUT TODAY. The artifact used to come from the V1 tour entrypoint
// (`src/run.ts --json=…`), deleted in the V1→V2 collapse; no current CLI writes a run JSON. The file
// you pass is therefore HAND-BUILT against the VoiceArtifact shape below (a scratch query over
// `narrations` is the usual way) — it needs only `script` per stop, plus `audioUrl` for the by-ear half.
// The tool is kept because the by-ear VOICE worksheet has no substitute: `audit-corpus --charm` reuses
// the same judge but grades the WRITING only. Repointing this at the live corpus (poi ids →
// narrations.script + audio_url) or retiring it is a founder call, not a cleanup.
//
// Usage (env via dotenvx — ANTHROPIC_API_KEY for the judge, R2_* to presign audio):
//   # Feed it a VoiceArtifact JSON (stops with scripts; audioUrls to presign the voice):
//   dotenvx run -f .env.development -- bun packages/studio/src/judge-voice.ts /tmp/tour.json --out=/tmp/voice.md

import { presignGet } from './pipeline/storage'
import { judgeCharm, type CharmVerdict } from './eval/charm'

// The minimal structural shape this report reads from a narration-run JSON artifact. Kept LOCAL
// (decoupled from any pipeline type) so the report survives the V1→V2 tour-pipeline removal — it
// tolerates extra fields and only depends on what it prints. A required `durationBucket` was dropped
// here: the 1.1 sweep deleted that concept from the vocabulary, so demanding it of a hand-built input
// meant inventing a value for a field nothing defines.
interface VoiceArtifactStop {
  seq: number
  stopType: string
  name: string
  script?: string
  durationMs?: number
  audioUrl?: string
}
interface VoiceArtifact {
  runName: string
  region: string
  stops: VoiceArtifactStop[]
}

const RECO_LABEL: Record<CharmVerdict['recommendation'], string> = {
  ship: '✅ SHIP — charming enough to bet the player on',
  tune: '🛠 TUNE — good bones, specific fixes needed',
  rework: '🔁 REWORK — reads as competent AI, not the skipper',
}

function buildReport(r: VoiceArtifact, v: CharmVerdict): string {
  const bySeq = new Map(v.stops.map((s) => [s.seq, s]))
  const out: string[] = []
  out.push(`# Voice & charm report — ${r.runName} (${r.region})`)
  out.push('')
  out.push('## The bet: is the persona charming enough to build the player on?')
  out.push(`**Judge — the writing (Opus):** ${v.overall}/10 · ${RECO_LABEL[v.recommendation]}`)
  out.push(`> ${v.verdict}`)
  out.push(`- Weakest stops: ${v.weakestStops.length ? v.weakestStops.join(', ') : '—'}`)
  out.push(`- Biggest charm risk: ${v.biggestRisk}`)
  out.push('')
  out.push('**Your call — the VOICE (your ears):**  ⬜ ship  ⬜ tune  ⬜ rework')
  out.push(
    '> The judge graded the WORDS. You grade the Charon VOICE: play each clip and ask — warm corny human, or an AI reading Wikipedia with a tour-guide badge pinned on? Do the jokes get room to breathe? Where does it sound robotic / rushed / flat? Rate each clip 1-5 and fill the overall above.',
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
      'Usage: judge-voice.ts <voice-artifact.json> [--out=<path>]  ' +
        '(a hand-built VoiceArtifact — no CLI emits one today; see the file header)',
    )
  }

  const result = (await Bun.file(jsonPath).json()) as VoiceArtifact
  const scripted = result.stops.filter((s) => s.script)
  if (scripted.length === 0)
    throw new Error('No narrated scripts in the JSON (did you point at a real run result?).')

  console.error(`Judging charm of ${scripted.length} stops on "${result.runName}"...`)
  const verdict = await judgeCharm(
    scripted.map((s) => ({ seq: s.seq, stopType: s.stopType, name: s.name, script: s.script! })),
  )
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
