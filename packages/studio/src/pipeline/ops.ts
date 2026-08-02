// Shared helpers for the studio pipeline's one-off OPS CLIs (sweep-orphans,
// resynth-narration, …). The contract these enforce is documented in
// `docs/guides/ops-scripts-sop.md`. The headline rule: anything that mutates the DB,
// deletes bytes, or spends money PREVIEWS by default and acts only on `--apply`.

import { GOOGLE_TTS_READY, R2_READY } from '../config'

export interface Flags {
  /** Non-flag tokens, excluding the value consumed by a declared `valueFlags` entry. */
  positionals: string[]
  /** Is `--name` present (boolean flag or value flag)? */
  has(name: string): boolean
  /** The value of `--name=val` or `--name val`; undefined if absent or value-less. */
  value(name: string): string | undefined
}

/**
 * Parse `process.argv.slice(2)`. `valueFlags` names the flags that consume a FOLLOWING
 * token (e.g. `--find "x"`), so that token isn't mistaken for a positional and a positional
 * that equals the value still resolves. Supports both `--name=val` and `--name val`.
 */
export function parseFlags(argv: string[], opts: { valueFlags?: string[] } = {}): Flags {
  const valueFlags = new Set((opts.valueFlags ?? []).map((f) => f.replace(/^--/, '')))

  const has = (name: string): boolean => {
    const n = name.replace(/^--/, '')
    return argv.includes(`--${n}`) || argv.some((a) => a.startsWith(`--${n}=`))
  }

  const value = (name: string): string | undefined => {
    const n = name.replace(/^--/, '')
    const eqForm = argv.find((a) => a.startsWith(`--${n}=`))
    if (eqForm) return eqForm.slice(n.length + 3)
    const i = argv.indexOf(`--${n}`)
    if (i < 0) return undefined
    const next = argv[i + 1]
    // A following flag means this flag was given no value (usage error upstream).
    return next !== undefined && !next.startsWith('--') ? next : undefined
  }

  const positionals: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a.startsWith('--')) continue
    const prev = argv[i - 1]
    // Skip a token that is the value of a space-separated value flag (the "x" in `--find x`).
    if (i > 0 && prev?.startsWith('--') && valueFlags.has(prev.slice(2))) continue
    positionals.push(a)
  }

  return { positionals, has, value }
}

/**
 * Resolve a numeric `--flag <n>`: ABSENT → `fallback`; PRESENT but unparseable or ≤ `min` → THROW.
 *
 * ⚠ It never returns NaN, and that is the whole point. Every numeric flag in this package used to be
 * `Number(flags.value(x) ?? default)`, which turns an operator typo into NaN — and NaN is not a small
 * number, it is a DISABLED comparison. What that produced differed per call site and none of it was
 * what the operator asked for: `queue.length >= NaN` is never true, so `audit-corpus --limit 5o`
 * audited the WHOLE corpus at full spend, while `slice(0, NaN)` is empty, so the same typo made a
 * generate run silently do nothing. Both directions are wrong; only one is expensive.
 *
 * A rejected value must never be read as "no limit". These flags are the operator's spend brakes, and
 * a brake that disengages when you press it wrong is worse than no brake — you'd have checked.
 */
export function numericFlag(flags: Flags, name: string, opts: { fallback: number; min?: number }): number {
  if (!flags.has(name)) return opts.fallback
  const raw = flags.value(name)
  const v = Number(raw)
  const min = opts.min ?? 0
  if (raw === undefined || raw.trim() === '' || !Number.isFinite(v) || v <= min) {
    throw new Error(
      `--${name} was given as ${raw === undefined ? '(no value)' : `"${raw}"`} — pass a number greater than ` +
        `${min}, or omit the flag entirely (${Number.isFinite(opts.fallback) ? `default ${opts.fallback}` : 'no limit'}).`,
    )
  }
  return v
}

/**
 * Resolve `--max-cost <usd>` to a positive cap, or Infinity when the flag is ABSENT (no cap).
 *
 * ⚠ THROWS on a present-but-unparseable value rather than falling back to Infinity. Every caller
 * gates as `if (maxCostUsd !== Infinity && …)`, so a value this rejects would not TIGHTEN the cap —
 * it would REMOVE it, on the one flag whose entire job is to bound spend. `--max-cost 0` ("spend
 * nothing"), `-5`, `5usd`, and `--max-cost --apply` (parseFlags yields undefined when the next token
 * is a flag) all used to resolve to "no cap" while the operator believed they had set one.
 *
 * The admin dispatch path has rejected these at the HTTP boundary since audit #7
 * (`apps/admin/server/jobs.ts` `pushPosNum`, whose comment names this exact hazard). The hand-run
 * CLI — the SOP's primary documented invocation — was the unguarded half. Fail closed in the shared
 * parser so both halves agree, instead of guarding one caller and trusting the rest.
 */
export function maxCostFlag(flags: Flags): number {
  return numericFlag(flags, 'max-cost', { fallback: Infinity })
}

/** Assert the env an --apply run needs is present, with a clear, actionable message. */
export function assertReady(needs: ('r2' | 'tts')[]): void {
  if (needs.includes('tts') && !GOOGLE_TTS_READY())
    throw new Error('Google Cloud TTS not configured (GOOGLE_CLOUD_PROJECT + ADC). Re-run without --apply to preview.')
  if (needs.includes('r2') && !R2_READY())
    throw new Error('R2_* env is not set. Re-run without --apply to preview.')
}

/** The damage a script can do — declared in every ops-CLI header + printed by `announce`. */
export type Blast = 'READ-ONLY' | 'MUTATES DB' | 'DELETES BYTES' | 'DELETES ROWS' | 'SPENDS $'

/** Print a loud preamble so the operator always knows the blast radius + whether it's live. */
export function announce(opts: { tool: string; blast: Blast[]; apply: boolean }): void {
  const mode = opts.apply ? '⚠ APPLYING (live)' : 'DRY RUN — pass --apply to execute'
  console.log(`\n[${opts.tool}] ${opts.blast.join(' + ')} — ${mode}\n`)
}
