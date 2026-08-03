// CLIENT FLAGS — the one home for tiny, DEVICE-scoped UI facts that must outlive a relaunch.
//
// Today it holds exactly the two booleans that decide the home listen row: hide it after the first
// launch OR once the sample has actually been played, whichever lands first
// (docs/designs/home-cold-open-declutter.md §14.2). It is deliberately written so a SECOND flag is an
// added FIELD rather than an added file — that is what makes "no future flag can pick the cache dir"
// structurally true instead of remembered.
//
// Document dir, NEVER the cache dir. The OS evicts the cache dir on its own schedule, and an eviction
// here would silently RESURRECT a row the rider already dismissed by seeing it. `region-cache.ts`
// carries the same sentence for the same reason; the value of having ONE flags file is that the
// choice gets made once, here.
//
// ⚠ NEVER keyed on the user id. The Better Auth anonymous plugin hard-DELETES the anonymous user row
// at link-to-account and mints a fresh one (CLAUDE.md), so a user-keyed flag vanishes the instant a
// rider signs up — the listen row would pop straight back the moment they made an account. These are
// facts about what this PHONE has already shown, not account state.
//
// ⚠ NOT purged on sign-out, and the `signOut` wrapper in `./auth` leaves it alone on purpose:
// clearing it resurrects the listen row through the back door, and there is nothing in here that
// belongs to an account. (Nor is there anything to purge for privacy — no ids, no timestamps, no
// place data, no rider content.)
//
// Nothing here throws. The total loss of this file costs one re-shown row, so a caller has nothing to
// act on and no way to recover — which is also why there is no `version` field: migrations for state
// this cheap would cost more than the state is worth.
//
// ⚠ Read-modify-write with no locking is correct here and only LOOKS racy: every expo-file-system
// call below is synchronous (`exists` / `textSync()` / `write`), so two marks in the same tick cannot
// interleave.
//
// ⚠ No test file, by the house pattern: `expo-file-system` will not load under `bun test` (the same
// reason `region-cache.ts`, `offline.ts` and `clip-store.ts` have none). The only logic here is one
// boolean OR. If the rule ever grows a second input or a re-show TTL, extract the DECISION to
// `client-flags-util.ts` and test that.
//
// Backup note, not a problem: `Paths.document` is included in iCloud/device backups, so a restored
// device arrives with the row already hidden — correct, the rider has heard him. A reinstall wipes
// the container and the row returns.

import { File, Paths } from 'expo-file-system'

interface ClientFlags {
  /** The listen row was RENDERED on a previous launch. */
  listenRowSeen: boolean
  /** The sample clip actually BEGAN PLAYING at least once. */
  samplePlayed: boolean
}

const DEFAULTS: ClientFlags = { listenRowSeen: false, samplePlayed: false }

/** The only place in the module that names a directory — see the header. */
const flagsFile = (): File => new File(Paths.document, 'client-flags.json')

function readFlags(): ClientFlags {
  try {
    const f = flagsFile()
    if (!f.exists) return DEFAULTS
    const raw: unknown = JSON.parse(f.textSync())
    if (!raw || typeof raw !== 'object') return DEFAULTS
    const o = raw as Record<string, unknown>
    // `=== true` is the `typeof x === 'boolean'` check written short, and it is doing real work: a
    // half-written file parses to junk as readily as it fails to parse, so anything that is not
    // literally a boolean (a string, a number, a key this build has never heard of) lands on false
    // rather than being coerced truthy. Unknown keys are ignored so an older build can share the file.
    return { listenRowSeen: o.listenRowSeen === true, samplePlayed: o.samplePlayed === true }
  } catch {
    return DEFAULTS
  }
}

/** Only ever set to true — a flag that could be cleared would need a reason to be, and none of the
 *  callers has one, so there is no `value` parameter to get backwards. */
function setFlag(field: keyof ClientFlags): void {
  const current = readFlags()
  // Already set: skip the write entirely. Otherwise every launch pays an IO write — and a fresh
  // chance to half-write the file — for a state change that is not happening.
  if (current[field]) return
  try {
    flagsFile().write(JSON.stringify({ ...current, [field]: true }))
  } catch {
    // Best-effort, and the failure is bounded: an unwritten flag costs the listen row re-appearing
    // next launch, never a crash and never a broken screen (`writeCachedRegion`'s posture exactly).
  }
}

/**
 * Should the home cold open render the listen row?
 *
 * §14.2's union, negated and single-sourced here so no second predicate can ever disagree with it:
 * the row is offered until the rider has EITHER seen it on a previous launch OR actually played the
 * sample.
 *
 * Fails OPEN — `true` when the file is absent, unreadable, half-written or holds junk. Re-showing the
 * row costs a rider one glance; hiding it forever is unrecoverable from inside the app and invisible
 * from outside it.
 *
 * ⚠ CALLER CONTRACT: call this ONCE, in a lazy `useState` initialiser. A live call re-evaluates
 * mid-mount and yanks the row out from under a rider returning from `/sample` — home stays mounted
 * under a push, so the flag written by that visit is otherwise never re-read until next launch, which
 * is the correct behaviour.
 */
export function shouldShowListenRow(): boolean {
  const f = readFlags()
  return !(f.listenRowSeen || f.samplePlayed)
}

/**
 * Record that the listen row was rendered.
 *
 * ⚠ Call from an effect on the mount that ACTUALLY RENDERED the row, never on every home mount: the
 * offline home carries no listen row, so marking it there would burn the one launch the rider is owed
 * on a screen that never offered him anything.
 */
export function markListenRowSeen(): void {
  setFlag('listenRowSeen')
}

/**
 * Record that the sample clip began playing.
 *
 * Belongs next to `app/sample.tsx`'s existing "playback began" latch, which already fires exactly
 * once per load for BOTH the autoplay beat and a deliberate tap — so it is precisely "has been
 * PLAYED" with no second latch to keep in sync.
 */
export function markSamplePlayed(): void {
  setFlag('samplePlayed')
}
