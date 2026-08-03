// THE BLACK BOX — the trace FORMAT and the recorder that fills it.
//
// ⚠ It lives in @skipper/engine, not in the app, for the same reason fix-mapper.ts does: the phone
// WRITES traces and `packages/sim` READS them, so a format defined on one side only would give each
// side its own private idea of what a recorded drive is. One definition, both ends. The file write
// and the share sheet stay native, in apps/mobile/src/lib/trace-export.ts.
//
// WHY THIS EXISTS, and why it is worth more than it looks: the founder can rarely drive, so each real
// drive is scarce. Un-recorded, a drive yields ONE observation and is then gone. Recorded, it becomes
// a permanent fixture carrying real multipath, real approach geometry and real speed, replayable
// against any future build and sweepable across trigger parameters. That is the difference between
// sampling a parameter once and reading its whole curve.
//
// ⚠ **It has a deadline.** A trace not recorded is unrecoverable. The roam drives that produced the
// eight TestFlight fixes are already gone for exactly this reason, which is why the recorder wants to
// exist BEFORE the next drive rather than after it. docs/designs/desk-drive-harness.md §4.2.
//
// ⚠ **A trace is precise location data about a real person, so it is LOCAL-ONLY.** INV-13 keeps
// coordinates out of analytics events deliberately; a recorder that uploaded would walk straight
// around that guarantee. Nothing here transmits — it buffers in memory and hands bytes to an explicit
// user-initiated export. Recording is gated on `isAdmin` (founder, 2026-08-03) — NOT `__DEV__`, which
// would have recorded only from Xcode-launched builds and therefore discarded exactly the TestFlight
// drives worth capturing. If it is ever opened to ordinary riders it becomes new personal data and
// `purgeUserData` has to chase it, which is a founder decision, not a refactor.
import type { RawFix } from './fix-mapper'

/** Bump when the envelope shape changes in a way a reader must branch on. */
export const TRACE_FORMAT_VERSION = 1

/**
 * How many fixes a single recording will hold. A 4 Hz two-hour drive is ~28.8k, so this is ~7 hours of
 * headroom — a bound against a pathological session, not a working limit.
 *
 * ⚠ Hitting it STOPS the recording rather than dropping the oldest fixes. A ring buffer would silently
 * hand back a trace whose beginning is missing while still looking complete, and the start of a drive
 * is where the interesting failures are (cold-start accuracy, the first stop, the permission grant).
 * A short trace that says it is short beats a full-looking one that lies.
 */
export const MAX_TRACE_FIXES = 100_000

/**
 * Everything the envelope needs that the recorder cannot know. Captured at the START of a drive, not
 * at flush time — the flush runs in a callback whose dependency array must stay empty (see
 * `teardownSource` in useDrive.ts), so the metadata rides along rather than being read live.
 */
export interface TraceMeta {
  driveId: string
  label?: string
  /** ISO 8601. Passed in, so this module takes no clock and stays pure + deterministic under test. */
  recordedAt: string
  appVersion?: string
  polyline: readonly (readonly [number, number])[]
}

export interface TraceEnvelope {
  version: number
  /** Which drive this was recorded on — a replay against a different route is meaningless. */
  driveId: string
  label?: string
  /** ISO 8601, stamped by the caller (this module takes no clock, so it stays pure + testable). */
  recordedAt: string
  /** App version, so a trace that reproduces a bug can be tied to the build that had it. */
  appVersion?: string
  /** Route fingerprint — see `polylineFingerprint`. Guards replaying trace A against drive B. */
  routeVertices: number
  routeHash: string
  /** True when MAX_TRACE_FIXES stopped the recording early. Never silently omitted. */
  truncated: boolean
  fixes: RawFix[]
}

/**
 * A cheap FNV-1a fingerprint of a route, over coordinates rounded to ~1 m.
 *
 * Rounded on purpose: a fingerprint that changes on floating-point noise would reject valid replays,
 * and the job here is only to catch a trace being replayed against a DIFFERENT route — not to detect
 * sub-metre edits, which frozen drive polylines cannot have anyway.
 */
export function polylineFingerprint(polyline: readonly (readonly [number, number])[]): string {
  let h = 0x811c9dc5
  for (const [lng, lat] of polyline) {
    const s = `${lng.toFixed(5)},${lat.toFixed(5)};`
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/**
 * Accumulates raw fixes for one drive run.
 *
 * ⚠ It stores the fix objects it is HANDED, without copying or normalising them. That is deliberate:
 * the iOS -1 sentinels in `speed`/`heading`/`accuracy` ARE the data — a recorder that "cleaned" them
 * would produce a trace that can never reproduce the sentinel-handling bugs, which are the ones that
 * have actually bitten. Same reason the tap in `liveSource` sits BEFORE the accuracy gate: a trace
 * without the rejected fixes always replays clean, and a fixture that always passes proves nothing.
 */
export class TraceRecorder {
  private readonly buf: RawFix[] = []
  private stopped = false
  private truncatedAt = false

  record = (raw: RawFix): void => {
    if (this.stopped) return
    if (this.buf.length >= MAX_TRACE_FIXES) {
      this.truncatedAt = true
      this.stopped = true
      return
    }
    this.buf.push(raw)
  }

  stop(): void {
    this.stopped = true
  }

  get count(): number {
    return this.buf.length
  }

  get truncated(): boolean {
    return this.truncatedAt
  }

  /** Wall-clock span of what was captured (s), from the fixes' own timestamps. 0 for <2 fixes. */
  get spanSec(): number {
    if (this.buf.length < 2) return 0
    return (this.buf[this.buf.length - 1]!.timestamp - this.buf[0]!.timestamp) / 1000
  }

  envelope(meta: TraceMeta): TraceEnvelope {
    return {
      version: TRACE_FORMAT_VERSION,
      driveId: meta.driveId,
      label: meta.label,
      recordedAt: meta.recordedAt,
      appVersion: meta.appVersion,
      routeVertices: meta.polyline.length,
      routeHash: polylineFingerprint(meta.polyline),
      truncated: this.truncatedAt,
      fixes: this.buf.slice(),
    }
  }
}

/** Reader for a serialised trace. Returns null rather than throwing — a bad file is a user error. */
export function parseTraceEnvelope(json: string): TraceEnvelope | null {
  let v: unknown
  try {
    v = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof v !== 'object' || v === null) return null
  const e = v as Partial<TraceEnvelope>
  if (typeof e.driveId !== 'string' || !Array.isArray(e.fixes)) return null
  // ⚠ Shape-check one fix rather than trusting the extension. A JSON array of the wrong thing would
  // otherwise replay as a drive that never moves, which reads as a triggering bug rather than a
  // wrong file — the most expensive kind of confusion this harness can create.
  const f = e.fixes[0] as RawFix | undefined
  if (f && (typeof f.timestamp !== 'number' || typeof f.coords?.latitude !== 'number')) return null
  return {
    version: typeof e.version === 'number' ? e.version : 0,
    driveId: e.driveId,
    label: e.label,
    recordedAt: typeof e.recordedAt === 'string' ? e.recordedAt : '',
    appVersion: e.appVersion,
    routeVertices: typeof e.routeVertices === 'number' ? e.routeVertices : 0,
    routeHash: typeof e.routeHash === 'string' ? e.routeHash : '',
    truncated: e.truncated === true,
    fixes: e.fixes as RawFix[],
  }
}

/**
 * Does this trace belong to this route? Returns a reason when it doesn't, so the caller can say which
 * of the two mismatched rather than just refusing.
 */
export function traceMatchesRoute(
  env: TraceEnvelope,
  polyline: readonly (readonly [number, number])[],
): { ok: true } | { ok: false; reason: string } {
  if (env.routeVertices !== polyline.length) {
    return { ok: false, reason: `route has ${polyline.length} vertices, trace was recorded on ${env.routeVertices}` }
  }
  const hash = polylineFingerprint(polyline)
  if (env.routeHash !== hash) return { ok: false, reason: `route fingerprint ${hash} ≠ trace's ${env.routeHash}` }
  return { ok: true }
}

/** A filename that sorts chronologically and says what it is at a glance. */
export function traceFileName(env: TraceEnvelope): string {
  const stamp = env.recordedAt.replace(/[:.]/g, '-')
  return `trace-${env.driveId.slice(0, 8)}-${stamp}.json`
}
