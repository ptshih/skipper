# Create-a-Drive verification runbook (V2)

> **Status:** guide (written 2026-06-18) — the one-sitting pass that clears the last V2 gate: the
> live **Create→propose→confirm→generate→preview→drive** runtime, which `bun run check` cannot judge
> (it needs a dev build + a signed-in account + a real LLM/Maps spend). Code-anchored to the tree as
> of 2026-06-18 — re-verify anchors against the current files before trusting a line number. Pairs
> with `docs/guides/device-verification-runbook.md` (the M1 phone-player pass this builds on),
> `docs/guides/eas-setup.md` (how to build/install the dev build), and
> `docs/decisions/create-a-drive-architecture.md` (the design this reports against).

## Why this exists

The V2 Create-a-Drive flow is fully type-checked + unit-tested (full `tsc` sweep + all suites green
as of the migration). What that **cannot** judge is the load-bearing runtime: does the LLM resolve a
sane in-region A→B, does Google route it, does `buildDrive` pick a charming set of stops along it,
does the preview/live player trigger + pace them, and does it degrade gracefully (offline, dead
clip, cap hit). This is the single 🔴 gate left before the founder ear-pass + real drive.

**Spend note (founder-gated).** Each `propose` spends a small LLM call + 2 geocodes + 1 Routes call;
each `create` spends 1 Routes call + a DB write. **No TTS, no generation** — drives REUSE the
existing 459 roam clips. So a full pass is a few cents of Google/Anthropic, not a paid regen. Still,
per CLAUDE.md the *spend* needs an explicit founder OK before firing.

## Preconditions

- **API target.** Local dev API listens on **:8787** (confirmed serving the migrated DB). For an
  on-device build, point the app at the deployed API — **the prod API deploy is itself a 🔴 open
  item**; until then verify against the simulator hitting local `:8787`, or a tunnel.
- **Dev build + account.** `/drives*` is behind `requireAccount` (`apps/api/src/drives.ts:300`), so
  you must be signed into a free account. Anonymous → 401 → AccountGate (by design: roam is the only
  anonymous surface).
- **Region + corpus (verified 2026-06-18, shared Neon).** One region: **Lake Tahoe**, id
  `3373ce38-e79f-4f9e-aba4-b6a9826ccec3`. Corpus = **459 narrations, all `form='story'`, 0 null
  audio, 853 POIs**. Dense enough that any in-region A→B will populate well. The region auto-selects
  in the create form (only one region → no chip picker).

## Happy path (do this first)

1. **Open Create.** Home → Create a Drive (secondary CTA; Roam is primary). Region auto-selected
   ("LAKE TAHOE" label, no chips).
2. **Prompt → propose.** Type a real A→B, e.g. *"from the casino district out to Emerald Bay, the
   scenic way"* → "Plan the drive". Expect the persona "thinking" beat (`PROPOSING_LINES`), then the
   **CONFIRM** screen: a road-snapped route on the map-hero, `Start → End` names, a `MIN` badge, and
   an `N STORIES` badge (= `estStopCount`, the REAL selection count — propose runs the same
   `buildDrive`, so the confirm count must match the drive you get).
3. **Confirm → create.** "Make this drive" → `GENERATING_LINES` beat → it `router.replace`s straight
   into the **preview** of the new drive (`/drives/[id]/play?mode=preview`). Back should return home,
   not to the spent create flow.
4. **Preview plays.** The map-less simulated drive autostarts: compressed segment timeline (clip /
   drive / rest), tappable stops (jump-to), a route token gliding, lock-screen Now Playing per clip.
   Confirm stop names are clean (no ", California"), audio plays, the trail lands on each stop.
5. **Real sim drive.** From My Drives → open the drive → it loads in **sim** mode in dev (GPS-less
   couch sim). "Real time" vs "8× faster" knob appears pre-drive. Play → confirm stops TRIGGER by
   proximity (not on a timer), pace sanely (≥3-min gaps), the stop list auto-scrolls, and the drive
   ends cleanly (done card with the stop tally).
6. **Replay / offline.** Re-open the drive (GET /drives/:id re-presigns live). Download it, kill the
   network, replay — clips load from `file://` with zero network (offline-first).

## Edge cases — the ones most likely to bite

Hit these deliberately; several are unproven and called out as findings below.

- **🟠 LOOP.** Tap the canned **"Emerald Bay loop"** suggestion (or any "loop / out and back"
  prompt). The LLM sets `start == end` (`RESOLVE_TOOL`, `drives.ts:113`), so `materializeRoute`
  gets two identical points. **VERIFY Google Routes returns a real loop and not a degenerate
  ~zero-length route** — a degenerate route → tiny bbox → ~0 stops → an empty drive (see Finding 1).
  This is a first-class path (it's a shipped suggestion chip), so it MUST work or the chip must go.
- **🟠 SPARSE / EMPTY.** A valid in-region route with little corpus nearby (or a very short hop).
  Confirm what the confirm screen shows at `estStopCount === 0` and whether "Make this drive" should
  be blocked (see Finding 1).
- **OUT-OF-REGION.** Prompt somewhere clearly outside Tahoe (e.g. "downtown San Francisco"). Expect
  the propose `422 out_of_region` message, surfaced inline on the form. Then try an AMBIGUOUS
  in-vs-out name to probe the `inRegion` gate + geocode bias (Finding 3).
- **FREE CAP.** Create up to `FREE_DRIVE_CAP` (default **10**) drives, then one more → expect the
  `403 drive_limit_reached` message (names the cap + the credit-pack path). The client surfaces the
  server message as-is.
- **DEAD CLIP / dead zone.** Mid-drive, a clip that won't start gets re-signed ONCE then SKIPPED
  (the drive never hangs) — `useDrive.ts` watchdog + post-start stall recovery. Hard to force on a
  sim; note it for the real drive.
- **BACK-OUT guard.** While driving, the back chevron + "Pull over" both confirm before ending; the
  edge-swipe is disabled while rolling.

## Findings from the code pass (2026-06-18) — fix decisions for the founder

These came out of reading the full path; none block the happy path on the dense Tahoe corpus, but
each is a real edge. Severity is "how likely to bite a real rider."

1. **🟠 An empty drive (0 stops) is persistable and burns a cap slot.** `buildDrive` can return `[]`
   (no nearby corpus, all-off-route, or a degenerate route). `POST /drives` does NOT reject an empty
   selection — it inserts the drive, bumps demand, returns `clips: []`
   (`apps/api/src/drives.ts:442-498`), and the client navigates in regardless (`create.tsx:105`).
   The confirm screen would show a "0 STORIES" badge but still enables "Make this drive". **Recommend:**
   server-side `422` when `stops.length === 0` (authoritative; the client already surfaces ApiError
   messages, so no client change needed), and disable the confirm CTA when `estStopCount === 0`.
   *Hold the guard until the LOOP behavior is known* — a degenerate loop is the most likely way to
   hit 0 stops, and a blanket "no stories" error would mask that root cause.
2. **🟠 Loop = `start == end` with no intermediate waypoint.** `materializeRoute([A, A])` may not
   produce a real loop. VERIFY first (edge case above); if Google returns a degenerate route, loops
   need an intermediate waypoint (mid-route anchor) — not just identical endpoints. The "Emerald Bay
   loop" suggestion chip makes this load-bearing.
3. **🟡 No post-geocode region containment.** `geocode` uses the region bbox as a *bias* only
   (`drives.ts:86-106`); the `inRegion` LLM flag + a ", Lake Tahoe" suffix are the only guards.
   `POST /drives` re-validates nothing. A same-named place could geocode just outside the region.
   Low impact (auth'd toy), but a cheap hardening is a bbox-containment check on the geocoded coords.
4. **🟡 Free-cap check is non-atomic (TOCTOU).** Count-then-insert (`drives.ts:413-428` + the insert)
   races: two concurrent creates at 9 both pass → 11. Negligible for a single user; note only.
5. **⚪ RESOLVED (2026-06-19).** The stale V1 doc-comments in `apps/mobile/src/lib/api.ts` are gone:
   the V2 naming pass landed — lines 4-7 now describe the V2 drives client (GET /drives, GET
   /drives/:id, POST /drives/propose, POST /drives; plus GET /regions, GET /roam) with zero
   "tour" / "GET /tours" references, and line 42 is `this.name = 'ApiError'`.
6. **⚪ Forward-looking, NOT a live bug:** `toClipForm` coerces `bside`→`story` and nothing filters
   drive corpus by form (`drives.ts:62-71`, `loadCorpusForRoute`). The corpus is 100% `story` today,
   so this is inert; when `scenic`/`wave` forms ship they will flow into drives by design.

## Verified-sound (recorded so they're not re-investigated)

- `corpus.get(s.poiId)!` at create is safe — `buildDrive` only emits poiIds drawn from the same
  corpus map, so every selection item resolves (`drives.ts:451-462`).
- Drive privacy/ownership holds: `loadOwnedDrive` 404s on not-yours; `GET /drives` filters by
  `userId` (`drives.ts:534-581`).
- The "a drive never hangs on a dead clip" invariant is well-defended: pre-start watchdog (re-sign
  once → skip), post-start interruption/stall recovery, and `buildDrive`'s queue-lag drop.
- Offline-first load (`loadPlayback`) serves `file://` when downloaded, else inline presigned URLs.

## Accept bar

Happy path 1–6 clean; LOOP + SPARSE behaviors understood (and any Finding-1/2 fix applied); cap +
out-of-region messages correct. Then hand to the founder ear-pass (is the *selection* charming, are
the stories well-ordered for the route?) and the real-device drive.
