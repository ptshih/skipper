// Shared helpers for the generator's one-off OPS CLIs (sweep-orphans, patch-clip,
// resynth-tour, …). The contract these enforce is documented in
// `docs/guides/ops-scripts-sop.md`. The headline rule: anything that mutates the DB,
// deletes bytes, or spends money PREVIEWS by default and acts only on `--apply`.

import { db } from '@skipper/db'
import { tours } from '@skipper/db/schema'
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

/** Parse a `--bbox swLng,swLat,neLng,neLat` value to a typed corner object. The shared
 *  split + length + finite check + canonical error string; callers adapt the shape/default. */
export function parseBboxFlag(raw: string): { swLng: number; swLat: number; neLng: number; neLat: number } {
  const p = raw.split(',').map(Number)
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n)))
    throw new Error(`--bbox must be swLng,swLat,neLng,neLat (got "${raw}")`)
  return { swLng: p[0]!, swLat: p[1]!, neLng: p[2]!, neLat: p[3]! }
}

/** Resolve `--max-cost <usd>` to a positive cap, or Infinity when unset/invalid (no cap). */
export function maxCostFlag(flags: Flags): number {
  const v = Number(flags.value('max-cost'))
  return Number.isFinite(v) && v > 0 ? v : Infinity
}

/** Resolve a tour by its full id OR a unique id prefix (convenience for the short ids we log). */
export async function resolveTourId(arg: string | undefined): Promise<string> {
  if (!arg) throw new Error('Pass an explicit <tourId> (or a unique id prefix).')
  const all = await db.select({ id: tours.id }).from(tours)
  const matches = all.filter((t) => t.id === arg || t.id.startsWith(arg))
  if (matches.length === 0) throw new Error(`No tour matches "${arg}".`)
  if (matches.length > 1) throw new Error(`"${arg}" matches ${matches.length} tours — use the full id.`)
  return matches[0]!.id
}

/** Assert the env an --apply run needs is present, with a clear, actionable message. */
export function assertReady(needs: ('r2' | 'tts')[]): void {
  if (needs.includes('tts') && !GOOGLE_TTS_READY())
    throw new Error('Google Cloud TTS not configured (GOOGLE_CLOUD_PROJECT + ADC). Re-run without --apply to preview.')
  if (needs.includes('r2') && !R2_READY())
    throw new Error('R2_* env is not set. Re-run without --apply to preview.')
}

/** The damage a script can do — declared in every ops-CLI header + printed by `announce`. */
export type Blast = 'READ-ONLY' | 'MUTATES DB' | 'DELETES BYTES' | 'SPENDS $'

/** Print a loud preamble so the operator always knows the blast radius + whether it's live. */
export function announce(opts: { tool: string; blast: Blast[]; apply: boolean }): void {
  const mode = opts.apply ? '⚠ APPLYING (live)' : 'DRY RUN — pass --apply to execute'
  console.log(`\n[${opts.tool}] ${opts.blast.join(' + ')} — ${mode}\n`)
}

/** Guard a fan-out: refuse `--all --apply` unless `--yes` is also passed (fat-finger guard). */
export function guardFanout(opts: { all: boolean; apply: boolean; yes: boolean }): void {
  if (opts.all && opts.apply && !opts.yes)
    throw new Error('Refusing --all --apply without --yes (mass-mutation guard). Add --yes to confirm.')
}
