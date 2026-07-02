// CROSS-SESSION roam memory — what the skipper has already told YOU, and which pins you've muted.
//
// Lives in ONE JSON file in the PERSISTENT document dir (Paths.document — the same home as offline
// drives, NOT Paths.cache which the OS can evict). Client-only BY DESIGN: the toy lens is "no server
// surveillance of where a rider has been" (the locked roam pass-2 item). The file's clean serializable
// shape leaves an OPTIONAL server sync as a purely additive later layer — nothing here changes to add one.
//
// The RoamEngine stays pure/no-I/O. This module is the I/O + pure transforms around it: at session start
// the app SEEDS the engine from here (firedAgesSec → cross-session cooldown so the morning's stories stay
// quiet on the drive home; mutedPoiIds → never-fire). Each encounter that actually SOUNDS is recorded
// back; "don't tell me this one again" flips muted. (Engine seam: RoamHistorySeed in @skipper/engine.)
//
// SecureStore is deliberately NOT used: it's keychain-backed (~2 KB ceiling, not meant for bulk) and
// this map grows with every place heard — a file is the right home (mirrors offline.ts).

import { File, Paths } from 'expo-file-system'

/** One place's history: when it last sounded, how many times, and whether it's muted. */
export interface RoamHistoryEntry {
  /** Epoch ms of the last time a clip for this poi actually SOUNDED (a stalled/skipped load doesn't count). */
  lastPlayedAt: number
  /** How many times it has sounded (≈ once per session per poi, given the cooldown). */
  count: number
  /** "Don't tell me this one again" — the engine never fires a muted poi. */
  muted: boolean
}

export type RoamHistory = Record<string, RoamHistoryEntry>

const FILE_NAME = 'roam-history.json'
const historyFile = () => new File(Paths.document, FILE_NAME)

/** Load the persisted history. Returns {} on a missing/corrupt/unreadable file — NEVER throws: a roam
 *  session must start even if the store is wedged (worst case the skipper repeats himself once). */
export function loadRoamHistory(): RoamHistory {
  try {
    const f = historyFile()
    if (!f.exists) return {}
    const parsed: unknown = JSON.parse(f.textSync())
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as RoamHistory
  } catch {
    return {}
  }
}

/** Persist the history (best-effort; swallows errors — a lost write just re-tells a story later). */
export function saveRoamHistory(history: RoamHistory): void {
  try {
    historyFile().write(JSON.stringify(history))
  } catch {
    // non-fatal: the in-memory copy still governs this session
  }
}

/** Record that a poi's clip actually SOUNDED. PURE — returns a new history; the caller persists. Preserves muted. */
export function recordPlayed(history: RoamHistory, poiId: string, nowMs: number): RoamHistory {
  const prev = history[poiId]
  return {
    ...history,
    [poiId]: { lastPlayedAt: nowMs, count: (prev?.count ?? 0) + 1, muted: prev?.muted ?? false },
  }
}

/** Flip a poi's muted flag. PURE — returns a new history; the caller persists. Creates an entry for a
 *  poi never heard (you can mute from the sheet on the first encounter). */
export function setMuted(history: RoamHistory, poiId: string, muted: boolean): RoamHistory {
  const prev = history[poiId]
  return {
    ...history,
    [poiId]: { lastPlayedAt: prev?.lastPlayedAt ?? 0, count: prev?.count ?? 0, muted },
  }
}

/** Seed for a fresh RoamEngine, derived from the persisted history at session start. `firedAgesSec` is
 *  the wall-clock AGE (s) since each non-muted poi last sounded (the engine seeds it as a negative fire
 *  time → cross-session cooldown); muted pois go straight to the never-fire set. */
export function historySeed(
  history: RoamHistory,
  nowMs: number,
): { firedAgesSec: Record<string, number>; mutedPoiIds: string[] } {
  const firedAgesSec: Record<string, number> = {}
  const mutedPoiIds: string[] = []
  for (const [poiId, e] of Object.entries(history)) {
    if (e.muted) {
      mutedPoiIds.push(poiId)
      continue
    }
    if (e.lastPlayedAt > 0) firedAgesSec[poiId] = Math.max(0, (nowMs - e.lastPlayedAt) / 1000)
  }
  return { firedAgesSec, mutedPoiIds }
}

/** The set of pois the rider has HEARD (count > 0) — feeds the map's heard/unheard pin styling. */
export function heardPoiIds(history: RoamHistory): Set<string> {
  const s = new Set<string>()
  for (const [poiId, e] of Object.entries(history)) if (e.count > 0) s.add(poiId)
  return s
}
