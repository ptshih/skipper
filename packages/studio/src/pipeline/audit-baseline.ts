// audit-baseline — the pure half of `audit-loudness --json` / `--baseline`: a SAVED measurement run,
// and the SAME-PLACES diff against it.
//
// Why this exists: a persona-prompt edit moved corpus tail-collapse from 2% to 21% without failing a
// single gate (TODO, 2026-07-30, ~$20 of clips, not revertible — regeneration overwrites the script in
// place). Every gate is per-clip and absolute; nothing in the pipeline compares a run to the one before
// it, so a change that degrades the whole corpus a little is invisible until someone listens. This is
// that comparison: measure, save, change the prompt, regenerate, measure again, diff.
//
// Three disciplines are baked in because each one has already produced a wrong conclusion here (the
// five traps in docs/guides/ops-scripts-sop.md):
//
//  1. **The rates are computed over the INTERSECTION, never over each run's own queue.** "21% vs 2%"
//     only means something on the same places; a queue that changed between runs silently re-prices the
//     comparison. Clips that fall out are REPORTED, not dropped.
//  2. **`collapsed` is DERIVED from the stored dB against ONE threshold, both sides.** Storing the
//     boolean and trusting it would put two copies of the flag predicate in the file, which is exactly
//     how `prune-corpus --restore` came to count on one predicate and act on another. The baseline
//     records the threshold it PRINTED with so a moved band is visible instead of silent.
//  3. **An unmeasured clip is not evidence.** A failed R2 fetch is not "did not collapse"; treating it
//     as such flatters whichever run had the worse network. It leaves the comparison and is named.

import { STRUCTURAL_RETAKE_EPSILON_DB } from './tail'

/** Bump when `AuditClipRecord`'s shape changes — a diff against an older file must fail loudly, not
 *  silently compare fields that no longer mean the same thing. */
export const AUDIT_BASELINE_VERSION = 1

/** How far a clip's tail drop must move to count as a real change rather than TTS sampling noise.
 *  ⚠ NOT a new number: it is `tail.ts`'s own "these two takes are the same take" epsilon, which is the
 *  same question asked once per run instead of once per retake. One home. */
export const MATERIAL_TAIL_DELTA_DB = STRUCTURAL_RETAKE_EPSILON_DB

/** One clip's measurements, as persisted. Mirrors `audit-loudness`'s `Measured` minus the derived
 *  booleans — see discipline 2 above: flags are recomputed on read, never trusted from the file. */
export interface AuditClipRecord {
  poiId: string
  name: string
  /** null = sub-24s clip (probe skipped) or decode miss. */
  tailDropDb: number | null
  integratedLufs: number | null
  truePeakDb: number | null
  leadingMs: number | null
  /** No measurement landed at all (R2 fetch or every ffmpeg pass failed). */
  unmeasured: boolean
}

export interface AuditBaseline {
  version: number
  capturedAt: string
  /** The `--region`/`--include-ids` scope line the run printed, verbatim — so a diff can show that the
   *  two runs were aimed at different things even when their id sets happen to overlap. */
  scope: string
  /** The flag band this run was measured against (`TAIL_COLLAPSE_DB` at the time). */
  tailCollapseDb: number
  clips: AuditClipRecord[]
}

/** A clip whose tail moved, with both readings. */
export interface TailMover {
  poiId: string
  name: string
  beforeDb: number
  afterDb: number
}

export type ExclusionReason =
  | 'absent-from-current'
  | 'absent-from-baseline'
  | 'unmeasured-before'
  | 'unmeasured-after'

export interface Excluded {
  poiId: string
  name: string
  reason: ExclusionReason
}

export interface AuditDiff {
  /** Clips with a real tail reading on BOTH sides — the denominator of both rates. */
  comparable: number
  collapsedBefore: number
  collapsedAfter: number
  newlyCollapsed: TailMover[]
  cleared: TailMover[]
  stillCollapsed: TailMover[]
  /** Moved materially worse but did not cross the flag band (early warning). */
  worsened: TailMover[]
  /** Moved materially better without having been flagged. */
  improved: TailMover[]
  /** Every clip that could NOT be compared, with why. Never silently dropped. */
  excluded: Excluded[]
  /** True when the two runs were measured against different flag bands — the rates are not comparable
   *  and the caller must say so rather than print a delta. */
  thresholdMoved: boolean
}

/** Percent of `comparable` that collapsed; 0 when nothing is comparable (an empty diff has no rate — do
 *  NOT let it read as 0% collapse, which is why callers must check `comparable` first). */
export function collapseRate(collapsed: number, comparable: number): number {
  return comparable === 0 ? 0 : (collapsed / comparable) * 100
}

/** Diff a fresh measurement run against a saved one, on the places they share.
 *
 *  `tailCollapseDb` is the CURRENT flag band and is applied to BOTH sides — the baseline's own recorded
 *  band is used only to detect that it moved (`thresholdMoved`), never to classify its clips. */
export function diffAudits(
  baseline: AuditBaseline,
  current: AuditClipRecord[],
  tailCollapseDb: number,
): AuditDiff {
  const before = new Map(baseline.clips.map((c) => [c.poiId, c]))
  const after = new Map(current.map((c) => [c.poiId, c]))
  const excluded: Excluded[] = []

  const diff: AuditDiff = {
    comparable: 0,
    collapsedBefore: 0,
    collapsedAfter: 0,
    newlyCollapsed: [],
    cleared: [],
    stillCollapsed: [],
    worsened: [],
    improved: [],
    excluded,
    thresholdMoved: baseline.tailCollapseDb !== tailCollapseDb,
  }

  for (const b of baseline.clips) {
    const a = after.get(b.poiId)
    if (!a) {
      excluded.push({ poiId: b.poiId, name: b.name, reason: 'absent-from-current' })
      continue
    }
    // Name the BEFORE side's gap first: a clip the baseline never measured cannot anchor a comparison
    // no matter how good the current reading is.
    if (b.unmeasured || b.tailDropDb === null) {
      excluded.push({ poiId: b.poiId, name: b.name, reason: 'unmeasured-before' })
      continue
    }
    if (a.unmeasured || a.tailDropDb === null) {
      excluded.push({ poiId: a.poiId, name: a.name, reason: 'unmeasured-after' })
      continue
    }

    const beforeDb = b.tailDropDb
    const afterDb = a.tailDropDb
    const wasCollapsed = beforeDb >= tailCollapseDb
    const isCollapsed = afterDb >= tailCollapseDb
    const mover: TailMover = { poiId: a.poiId, name: a.name, beforeDb, afterDb }

    diff.comparable++
    if (wasCollapsed) diff.collapsedBefore++
    if (isCollapsed) diff.collapsedAfter++

    if (!wasCollapsed && isCollapsed) diff.newlyCollapsed.push(mover)
    else if (wasCollapsed && !isCollapsed) diff.cleared.push(mover)
    else if (wasCollapsed && isCollapsed) diff.stillCollapsed.push(mover)
    // Unflagged both sides: the band did not move, but the clip may still be drifting toward it.
    else if (afterDb - beforeDb >= MATERIAL_TAIL_DELTA_DB) diff.worsened.push(mover)
    else if (beforeDb - afterDb >= MATERIAL_TAIL_DELTA_DB) diff.improved.push(mover)
  }

  for (const a of current) {
    if (!before.has(a.poiId)) excluded.push({ poiId: a.poiId, name: a.name, reason: 'absent-from-baseline' })
  }

  return diff
}

/** Parse a baseline file's contents. Throws with an operator-readable reason — a malformed or
 *  wrong-version file must stop the diff, never degrade to comparing against nothing. */
export function parseBaseline(text: string): AuditBaseline {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('baseline file is not valid JSON')
  }
  if (typeof raw !== 'object' || raw === null) throw new Error('baseline file is not an object')
  const b = raw as Partial<AuditBaseline>
  if (b.version !== AUDIT_BASELINE_VERSION)
    throw new Error(
      `baseline is version ${String(b.version)}, this build reads ${AUDIT_BASELINE_VERSION} — re-capture it`,
    )
  if (!Array.isArray(b.clips)) throw new Error('baseline has no clips array')
  if (typeof b.tailCollapseDb !== 'number') throw new Error('baseline has no tailCollapseDb')
  return {
    version: b.version,
    capturedAt: typeof b.capturedAt === 'string' ? b.capturedAt : 'unknown',
    scope: typeof b.scope === 'string' ? b.scope : 'unknown',
    tailCollapseDb: b.tailCollapseDb,
    clips: b.clips,
  }
}
