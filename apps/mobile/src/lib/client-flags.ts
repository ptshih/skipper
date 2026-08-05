// CLIENT FLAGS — the one home for tiny, DEVICE-scoped UI facts that must outlive a relaunch.
//
// Today it holds exactly one boolean: has this phone been through first-run onboarding. It is
// deliberately written so a SECOND flag is an added FIELD rather than an added file — that is what
// makes "no future flag can pick the cache dir" structurally true instead of remembered.
//
// ⚠ IT HELD TWO OTHER FLAGS UNTIL 2026-08-04 — `listenRowSeen` and `samplePlayed`, which together
// decided whether home's cold open offered the listen row. Both were deleted with the row itself
// (founder: "we no longer need the sample chip on the home screen since it was moved to onboarding").
// Recorded because the deletion looks like a simplification and is actually a MOVE: the sample is not
// gone, it is now the first thing a new install sees, and the question "has this rider heard him yet"
// is answered by `onboarded` below rather than by two flags racing each other. Anything tempted to
// re-add a "show the sample again" affordance should re-open that decision, not this file.
//
// Document dir, NEVER the cache dir. The OS evicts the cache dir on its own schedule, and an eviction
// here would silently RESURRECT onboarding for a rider who already finished it — worse now than it was
// for the listen row, because this is a whole flow rather than a single dismissible row.
// `region-cache.ts` carries the same sentence for the same reason; the value of having ONE flags file
// is that the choice gets made once, here.
//
// ⚠ NEVER keyed on the user id. The Better Auth anonymous plugin hard-DELETES the anonymous user row
// at link-to-account and mints a fresh one (CLAUDE.md), so a user-keyed flag vanishes the instant a
// rider signs up — onboarding would reappear the moment they made an account, which is the single
// worst moment for it. These are facts about what this PHONE has already shown, not account state.
//
// ⚠ NOT purged on sign-out, and the `signOut` wrapper in `./auth` leaves it alone on purpose:
// clearing it walks a signed-out rider back through onboarding, and there is nothing in here that
// belongs to an account. (Nor is there anything to purge for privacy — no ids, no timestamps, no
// place data, no rider content.)
//
// Nothing here throws. The total loss of this file costs one re-shown flow, so a caller has nothing to
// act on and no way to recover — which is also why there is no `version` field: migrations for state
// this cheap would cost more than the state is worth.
//
// ⚠ Read-modify-write with no locking is correct here and only LOOKS racy: every expo-file-system
// call below is synchronous (`exists` / `textSync()` / `write`), so two marks in the same tick cannot
// interleave.
//
// ⚠ No test file, by the house pattern: `expo-file-system` will not load under `bun test` (the same
// reason `region-cache.ts`, `offline.ts` and `clip-store.ts` have none). The only logic here is one
// boolean read. If the rule ever grows a second input or a re-show TTL, extract the DECISION to
// `client-flags-util.ts` and test that.
//
// Backup note, not a problem: `Paths.document` is included in iCloud/device backups, so a restored
// device arrives already onboarded — correct, the rider has met him. A reinstall wipes the container
// and onboarding returns.

import { File, Paths } from 'expo-file-system'

interface ClientFlags {
  /** First-run onboarding ran to completion — the rider heard the taste and picked a region. */
  onboarded: boolean
}

const DEFAULTS: ClientFlags = { onboarded: false }

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
    return { onboarded: o.onboarded === true }
  } catch {
    return DEFAULTS
  }
}

/** Only ever set to TRUE — there is no `value` parameter, so no caller can pass the wrong one. Clearing
 *  is a separate, deliberately-named function below rather than an argument here. */
function setFlag(field: keyof ClientFlags): void {
  const current = readFlags()
  // Already set: skip the write entirely. Otherwise every launch pays an IO write — and a fresh
  // chance to half-write the file — for a state change that is not happening.
  if (current[field]) return
  try {
    flagsFile().write(JSON.stringify({ ...current, [field]: true }))
  } catch {
    // Best-effort, and the failure is bounded: an unwritten flag costs onboarding re-appearing next
    // launch, never a crash and never a broken screen (`writeCachedRegion`'s posture exactly).
  }
}

/**
 * Should this launch open on first-run onboarding rather than on home?
 *
 * Fails toward SHOWING it — `true` when the file is absent, unreadable, half-written or holds junk.
 * That is the honest default for the case that dominates by orders of magnitude (a fresh install, where
 * the file legitimately does not exist), and the two error branches are indistinguishable from it
 * without keeping state we deliberately do not keep. The cost of being wrong is a returning rider
 * seeing two screens they can clear in two taps, one of which is a region picker whose answer is
 * already correct; the cost the other way is a first-timer never hearing the skipper at all, which is
 * the entire reason the flow exists.
 *
 * ⚠ CALLER CONTRACT: call this ONCE, in a lazy `useState` initialiser, and never as a live read. Home
 * is what gates on it, and home stays MOUNTED under a push — a live call would re-evaluate mid-session
 * and could bounce a rider who is mid-conversation back into onboarding.
 */
export function shouldShowOnboarding(): boolean {
  return !readFlags().onboarded
}

/**
 * Record that onboarding finished.
 *
 * ⚠ WRITE IT BEFORE NAVIGATING HOME, not after, and not on each step. Home decides whether to redirect
 * in a lazy initialiser at mount, so a flag written after `router.replace('/')` races the mount that
 * reads it — and losing that race sends the rider straight back into onboarding, which is a loop, not
 * a glitch. Writing it on step ONE would be worse in the other direction: a rider who quit during the
 * taste would never be offered a region.
 */
export function markOnboarded(): void {
  setFlag('onboarded')
}

/**
 * Forget that onboarding ever ran, so the next launch opens on it again. **Developer tool only**
 * (Settings → Developer, admin-gated), and it exists because the flow is otherwise a once-per-INSTALL
 * surface: without this, re-checking a copy tweak on the first two screens a stranger ever sees means
 * deleting and reinstalling the app, which also throws away the drives, the downloads and the session.
 *
 * ⚠ THE ONLY CLEARING PATH IN THIS MODULE, and it must stay that way. Every other writer is
 * one-directional on purpose: a flag that ordinary code can un-set is a flag that gets un-set by
 * accident, and the accident here — onboarding reappearing for a rider mid-use — is exactly what the
 * "never keyed on the user id" and "not purged on sign-out" rules in the header are protecting against.
 * If a second caller ever wants this, that is a design question, not an import.
 *
 * ⚠ DELETES THE FILE rather than writing `{ onboarded: false }`, so a reset lands on the same state a
 * fresh install does — byte-identical, not merely equivalent. A future flag added to this module is
 * then covered automatically, instead of quietly surviving a "reset everything" that only knew about
 * the fields someone remembered to enumerate.
 *
 * ⚠ IT DOES NOT TOUCH THE REGION CACHE, deliberately: `region-cache.ts` is a different fact (which
 * roads the rider chose) with a different lifetime, and onboarding re-seeds its picker FROM that cache
 * (`pickRegionId`). So a reset replays the flow with the previous answer pre-selected — which is the
 * honest simulation of a rider who restored from a backup, and one tap from the fresh-install case.
 */
export function resetOnboarding(): void {
  try {
    flagsFile().delete()
  } catch {
    // Nothing to act on: the file may simply not exist yet, which is already the desired end state.
  }
}
