# TODO — engineering backlog

Carry-forward **engineering** items (the near-term layer of the truth system — see
`docs/README.md`; product ideas live in `docs/ideas/`, build-ready designs in `docs/specs/`).
Each item has enough context to action without re-deriving the reasoning. **Delete items
when done** — git history is the archive.

## Content + LLM-discovery marketing op — kick off during App Store review (founder ask 2026-07-24)

Dead-time play: App Store review is idle builder-time, and **distribution is the project's named
UNSOLVED existential question** — `docs/research/autio-content-moat.md` §"the honest hole" says it
outright ("acquisition is the thing still to actually solve"), and Detour "died beloved, no
distribution" (`docs/research/competitive-research.md`). Content compounds while we wait, so start now.

⚠ **This must NOT become "rebuild Autio's SEO factory."** That same doc is a founder-blessed DON'T on
exactly that: their comparison/listicle machine is a **trap** ("in a comparison table, breadth wins and
charm has no cell" — 25k stories > our ~19 stops "by construction"), and out-publishing it plays FOR
their niche-subscription plateau, not past it. CLAUDE.md's charm-not-scale + the doc's "refuse the
category" say don't fight on the breadth grid. So "match/rival Shaka + Autio" = match their *presence
and polish*, NEVER their breadth-comparison content.

**The doctrine-safe wedge (and the real point of the founder ask): LLM answer-discovery (GEO/AEO).**
When a rider asks ChatGPT/Gemini/Claude "what's a good audio tour for driving around Lake Tahoe?", the
model SYNTHESIZES an entity-grounded answer — it is NOT the breadth grid where 25k>19 wins. A
**region-deep character companion, a category of one**, can be surfaced there on merit, because the
signal is entity presence + citable structured facts — exactly the asset we already own and they don't:
- Our corpus is **Wikidata/Wikipedia-grounded** (`pois` deduped by QID, `pois.fact_sheet`, `narrations`)
  — real, sourced, structured facts, with **CC BY-SA attribution already frozen** per the CLAUDE.md
  invariant. That is the raw material LLMs cite; Autio's celebrity-voice catalog is opaque audio a model
  can't read.
- So the honest, uncopyable positioning ("category of one," region-honest, one continuous character —
  `autio-content-moat.md` §"what this steers") IS also the GEO-optimal one. For once the strategy and
  the discovery channel point the same way.

FIRST STEP is RESEARCH, not building (founder doctrine: validate ROI + pre-mortem before infra;
brainstorms land in `docs/ideas/` first — the idea→spec cadence). GEO best-practice moves fast and my
training is stale — ground it in current sources and cite.

- [ ] **Strategy pass → `docs/ideas/llm-discovery-marketing.md`.** Research current GEO/AEO tactics
      (schema.org structured data, entity SEO, the `llms.txt` proposal's real adoption, WHICH sources
      the big models actually retrieve/cite, Reddit/forum presence), pre-mortem, ROI. Reconcile with
      `autio-content-moat.md` (refuse-the-category) so we build the answer-discovery wedge, NOT a
      comparison factory. Founder greenlight promotes it to a spec + backlog work.

Concrete candidates the research pass should size (do NOT build until greenlit — several touch the live
corpus and want a design/ROI call):
- **AI-crawler posture in `apps/site/public/robots.txt`.** Today it's blanket `Allow: /` (so GPTBot /
  Google-Extended / ClaudeBot / PerplexityBot are already permitted) — since we WANT discovery, keep it
  open; consider naming them explicitly + confirm the sitemap covers any new content pages.
- **Structured data on skipper.fm** (JSON-LD: `TouristAttraction` / `TouristTrip` / `AudioObject`) so the
  entity "Skipper — Lake Tahoe driving companion" is machine-legible. `apps/site` is static Astro.
- **Programmatic region/POI content pages built FROM the corpus we already own** — a "Lake Tahoe driving
  audio tour" hub + per-POI story pages (carrying the required CC BY-SA credit). The corpus→web lever no
  competitor can match; also the biggest build, so it wants the ROI pass first.
- **Off-domain presence in the sources LLMs cite** (Reddit, r/roadtrip, authoritative Tahoe guides) — the
  doc is explicit our own domain ≠ discovery; models weight third-party mentions.

Refs: `docs/research/autio-content-moat.md` (refuse-the-category + the unsolved-acquisition hole),
`docs/research/competitive-research.md` (Detour distribution post-mortem), `apps/site` (static Astro on
skipper.fm; `astro.config.mjs` sitemap + `public/robots.txt`), the Wikidata-grounded corpus
(`pois`/`narrations`/`fact_sheet` + the CC BY-SA attribution invariant in CLAUDE.md).

## PostHog telemetry — Stage 2 (native crashes) + Stage 3 (session replay)

Stage 1 is SHIPPED (2026-07-17): `apps/mobile/src/lib/analytics.tsx` — the pure-JS PostHog base SDK
(`posthog-react-native@4.57.0`) wired at the root layout via `AnalyticsProvider`, giving product
analytics + **JS-level** crash autocapture (uncaught exceptions + unhandled rejections) + manual
expo-router screen tracking + the root `ErrorBoundary` reporting render crashes through the module
singleton `captureError`. Env: `EXPO_PUBLIC_POSTHOG_KEY`/`_HOST` (US host), in gitignored
`apps/mobile/.env` + all three `eas.json` profiles + the `.env.example` catalog. Verified: mobile
`bun run check` green + `expo export` bundles clean. This closes the analytics gap and a large share
of RN crashes — but NOT the app-killed / native-fault case.

**Stage 2 — native crash capture (the "died in the car" case).** CODE + EAS config SHIPPED
(2026-07-17); only the founder-owned native rebuild + verify remain.

Done: `@posthog/react-native-plugin@2.2.3` installed; `errorTracking.autocapture.nativeCrashes: true`
in `analytics.tsx`; the `posthog-react-native/expo` config plugin (`uploadNativeSymbols: true`) in
`app.json` (it AUTO-sets iOS `ENABLE_USER_SCRIPT_SANDBOXING=NO` — no manual Xcode step); `metro.config.js`
wrapped with `getPostHogExpoConfig`. Build-time symbol upload authenticates via EAS env vars
`POSTHOG_CLI_API_KEY` (secret personal key) + `POSTHOG_CLI_PROJECT_ID` (`517151`), set on the
`@manoa-inc/skipper` EAS project across production/preview/development — NOT in any committed file (the
public `phc_` runtime key stays in eas.json; the `phx_` upload key is EAS-secret-only). Verified: mobile
`bun run check` green + `expo export` bundles clean + `expo config` introspect loads the plugin.

Remaining (founder-owned):
- [x] ~~Confirm the Skipper PostHog project has exception autocapture on~~ — verified via API
      2026-07-17: `autocapture_exceptions_opt_in = true` on project 517151 (PostHog's default).
- [ ] **Native rebuild** — `expo prebuild --clean` + a fresh EAS/TestFlight build (a JS-only OTA won't
      link the native module or run the upload build phase).
- [ ] **Verify on a RELEASE build** (not the `expo run:ios` dev client, which skips the upload phase):
      force a native crash, confirm a SYMBOLICATED report lands in the Skipper project.
      **⚠ Verification landmines — each one silently produces a false "it's broken":**
      1. **Detach the debugger.** A native crash reporter installs a signal/Mach-exception handler;
         an attached debugger (Xcode, or a dev client) intercepts the fault FIRST, so nothing is ever
         written. Launch the TestFlight build standalone, from the phone.
      2. **Relaunch after crashing.** The report is written to disk during the fault and uploaded on
         the NEXT app launch — the dashboard stays empty until you reopen the app. Don't call it a
         failure at step 1.
      3. **Force a REAL native fault, not a JS `throw`.** A JS throw is caught by the JS autocapture
         path (already shipped in Stage 1) and proves nothing about the native module.
      4. **Confirm BOTH upload phases in the EAS build log** (dSYM/native symbols AND the Hermes
         source map) before you even install — a missing phase means the report lands unsymbolicated
         and the crash looks like it never arrived.
      5. **Do a plain launch smoke test on iOS 26 / arm64e first.** ⚠ UNVERIFIED — this came from a
         research pass citing a PostHog issue (reportedly #3562) that I could not confirm against
         source; treat it as "spend 30s ruling out a launch crash," not as established fact.
- [ ] EAS Update OTA caveat: native symbols are fixed at build time, so after each `eas update` run
      `posthog-cli hermes upload --directory dist`. Wire into a release script only if OTA channels are used.

**Stage 3 — session replay (opt-in, deferred).** A GPS/audio app: native map/camera/audio views are
ALWAYS masked on iOS by default, so it's privacy-safe, but it adds a native module + a recording
decision.
- [ ] `npx expo install posthog-react-native-session-replay` (note: consolidating into
      `@posthog/react-native-plugin` — follow the current install doc), set `enableSessionReplay: true`
      + keep `sessionReplayConfig` masking at defaults (all ON). Enable replay in project settings.
      ⚠ Do NOT enable on Android without re-checking the known new-arch replay crash ("Cannot get a
      dirty matrix!").

Refs: `apps/mobile/src/lib/analytics.tsx`, `apps/mobile/app/_layout.tsx`, `apps/mobile/app.config.ts`
(where the config plugin goes), `apps/mobile/metro.config.js` (the Metro wrap), `apps/mobile/eas.json`.

## Location: When-In-Use → background updates (deferred half of permission priming; NO "Always")

The pre-permission **explainer** shipped 2026-06-13 in front of the *When-In-Use* prompt
(`docs/decisions/location-permission-priming.md`). The **background-updates** escalation — screen-off /
phone-in-pocket triggering (foreground `watchPositionAsync` dies on lock, so the drive holds the screen
awake via `expo-keep-awake`; if it ever locks, audio plays on but GPS triggering silently stops) — is now
a **build-ready spec: `docs/specs/background-location-spec.md`**.

- [ ] Build it — but ONLY after a real-device drive shows foreground + keep-awake triggering is
      insufficient locked/pocketed (the founder's empirical gate). ⚠ This path is **When-In-Use ONLY, NOT
      "Always"**: a source-level read of the installed expo-location proved `startLocationUpdatesAsync` needs
      only foreground permission (expo PR #33617), so the review scope is the standard nav-app one, not the
      heightened Always scope. Work: transport re-architecture (foreground `watchPositionAsync` → a
      `startLocationUpdatesAsync` TaskManager task; adds `expo-task-manager`), flip `isIosBackgroundLocationEnabled`
      (KEEP the Always strings false; never call `requestBackgroundPermissionsAsync`), a small copy tweak,
      review notes, and a native rebuild. Full checklist + source proof + gotchas in the spec.

## Roam build pass 2 — LOCKED by the founder 2026-06-11 (the "companion grows up" pass)

> ⚠ **The chattiness axis (quiet/normal/talkative) was CUT** (2026-06-20 — too coarse, not useful in
> practice; `useRoam.ts`, MEMORY "Roam chattiness toggles"). Don't build anything that assumes it
> (e.g. wave suppression "on quiet") — there's ONE fixed cadence now. Cadence variety, if ever wanted,
> returns as auto-adaptation, never a user notch.

Two items locked from the 2026-06-11 brainstorm (full capture: `docs/ideas/free-roam-mode.md`
§Alpha learnings). Order within the pass is free; both are founder-facing on his daily drive.

- **Waves: narrate the scenic tier — CODE BUILT 2026-07-24, awaiting the PAID run.** The $0 half is
      done and verified green (root + mobile `bun run check`); nothing has been generated or spent.

      What shipped: `generate-narrations --wave` selects `source='wikidata'` scenic pins with no
      narration (disjoint from the story query, so the two modes can never contend for a poi), narrates
      them at a form-level 15s/20s band (`lengthForWave`, models.ts — deliberately outside
      `REGISTER_LENGTH`, whose 60s floor would prompt a wave to pad a minute it has no material for),
      routes them as `stopType:'scenic'` + `wave:true` so the named-scenic grounding rules score them
      unchanged, and persists `form:'wave'` with `facts_hash` NULL (no facts → nothing can go stale) and
      `attribution` NULL (the CC BY-SA duty attaches to adapted WIKIPEDIA text; a wave adapts none, and
      Wikidata is CC0). Freshness for a wave is "does a narration exist" — without that it would read
      perpetually stale and every run would re-pay. The WAVE grammar is taught in `persona/skipper.ts`
      (a fourth stop kind + three examples) and enforced in the sheet (`pipeline/narrate.ts`); geology is
      suppressed on waves at the sheet builder, not just the caller, so it can't leak back in.
      Roam priority is **distance-band, then form** (`bandM: 300` in `packages/engine/src/roam.ts`,
      threaded `narrations.form` → `roamPin.form` (optional, wire-compat) → `useRoam` → engine), with 5
      new engine tests covering both halves of the rule.

      ⚠ **A wave must NEVER become a drive stop**, and it silently would have: `loadCorpusForRoute`
      filtered on bbox + released only, so once waves are released `buildDrive` would have picked
      one-liners as stops (the wave corpus is ~3× the story corpus). Fixed with `ne(narrations.form,
      'wave')` in `apps/api/src/drives.ts` — deliberately NOT in `loadCorpusByPoiIds`, which resolves an
      already-frozen selection where filtering would break a saved drive instead of playing it.

      **SMOKE-TESTED TWICE (2026-07-24, $0.66 total) — both runs found real defects, both now fixed.**

      Run 1 (3 pins, $0.25) shipped 3/3 but exposed two problems. **Monotony was structural, not a
      prompt weakness:** 2 of 3 opened "There's a peak out there called X. Standing … against the sky
      today." Roam clips are narrated in a VACUUM — `narrate.ts` has `recentOpeners`/`recentClosers`/
      `recentMotifs` and `generate-narrations` passes NONE of them, and `evaluateDiversity` sees one clip
      at a time so it only catches within-clip tics. A story varies for free because its facts differ; a
      wave has two fields, so 378 independent calls converge on one sentence. Fixed with **`WAVE_ANGLES`**
      — six assigned opening shapes, round-robin by queue index (`waveAngleFor`), chosen over a rolling
      recent-openers buffer because a buffer leaves the first `NARRATION_CONCURRENCY` clips colliding
      while an index rotation holds at any concurrency. Every angle stays inside the name+kind ceiling.
      **Second defect: a NULL kind made the narrator infer the kind from the NAME** — "Cathedral Peak"
      (kind NULL) came back "there's a peak out there". Harmless when the name is honest, a fabricated
      fact when it isn't (a "Castle Rock" that is no rock), and **the grounding gate PASSES it** because
      the claim traces to the name. Waves now REQUIRE a kind (9 pins dropped, reported not silent).

      Run 2 (6 pins, $0.41) was the verification: **6 MOUNTAINS — same kind on purpose, the worst case
      for monotony — produced 6 distinct openers**, no two sharing a template (name-flat, thing-first,
      reaction-first, kind-plainly, and a genuinely free groaner: "Big name for a big fella" off Big
      Chief). Kind now comes from the card, not the name. The excision path fired on 2 of 6 (the gate
      caught over-reach and trimmed rather than withheld) — fail-closed machinery working. Lengths ran
      4–9s, UNDER the 15s aim, which is correct doctrine (a name-only wave lands short; `evaluatePacing`
      is one-sided and never flags short).

      **CURRENT SPEND: 378 clips, dry run quotes ~$31 (~$28 narration+gate + ~$3 TTS), ≈95 min.**
      Measured per-clip in run 2 was $0.068 vs the $0.075 estimate, so the real number is likely ~$29.
      (The long-dead "~$3–5" assumed ~126 clips AND that the grounding call shrinks with the clip; it
      doesn't — that call is priced by the JUDGE's prompt.) ⚠ `--scripts-only` DOES spend
      (`apply: apply || scriptsOnly`); only the no-flag dry run is free. Use `--max-cost` on the real run.

      Open founder calls before the go:
      - **Whole 378, or a kind-capped subset?** By kind: park 81, valley 71, mountain 69, hill 43,
        spring 39, beach 14, lake 12, meadow 10, reservoir/bay 9 each, ridge 7, cape 6, tail ~15.
      - **2 parcel/facility records remain** ("Ward Creek Park Property", "Fallen Leaf Recreation
        Center") — country you wouldn't wave at. The tragedy/crime taste gate runs in wave mode but
        doesn't catch this category. 2 of 378; not worth a mechanism unless more show up.
      - **One cosmetic blemish seen post-excision:** Herlan Peak closed "...against the sky today, too."
        The dangling "too" has nothing to refer to in a self-contained clip. Watch for it at ear-pass;
        if it recurs it's an excision artifact, not a prompt bug.

      Remaining after the run:
      - [ ] **RELEASE — without it the acceptance drive shows ZERO waves.** Generation writes
        `releasedAt = NULL` and `/roam` serves released-only (`apps/api/src/index.ts`). ONE call, not
        387: `POST /admin/regions/:slug/release` bulk-stamps every staged clip in the bbox and is
        re-runnable (preserves the first release date, touches only `released_at IS NULL` rows —
        `apps/admin/server/index.ts:202-239`). Per-clip release exists for spot fixes.
      - [ ] **Ear-pass the wave read.** Waves currently inherit the LANDSCAPE register read when the pin
        is unclassified (a natural feature glanced at, not the fact-forward story read). A dedicated
        per-FORM style suffix is the separate DEFERRED item below — now unblocked, since waves will
        finally exist to listen to.
      - [ ] Waves are CLI-only; the admin console can't trigger a wave run. Add a mode toggle only if
        the founder wants to run them from the console (would touch the Reference cheat-sheet).
- [ ] **The sonic cue.** ~1s entry motif before every encounter (the duck gets a reason; the
      startle dies) + a soft exit/resolve note as the duck releases. Client-side bundled assets
      (`apps/mobile`), played around the clip in `useRoam`. Sound design taste-gate: founder ear
      on the motif BEFORE wiring (charm shortlist already names sound design).
      ⚠ **Name the asset/hook a "sting," never "motif"/`RoamMotif`** — that name is TAKEN by the
      VISUAL idle car component (`apps/mobile/app/roam.tsx:67`, referenced from `RoamMap.tsx` +
      `useRoam.ts`); reusing it for audio makes both unsearchable.

## TTS audio QA: clip loudness normalization

The mechanism shipped 2026-06-11: every ship path (`generate-narrations`, `resynth-narration`)
re-synths once on a ≥3 dB tail-collapse drop (the "mumble"), then linear-loudnorms the winning take
to the **master spec** (−14 LUFS / −1.0 dBTP — `AUDIO_LOUDNESS` in `@skipper/shared`; studio's
`LOUDNORM_*` derive from it) via `pipeline/tail.ts` + `pipeline/loudnorm.ts`. Kills the clip-to-clip
spread + the quiet-vs-Spotify gap. The drive-music rotation is now mastered to the SAME spec
(2026-06-19), so voice + music match. Spec + history: `docs/decisions/audio-loudness-spec.md`.

REMAINING — **founder on-device A/B vs Spotify** of the −14 / −1.0 level (narration + music together),
before the first paid full regen. If it still reads low, nudge `AUDIO_LOUDNESS.integratedLufs`
(−13/−12) or the TP ceiling further toward 0 — one edit, re-master both surfaces.

Refs: `pipeline/loudnorm.ts`, `pipeline/tts.ts`, `pipeline/tail.ts`, `models.ts` (LOUDNORM_*),
`packages/shared/src/audio.ts`, `docs/decisions/audio-loudness-spec.md`,
`docs/decisions/audio-compression-spike.md`.

## TTS delivery: differentiate the style prompt by narration FORM — DEFERRED 2026-06-19

The per-REGISTER half of this already shipped: `ttsStyleFor(baseStyle, register)` (`models.ts`) appends
a landscape/story/town/civic suffix onto the shared base (called at `generate-narrations.ts`), so the
one host already modulates his read by place type. What's still open is differentiating by narration
**form**: `SKIPPER_TTS_STYLE_PROMPT` is one static directive and the corpus is generated `form:'story'`
today, so the non-story forms have no tailored read. The win when they land: extend the suffix by form —
scenic = "slow a touch, leave air, wonder not performance"; break = "quick light aside, no ceremony";
wave = "brief passing call-out" — keeping the universal **base** (persona + the load-bearing
**anti-fade** clause) and appending a per-form suffix. One-line swap at the call site.

**Why DEFERRED (founder, 2026-06-19):** the non-story forms had **no output to act on and nothing to
ear-test** until they shipped. ⚠ **Partly unblocked 2026-07-24:** the WAVE form is now built (see the
roam pass-2 item), so once the paid wave run lands there IS a wave read to judge. Today a wave inherits
the LANDSCAPE register read when its pin is unclassified — a reasonable default among the EXISTING
reads, not a wave-specific suffix. Do the suffix on a founder ear-complaint about the wave read, in the
same pass as the wave ear-check; `break` (`detours`) is still stubbed, so its variant stays deferred. The single Skipper story read stands until then,
and is only touched on a specific founder ear-complaint (never re-tuned blind — see the `models.ts`
warning). NOTE: there is NO per-joke "notch" axis here — the joke notch was CUT
(`docs/decisions/cut-joke-notch.md`); delivery variety returns later as different NARRATORS, not a notch.

## De-stale the deferred specs that still assume the intro frame + personal kit

The intro/outro frame + the "cousin Ray" personal kit were KILLED 2026-06-19 (founder call): V2 had
already deleted asides (placeless framing), so the frame prompt + `PersonaDef.kit` + the kit
diversity-lint were dead code, and the kit only ever leaked weird jokes into stops. All removed; the
stop prompt now tells the host he invents NO backstory (`persona/skipper.ts`). Several DEFERRED specs
still describe an intro/outro frame and/or the personal kit as if they exist:
`docs/specs/{tell-me-more,downtime-callouts,drive-thesis,scenic-stops,ask-the-skipper,tour-structure}-spec.md`.

- [ ] When each of those specs is next picked up (they're DEFERRED, not active), reconcile it with
      "no intro/outro frame, no personal kit" — OR, if a "welcome aboard" intro is wanted as a real
      feature, spec it fresh (it could be a charm win — meeting the host). Don't bulk-rewrite them now;
      flag-on-touch is enough since none are being built.

## In-app narration volume trim — DEFERRED pending the −14 ear-gate (founder feedback 2026-06-11)

Founder ask: an in-app control to make NARRATION slightly louder/quieter, INDEPENDENT of device
volume and other apps. **Decision 2026-06-11: don't build it yet** — nail the global −14 LUFS target
at the ear-gate first and see whether a per-listener trim is even needed once levels are consistent.

Design conclusions if/when it IS built (so this isn't re-litigated):
- Mechanism is simple + standard: expo-audio's narration `AudioPlayer.volume` (0..1) is a per-player
  gain that touches NOTHING else (device volume, the rider's music, the `driveMusic.ts` bed all
  stay put). Persist a notch setting (sim-mode pattern) → set `player.volume` in `useDrive`+`useRoam`.
- **Lean toward ATTENUATION-ONLY** (default = unity = the matched −14 level; notches only go softer,
  e.g. a sleeping passenger). It has no encode coupling and doesn't fight loudness normalization —
  streaming (Spotify/Apple/YouTube) deliberately normalizes-to-target and DROPPED user loudness
  boosts, so a "push above −14" control works against the −14 work we just did. "Louder overall" is
  then a global-target call at the ear-gate, not a per-listener boost.
- The bidirectional version (Softer/Normal/Louder) is a WORKAROUND: `player.volume` clamps at 1.0
  (attenuates, can't amplify past source), so "Louder" needs clips encoded ~1.5 dB hotter than the
  playback default — which couples the notch values to the loudnorm target. Only worth it if a real
  "skipper a touch louder than my quiet-music device volume" need shows up. True >unity boost would
  need a real gain node (AVAudioEngine / Web Audio / react-native-audio-api) — overkill for v1.
Refs: `useDrive.ts` / `useRoam.ts` (the narration player), `models.ts` (LOUDNORM_* target).

## Drive music bed — CONFIRM-ON-DEVICE it plays under V2 drives (static trace: it should)

Founder ask 2026-06-19: "reintroduce / does the music play in V2 drives?" **Static investigation
(2026-06-19) found the bed is fully wired and SHOULD play — nothing was removed in the V2 reshape.**
Evidence chain:
- `useDriveMusic` (`apps/mobile/src/lib/driveMusic.ts`; 17 bundled tracks under `assets/audio/`,
  credits in `licenses.ts`) is live-wired into `useDrive.ts` (~L891), which is exactly what the V2
  player `app/drives/[id]/play.tsx` mounts (`useDrive(id, { mode: driveMode })`). No feature flag.
- `useAudioPlaylist` (+ `.play/.pause/.next/.volume`) is a REAL export in the installed expo-audio
  **56.0.12** — the API the hook depends on exists.
- The gating opens audible windows in EVERY mode: between stops `activeSeq` goes null while
  `driving` stays true (`onClipDone`→`setActiveSeq(null)`+`pump()` in sim/live; explicit `drive`/
  `rest` segments in preview), so `active: driving && !done && !paused && activeSeq === null` is true
  between stops. The earlier "the `activeSeq` gating may be the bug" guess was DISPROVEN.
- Ruled out the main two-player session suspect: the narration player's `setActiveForLockScreen(false)`
  between stops only calls `MediaController.setActivePlayer(nil)` (clears the lock-screen Now-Playing
  owner) — it does NOT deactivate the AVAudioSession (verified in expo-audio's `AudioPlayer.swift` /
  `AudioModule.swift`), so it can't silence the separate music `AVQueuePlayer`.

Could NOT do a live listen this pass: Metro (8081) was down, the app wasn't on the booted sim, and
sim audio isn't capturable anyway. So one box remains — a human ear (or instrumented proof):

- [ ] **Confirm by listening.** Start a sim drive (Settings → dev sim toggle, or `__DEV__` defaults to
      'sim') and confirm the bed fades in between stops and ducks to silence under each narration. If
      it's SILENT, the only residual static-unprovable risk is whether the two simultaneous expo-audio
      objects (narration `AVPlayer` + music `AVQueuePlayer`) actually MIX on-device vs one stealing
      focus — iOS's session model says they mix within one app, but it's the one thing a trace can't
      guarantee. (Definitive non-ear proof if wanted: temporarily log `useAudioPlaylistStatus(playlist)
      .playing` in the hook and watch it flip true between stops.)

(The drive-music **level** task is DONE 2026-06-19 — the 17 tracks were re-mastered to the −14 / −1.0
master spec; only the *audible-under-V2-drives* confirm above remains. See `audio-loudness-spec.md`.)

Refs: `apps/mobile/src/lib/driveMusic.ts` (`useDriveMusic` + the `TRACKS` rotation),
`apps/mobile/src/lib/useDrive.ts` (~L888 the soundtrack effect; `onClipDone`/`pump` at ~L397-429),
`apps/mobile/app/drives/[id]/play.tsx` (the V2 player + `driveMode`).

## Offline downloads: full re-pull only (no per-clip diff)

DONE: a re-cut clip (a `resynth-narration` or a regen) is detectable + recoverable on-device — each
stop carries a `revisedAt` token, the offline manifest embeds it, and the drive screen compares a
fresh fetch (`isDownloadStale`) → a "Fresh cut ready" chip + a "Pull the fresh copy" ⋯ action (never
forced; offline play keeps the saved bytes until the rider re-pulls).

REMAINING (post-MVP): the re-pull re-downloads EVERY clip, not just the changed ones. A per-clip diff
(download only the stale clips, merge into the existing manifest) — only matters once drives are large
or strangers hold many offline.

Refs: `apps/mobile/src/lib/offline.ts`, `apps/mobile/app/drives/[id]/index.tsx`,
`packages/shared/src/schemas.ts` (`driveManifest`/`revisedAt`), `apps/api/src/index.ts`.

## Upstream-contribution drafts for the active poi_overrides (agent drafts, human submits)

The fact-overrides loop's "contribute back" half is designed but UNBUILT: we correct upstream
source errors locally (`poi_overrides`), and the right thing is to also fix the SOURCE. Posture
(from the decision doc): **agent drafts, human submits** — Wikipedia's bot policy (WP:BOT) + COI
norms rule out autonomous editing, so an agent reads the `not_filed` rows (each already carries the
correction + an authoritative `source_url`) and drafts the talk-page post / edit; a human reviews
and files it, then sets `upstream_status` → `filed` (+ `upstream_url`).

Three ACTIVE fact_edits are draftable (all `upstream_status = not_filed`):
- **Lennart Palme** — Vikingsholm's architect (Emerald Bay State Park, wikipedia `1985884`); the
  article says "Leonard." Source: vikingsholm.com + Wikipedia's own Vikingsholm article.
- **Pope Estate builder/decade** (wikipedia `39007559`) — the article credits Lloyd Tevis / 1880s;
  correct is George Tallant (Crocker Bank) 1894, with the Tevis family buying it in 1899. Source:
  taylortallac.org history.
- **Chambers Lodge 1863** (wikipedia `32308786`) — the article says "first established in 1854";
  John McKinney established Hunter's Retreat at the site in 1863. Source: donsnotes.com + others.

NOT this list: the Tahoe Keys row is RETIRED (`active = false`, 2026-06-10) — Wikipedia already
removed the dated construction sentence, so there's nothing left to file.

- [ ] Draft a per-row talk-page correction (claim → correction → authoritative source, in
      Wikipedia's neutral register) for the 3 active rows; surface for human review + filing.

Refs: `docs/decisions/fact-overrides-and-veracity.md` ("Contribute back" + the discipline line),
the `poi_overrides` table rows (reasons + source_urls; curated via the admin console),
`poi_overrides.upstream_status` / `upstream_url` (the workflow columns).

## Autio competitive borrows (small in-car/UX wins)

From a 2026-06-10 teardown of Autio (formerly HearHere — the closest real-world comp:
curated, celebrity-narrated, GPS-triggered road-trip audio; 4.8★, ~70% renewal). Their
ceiling is coverage gaps + multi-narrator inconsistency — both things our generation +
single-Charon model already answer, so the moat (persona continuity, in-car quality) is NOT
a feature to copy. This borrow is small and serves that moat. NOT borrowing:
subscription-first pricing, celebrity narrator roster, national free-roam pin-map,
over-broad trigger radius (all anti-charm or anti-doctrine).

- [ ] **Pause+resume music in roam — DEVICE-VERIFY (built 2026-06-11).** Founder feedback: BOTH
      players pause+resume the rider's audio, never duck. The TOUR player was already `doNotMix`
      (its own bed fades to silence under narration), so this was a ROAM-only change, now IN CODE
      (`useRoam.ts`): opens `mixWithOthers` (rider's audio untouched through the quiet), takes
      exclusive `doNotMix` only on the sawFresh edge (real audio), hands focus back (`mixWithOthers`)
      on clip-end / hold / teardown. Taking focus on sawFresh (not clip-load) means a silent
      pre-buffer / dead-zone skip never strands the rider's music paused. ⚠ REMAINING: the RESUME is
      device-only — expo-audio has no session-deactivate, so we rely on iOS resuming Spotify/podcasts
      when we flip back to `mixWithOthers` (grounded in SDK 56 docs, but the actual resume is
      unverified). Run runbook §6 (resume after a 60s encounter, re-pause on the next, dead-zone skip
      never interrupts) before relying on it. Refs: `useRoam.ts`, `docs/guides/device-verification-runbook.md` §6.

Validated-already (no action): our anonymous couch preview = Autio's
tap-a-pin preview; the M3 notch/interests-as-setting = their interest-ordered queue.
