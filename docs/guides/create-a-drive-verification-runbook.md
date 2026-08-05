# Create-a-Drive verification runbook (V2)

> **Update (2026-07-16):** the couch **PREVIEW is CUT.** Create-success now lands on the drive-detail
> page (not a `?mode=preview` player), and that page IS the mini-preview: a List/Map toggle + tap a stop
> to hear one clip. Read every "preview" step below (esp. §"Preview plays") as "the drive-detail
> mini-preview": expect to land on the detail page, toggle List/Map, and tap stops — NOT a full-screen
> autostarting simulated drive. See [`../decisions/detail-page-mini-preview.md`](../decisions/detail-page-mini-preview.md).

> **Status:** ⚠ **SUPERSEDED BY 1.1 (2026-08-02) — do not execute this as written.** ⚠ **Further
> superseded 2026-08-05 by the download-before-start gate**
> ([../designs/download-before-start.md](../designs/download-before-start.md)): a drive's audio is now
> only ever played from DISK, the streaming/re-sign path is DELETED, and Start is gated on a complete
> local copy that begins downloading the instant the drive is created. Happy-path steps 5–6, the DEAD
> CLIP edge case and two *Verified-sound* bullets were rewritten that day to check the gate instead of
> the re-sign ladder that no longer exists. Three of its preconditions are also now false: the FROM/TO
> **pickers are deleted** (home IS the conversation — D6), so
> steps 1–2 have no screen; roam is gone, so "Roam is primary" describes nothing; and — the one that
> can do damage — **"roam is the only anonymous surface" is now the OPPOSITE of the rule.** Anonymous
> riders get plan, propose, and one preview clip from their own route; the wall is `POST /drives`
> alone, enforced **per-ROUTE**. Anyone who "restores" the 401 by mounting `requireAccount` on the
> `/drives` sub-app silently re-walls the whole preview (CLAUDE.md says so twice). **The 1.1 replacement
> is [1-1-submission-sweep.md](1-1-submission-sweep.md)** — it carries this file's runtime questions and
> [../designs/drives-first-1-1.md](../designs/drives-first-1-1.md)'s Acceptance list forward into steps
> you can execute. ⚠ RISK-1's "drive one for real" was taken OFF the critical path by the founder on
> 2026-08-03 and replaced by that guide's two desk passes; read its §0 for what that trades away.
> Kept because the runtime questions in *Why this exists* are still the
> right questions, and no on-device pass has ever been recorded. Originally:
> guide (written 2026-06-18) — the one-sitting pass that clears the last V2 gate: the
> live **Create→propose→confirm→generate→preview→drive** runtime, which `bun run check` cannot judge
> (it needs a dev build + a signed-in account + a real Maps spend). Code-anchored to the tree as
> of 2026-06-18 — re-verify anchors against the current files before trusting a line number. Pairs
> with `docs/guides/device-verification-runbook.md` (the M1 phone-player pass this builds on),
> `docs/guides/eas-setup.md` (how to build/install the dev build), and
> `docs/decisions/create-a-drive-architecture.md` (the design this reports against).
>
> **Update (2026-06-20) — INPUT MODEL CHANGED: free-text → structured pickers.** The create screen is
> now FROM/TO **anchor pickers**, not a text box: the rider picks a start + end from the region's real
> narratable anchors (`GET /drives/anchors`), and `POST /drives/propose` takes the chosen `{start,end}`
> (+ optional `via` midpoints), no LLM, no geocoding. So the prompt-specific steps below — step 2
> "Prompt → propose", the 🟠 LOOP (canned "Emerald Bay loop" → `start==end`) and 🟠 AMBIGUOUS/out-of-region
> cases — are SUPERSEDED. Re-read them as: pick FROM, pick TO, "Plan the drive" → confirm. **Loops are a
> "Round trip" toggle** that swaps END for a MIDPOINT picker → start→midpoint→start (a real out-and-back,
> never a degenerate zero-distance route); one-way mode disables Plan when start == end. Out-of-region
> can't arise (anchors are in-bbox by construction). See the 2026-06-20 addendum in
> `create-a-drive-architecture.md`.

## Why this exists

The V2 Create-a-Drive flow is fully type-checked + unit-tested (full `tsc` sweep + all suites green
as of the migration). What that **cannot** judge is the load-bearing runtime: does the LLM resolve a
sane in-region A→B, does Google route it, does `buildDrive` pick a charming set of stops along it,
does the preview/live player trigger + pace them, and does it degrade gracefully (offline, dead
clip, cap hit). This is the single 🔴 gate left before the founder ear-pass + real drive.

**Spend note (founder-gated).** Each `propose` now spends just 1 Google Routes call (+ a corpus read);
each `create` spends 1 Routes call + a DB write. **No LLM, no geocoding, no TTS, no generation** —
endpoints are picked (not resolved) and drives REUSE the existing 459 shared clips. So a full pass is a
few cents of Google Maps, not a paid regen. Still, per CLAUDE.md the *spend* needs an explicit founder
OK before firing.

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
3. **Confirm → create.** "Make this drive" → `GENERATING_LINES` beat → it `router.replace`s onto the
   new drive's **detail page** (`/drives/[id]`) — NOT a player. Back should return home, not the spent
   create flow.
4. **⚠ The copy comes down BY ITSELF, and Start waits for it (2026-08-05).** Do nothing — just watch
   the placard's permit row on the screen you were just pushed onto. Expect: a `Saving k/total` label
   appears within a second or two of landing (the CREATE HANDLER fired the download, not the screen —
   `app/index.tsx`), the primary CTA reads **"Saving for the road…"** and is DISABLED with
   "Start opens up the moment the last stop lands." under it, and then — with no tap from you — the
   chip flips to `Saved offline` and the CTA turns itself into the live Start. On our largest drive
   (~11 MB) that whole window is ten to twenty seconds on LTE. Watch-for: a `Not saved` chip that never
   moves (the auto-download never fired, or failed silently); a CTA that stays disabled after the chip
   says saved; a **"Start anyway"** button anywhere — that string was DELETED, and its reappearance
   means the gate grew a bypass.
   **⚠ Now back out to My Drives and come straight back in.** The transfer is module-level, so it must
   still be running (or finished) — a download that restarts from zero, or a Start that has gone dead,
   means the screen re-took ownership of a transfer it no longer owns.
5. **Detail mini-preview — and it plays only what is on disk.** The detail page IS the preview: the
   placard + a **List/Map** toggle (List default) + the route stops. Tap a stop (a List row or a Map
   pin) → the NOW PLAYING card plays that one clip (scrubber + ±15 + its source credit). Confirm: stop
   names are clean (no ", California"), audio plays, and switching to Map shows the route + pins with
   the playing stop highlighted. ⚠ **Tap a stop DURING step 4's saving window too**: the mini-preview
   resolves from the local store only, so a stop whose bytes have not landed must answer with the
   unplayable line ("That stop didn't come down with the rest…") — never silence, and never a stream.
   The row hint above the list says "Saving for the road…" instead of "Tap a stop to hear it" for
   exactly that window.
6. **The drive itself.** From My Drives → open the drive → tap Start. ⚠ **It is a LIVE, real-GPS drive
   by default, in a dev build too** — `simMode` defaults FALSE everywhere and `__DEV__` does NOT seed
   it (that default is what would otherwise have silently simulated the founder's real drive and
   suppressed the admin trace recorder). For a couch pass, flip **Settings → Developer → SIMULATED
   GPS** on first; the "Real time" vs "8× faster" knob then appears pre-drive. Either way confirm stops
   TRIGGER by proximity (not on a timer), pace sanely (≥3-min gaps), the stop list auto-scrolls, and
   the drive ends cleanly (done card with the stop tally). Also tap a stop the road has **already
   passed** — it re-hears that clip (a live trigger preempts it); an **upcoming** row must not respond
   at all.
7. **Drive it with the network fully OFF — this is now the only way audio is ever served.** With the
   drive saved, turn on **Airplane Mode** (Wi-Fi and any tunnel off too), reopen it and run the drive
   end to end. Expect: the detail page still renders from the saved manifest, Start is enabled, every
   clip plays from `file://`, and the drive completes with zero network. Watch-for: any request at all
   during playback; a clip going quiet after ~an hour (a presigned URL got persisted instead of bytes);
   the ready card claiming stops are missing when they are all there.

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
- **FREE CAP.** A free account is granted `FREE_DRIVE_CAP` credits ONCE in the user-owned
  `credit_entries` ledger; each generated drive spends one (and is NEVER refunded on delete — the cap
  is lifetime, not a live row count). ⚠ Don't assume the value from this page: it lives in
  `apps/api/src/credits.ts` + env, and a rider's own grant is FROZEN at signup, so an existing account
  can legitimately differ from the current setting. Read the balance from admin, then spend it to zero
  and create one more → expect the `403 drive_limit_reached` message (names the cap + the credit-pack
  path; it reports `granted` from the ledger, not the env value). The
  client surfaces the server message as-is. (Ledger model: `docs/decisions/credit-ledger.md`; the
  balance is `SUM(amount)` over `credit_entries`, `apps/api/src/credits.ts`.)
- **⚠ DEAD CLIP — one pass now, not two (2026-08-05).** The re-sign rung is GONE with the whole
  streaming path, so a clip that never produces audio is skipped after ONE wait on the new
  `LOCAL_CLIP_STALL_MS` (`packages/engine/src/player.ts`) instead of two waits on the 12 s remote
  budget. A dead clip therefore costs a couple of seconds of dead air, not twenty-four, and the only
  cause left is a truncated or undecodable **local** file — "our audio is broken", never "no network
  here" (`StopSkipReason.load_timeout`; `resign_failed` was deleted as structurally unreachable).
  ⚠ **The short value is a DESK ESTIMATE and still owes a device check** — see the device runbook's
  §8 item; a device that reports local decode late would skip clips that were fine.
- **⚠ OFFLINE, PARTIAL COPY — the one row where the gate steps aside.** Save a drive, then interrupt
  it (Airplane Mode mid-download, or `⋯` → Cancel download) so some clips are missing. Stay offline and
  open the drive. Expect: Start is **enabled** (blocking a rider we cannot help is pure loss), and the
  player's ready card replaces its usual body with the count — *"N stops didn't finish saving, so I'll
  be quiet when we pass them. The rest of the drive is all here."* Watch-for: the ready card showing
  the ordinary body while stops are genuinely missing (the disclosure is the whole reason this row is
  allowed to roll).
- **OFFLINE, NOTHING SAVED.** Airplane Mode, open a drive that was never saved. Expect a line, not a
  dead button: *"No signal out here, and this one isn't saved yet. We'll roll when the bars are back."*
  Watch-for: a disabled Start with no explanation, or a Save button that fires a download it cannot run.
- **BACK-OUT guard.** While driving, the back chevron + "Pull over" both confirm before ending; the
  edge-swipe is disabled while rolling.

## Findings from the code pass (2026-06-18) — fix decisions for the founder

These came out of reading the full path; none block the happy path on the dense Tahoe corpus, but
each is a real edge. Severity is "how likely to bite a real rider."

1. **🟠 An empty drive (0 stops) is persistable and spends a ledger credit.** `buildDrive` can return `[]`
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
4. **🟡 Free-cap check is non-atomic (TOCTOU).** Balance-check-then-insert (the pre-check in
   `drives.ts` + the `db.batch` consume+insert) races: two concurrent creates at balance 1 can both
   pass and over-spend by 1. Negligible for a single user; the code calls it out as the same TOCTOU
   as the old count gate. Note only. (Credits are the `credit_entries` ledger now, not a `count(drives)`.)
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
- The "a drive never hangs on a dead clip" invariant is well-defended: the pre-start watchdog (ONE
  pass on `LOCAL_CLIP_STALL_MS` → skip, since 2026-08-05 — there is no re-sign left to try), post-start
  interruption/stall recovery, and `buildDrive`'s queue-lag drop. ⚠ The post-start watchdog is NOT a
  streaming feature and stays: `stalled_mid_clip` is call / Siri / Bluetooth-handoff recovery, which
  happens to a local file just as readily.
- ⚠ **`loadPlayback` is DISK-ONLY (2026-08-05).** Its online branch, `resignPlayback`, `signDriveAudio`
  and the `POST /drives/:id/assets/sign` route are all deleted — a drive's audio never resolves to
  `https` again, which is what the gate above is protecting. It still serves a PARTIAL local map rather
  than error-walling a rider holding 39 of 40 stops. ⚠ **This is not "the app never streams":**
  `GET /sample` and the anonymous route-preview clip play BEFORE a drive exists, with nothing on disk
  to play from, and they deliberately still stream on the generous 12 s `PRE_START_STALL_MS`. Never
  "simplify" the boundary away.

## Accept bar

Happy path 1–7 clean; LOOP + SPARSE behaviors understood (and any Finding-1/2 fix applied); cap +
out-of-region messages correct. Then hand to the founder ear-pass (is the *selection* charming, are
the stories well-ordered for the route?) and the real-device drive.
