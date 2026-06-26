// test-mastering-chain — edge-case QA harness for the voice-master (pipeline/loudnorm.ts).
//
// Runs the REAL production master (normalizeAndEncode — the exact ffmpeg chain + AAC encode every shipped
// clip goes through) over a battery of PATHOLOGICAL inputs and asserts each output is SAFE:
//   • no crash / non-empty, decodable .m4a
//   • decoded-AAC true peak ≤ the −1 dBTP delivery ceiling (the clipping failure mode)
//   • duration preserved (the pipeline stores a duration measured BEFORE the encode — drift desyncs it)
//   • for the real take: loudness in the QA band AND a clean GATED lead-in (no "static at the start")
//
// WHY: the chain (EQ → denoise → gate → gentle compression → loudnorm) has stateful, level-dependent
// stages (gate, compressor, loudnorm AGC) whose behavior on edge inputs (silence, full-scale peaks, ultra-
// short, DC) isn't obvious. This pins it down before a PAID full-corpus resynth bakes it into hundreds of
// clips. FREE — synthetic inputs + one local take, no DB/R2/TTS. ffmpeg REQUIRED (it's the encoder + meter).
//
//   bun packages/studio/src/test-mastering-chain.ts [path/to/real-take.wav]
//
// Exit code 0 = all HARD checks pass; 1 = a failure (CI-able). The loudness landing of synthetic tones is
// REPORTED but not hard-failed (a pure tone is not speech); the true-peak ceiling IS hard for every case.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { AUDIO_LOUDNESS } from '@skipper/shared'
import { ACTIVE_MASTER_TARGET_LUFS, normalizeAndEncode, parseEbur128Summary } from './pipeline/loudnorm'

const TP_CEILING = AUDIO_LOUDNESS.truePeakDbtp // −1.0 dBTP — the hard clipping ceiling for every case
const LEAD_RMS_MAX_DB = -60 // a gated lead-in must sit below this (the model hiss, ungated, sits ~−49)
const DURATION_TOLERANCE_MS = 120 // AAC priming + edit-list slack; beyond this the stored duration desyncs

/** Generate a LINEAR16 mono 24 kHz WAV (the synth output format normalizeAndEncode expects) from an
 *  ffmpeg lavfi source, returned as bytes. THROWS on ffmpeg failure (a broken generator must not pass silently). */
async function genWav(lavfi: string, seconds: number): Promise<Uint8Array> {
  const out = join(tmpdir(), `mc-gen-${crypto.randomUUID()}.wav`)
  try {
    const proc = Bun.spawn(
      ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', lavfi, '-t', String(seconds),
        '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', out],
      { stdout: 'ignore', stderr: 'pipe' },
    )
    const err = await new Response(proc.stderr).text()
    if ((await proc.exited) !== 0) throw new Error(`genWav failed (${lavfi}): ${err.trim()}`)
    return new Uint8Array(await readFile(out))
  } finally {
    await unlink(out).catch(() => {})
  }
}

/** ffprobe a file's duration (seconds); null on failure. */
async function probeDurationSec(file: string): Promise<number | null> {
  try {
    const proc = Bun.spawn(
      ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
      { stdout: 'pipe', stderr: 'ignore' },
    )
    const out = (await new Response(proc.stdout).text()).trim()
    if ((await proc.exited) !== 0) return null
    const n = Number(out)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

/** RMS level (dB) of the first `seconds` of a file via astats; null on failure (or −inf → -Infinity). */
async function leadingRmsDb(file: string, seconds: number): Promise<number | null> {
  try {
    const proc = Bun.spawn(
      ['ffmpeg', '-hide_banner', '-nostats', '-ss', '0', '-t', String(seconds), '-i', file,
        '-af', 'astats=metadata=1', '-f', 'null', '-'],
      { stdout: 'ignore', stderr: 'pipe' },
    )
    const err = await new Response(proc.stderr).text()
    if ((await proc.exited) !== 0) return null
    const m = /Overall[\s\S]*?RMS level dB:\s*(-?\d+(?:\.\d+)?|-?inf)/.exec(err)
    if (!m) return null
    return m[1] === '-inf' ? -Infinity : Number(m[1])
  } catch {
    return null
  }
}

/** ebur128 integrated + true peak of a file; null when the Summary is absent/non-finite (digital silence). */
async function ebur128(file: string): Promise<{ integratedLufs: number; truePeakDb: number } | null> {
  try {
    const proc = Bun.spawn(
      ['ffmpeg', '-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
      { stdout: 'ignore', stderr: 'pipe' },
    )
    const err = await new Response(proc.stderr).text()
    if ((await proc.exited) !== 0) return null
    return parseEbur128Summary(err)
  } catch {
    return null
  }
}

interface Checks {
  /** Hard: decoded true peak must clear the −1 dBTP ceiling (skip only for digital silence, where TP = −inf). */
  truePeak?: boolean
  /** Hard: integrated loudness must land in the QA band (only meaningful for speech-like input). */
  loudness?: boolean
  /** Hard: |out − in| duration within DURATION_TOLERANCE_MS. */
  duration?: boolean
  /** Hard: the master must produce a silent-ish output (no garbage/noise blown up from true silence). */
  expectSilent?: boolean
  /** Hard: leading `0.3s` RMS below LEAD_RMS_MAX_DB (the gate cleaned the lead-in). */
  cleanLeadIn?: boolean
}

interface Case {
  name: string
  make: () => Promise<Uint8Array>
  seconds: number
  checks: Checks
}

// Optional: a real LINEAR16 take (a fresh `synthesize()` dump) as the headline case. Arg-only — synthetic
// edge cases always run; pass a path to also exercise real speech (loudness + the gated lead-in).
const REAL_TAKE = process.argv[2]

const CASES: Case[] = [
  // Full-scale 0 dBFS sine — mirrors the peak-bound TTS source; the master MUST keep the decoded peak safe.
  { name: 'fullscale-sine-0dBFS', seconds: 5, checks: { truePeak: true, duration: true },
    make: () => genWav('sine=frequency=200:duration=5', 5) },
  // Quiet-but-real (−25 dB, above the gate/denoise floor) — loudnorm must GAIN IT UP into the band without
  // breaching the ceiling. (A −40 dB input instead sits below the gate floor and is correctly removed as noise.)
  { name: 'quiet-but-real-−25dB', seconds: 5, checks: { truePeak: true, duration: true, loudness: true },
    make: () => genWav('sine=frequency=500:duration=5,volume=-25dB', 5) },
  // Digital silence — the gate/compressor/loudnorm must not crash or blow a noise floor up out of nothing.
  { name: 'digital-silence', seconds: 3, checks: { duration: true, expectSilent: true },
    make: () => genWav('anullsrc=r=24000:cl=mono', 3) },
  // Broadband white noise at a hot level — worst case for the limiter + the denoise/gate; peak must stay safe.
  { name: 'white-noise-hot', seconds: 5, checks: { truePeak: true, duration: true },
    make: () => genWav('anoisesrc=color=white:amplitude=0.7:duration=5', 5) },
  // Ultra-short clip — loudnorm's measurement window + the gate ramp must survive a sub-second take.
  { name: 'ultra-short-0.4s', seconds: 0.4, checks: { truePeak: true, duration: true },
    make: () => genWav('sine=frequency=180:duration=0.4', 0.4) },
  // Strong DC offset under a tone — the high-pass must remove it (else it eats headroom + thumps).
  { name: 'dc-offset', seconds: 4, checks: { truePeak: true, duration: true },
    make: () => genWav('sine=frequency=220:duration=4,dcshift=0.5', 4) },
]

interface Result { name: string; pass: boolean; integrated: number | null; truePeak: number | null; durDriftMs: number | null; leadRms: number | null; notes: string[] }

async function runCase(c: Case): Promise<Result> {
  const notes: string[] = []
  let pass = true
  const fail = (msg: string): void => { notes.push(`✗ ${msg}`); pass = false }
  const ok = (msg: string): void => { notes.push(`✓ ${msg}`) }

  let input: Uint8Array
  try {
    input = await c.make()
  } catch (e) {
    return { name: c.name, pass: false, integrated: null, truePeak: null, durDriftMs: null, leadRms: null, notes: [`✗ input generation threw: ${String(e)}`] }
  }

  // The actual production master — must not throw on any of these inputs.
  let m4a: Uint8Array
  try {
    m4a = await normalizeAndEncode(input)
  } catch (e) {
    return { name: c.name, pass: false, integrated: null, truePeak: null, durDriftMs: null, leadRms: null, notes: [`✗ normalizeAndEncode threw: ${String(e)}`] }
  }
  if (!m4a.length) return { name: c.name, pass: false, integrated: null, truePeak: null, durDriftMs: null, leadRms: null, notes: ['✗ produced an empty .m4a'] }

  const file = join(tmpdir(), `mc-out-${crypto.randomUUID()}.m4a`)
  let integrated: number | null = null, truePeak: number | null = null, durDriftMs: number | null = null, leadRms: number | null = null
  try {
    await writeFile(file, m4a)
    const [meter, durSec, lead] = await Promise.all([ebur128(file), probeDurationSec(file), leadingRmsDb(file, 0.3)])
    integrated = meter?.integratedLufs ?? null
    truePeak = meter?.truePeakDb ?? null
    leadRms = lead
    durDriftMs = durSec != null ? Math.round((durSec - c.seconds) * 1000) : null

    // ── HARD CHECKS ──
    if (c.checks.truePeak) {
      if (truePeak == null) fail('true peak unmeasurable (clip did not decode?)')
      else if (truePeak > TP_CEILING) fail(`true peak ${truePeak} dBTP > ${TP_CEILING} ceiling (CLIPPING)`)
      else ok(`true peak ${truePeak} dBTP`)
    }
    if (c.checks.loudness) {
      if (integrated == null) fail('integrated loudness unmeasurable')
      else if (Math.abs(integrated - ACTIVE_MASTER_TARGET_LUFS) > 1.2) fail(`integrated ${integrated} LUFS outside ${ACTIVE_MASTER_TARGET_LUFS}±1.2`)
      else ok(`integrated ${integrated} LUFS`)
    }
    if (c.checks.duration) {
      if (durDriftMs == null) fail('output duration unprobeable')
      else if (Math.abs(durDriftMs) > DURATION_TOLERANCE_MS) fail(`duration drift ${durDriftMs}ms > ±${DURATION_TOLERANCE_MS}ms`)
      else ok(`duration drift ${durDriftMs}ms`)
    }
    if (c.checks.expectSilent) {
      // A silent input must stay silent: ebur128 Summary is absent/non-finite (parse → null) on true silence.
      if (integrated != null) fail(`expected silence but measured ${integrated} LUFS (noise blown up)`)
      else ok('stayed silent (no noise blown up)')
    }
    if (c.checks.cleanLeadIn) {
      if (leadRms == null) fail('lead-in RMS unmeasurable')
      else if (leadRms > LEAD_RMS_MAX_DB) fail(`lead-in ${leadRms} dB > ${LEAD_RMS_MAX_DB} (gate did not clean it)`)
      else ok(`lead-in ${leadRms === -Infinity ? '−inf' : leadRms} dB (gated)`)
    }
  } finally {
    await unlink(file).catch(() => {})
  }
  return { name: c.name, pass, integrated, truePeak, durDriftMs, leadRms, notes }
}

async function main(): Promise<void> {
  const cases = [...CASES]
  // The real TTS take (if present) is the most important case: speech loudness, true peak, duration, AND the
  // gated lead-in (the "static at the start" fix) all at once.
  if (REAL_TAKE && existsSync(REAL_TAKE)) {
    const real = REAL_TAKE
    cases.unshift({
      name: `real-take (${real.split('/').pop()})`,
      seconds: (await probeDurationSec(real)) ?? 0,
      checks: { truePeak: true, loudness: true, duration: true, cleanLeadIn: true },
      make: async () => new Uint8Array(await readFile(real)),
    })
  } else {
    console.log('(no real take passed — running synthetic edge cases only; pass a LINEAR16 WAV path to add it)\n')
  }

  console.log(`Voice-master edge-case harness — chain lands ~${ACTIVE_MASTER_TARGET_LUFS} LUFS, ceiling ${TP_CEILING} dBTP\n`)
  const results: Result[] = []
  for (const c of cases) {
    const r = await runCase(c)
    results.push(r)
    console.log(`${r.pass ? '✅' : '❌'} ${r.name}`)
    for (const n of r.notes) console.log(`     ${n}`)
  }

  const failed = results.filter((r) => !r.pass)
  console.log(`\n${results.length - failed.length}/${results.length} cases passed.`)
  if (failed.length) {
    console.log(`FAILED: ${failed.map((r) => r.name).join(', ')}`)
    process.exit(1)
  }
  console.log('All edge cases safe. ✅')
}

await main()
