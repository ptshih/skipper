# TODO — engineering backlog

Carry-forward **engineering** items (the near-term layer of the truth system — see
`docs/README.md`; product ideas live in `docs/ideas/`, build-ready designs in `docs/specs/`).
Each item has enough context to action without re-deriving the reasoning. **Delete items
when done** — git history is the archive.

## Location: When-In-Use → Always/background (deferred half of permission priming)

The pre-permission **explainer** shipped 2026-06-13 in front of the existing *When-In-Use*
prompt (drive + roam; `LocationPrime` + the `'locationPrime'` phase; decision:
`docs/decisions/location-permission-priming.md`). The founder chose to **phase** the tier change:
the Always/background escalation is this deferred item. WHY it matters — foreground location dies
on screen-lock, so the drive keeps the screen awake (`expo-keep-awake`); if the screen ever locks,
audio keeps playing but GPS triggering silently stops (the skipper goes quiet at the next stop).
Always fixes that (screen-off / phone-in-pocket triggering). Native + App Store review work, so
its own pass.

- [ ] Config plugin (`apps/mobile/app.json`): `expo-location` → `isIosBackgroundLocationEnabled: true`
      + `locationAlwaysAndWhenInUsePermission` (skipper-voiced string); add `location` to iOS
      `UIBackgroundModes` (today: `audio` only).
- [ ] `gps.ts liveSource`: `allowsBackgroundLocationUpdates: true` on the watch; reconsider whether
      `expo-keep-awake` can drop once background triggering is reliable.
- [ ] Request **sequence**: foreground first, THEN `requestBackgroundPermissionsAsync()` (you cannot
      ask for Always cold). Extend the `LocationPrime` copy to prime the Always reason — note the
      current copy is When-In-Use-scoped (`voice.ts`: "Parked, I'm off the clock — no tracking"), so
      it needs an Always-rationale rewrite, not just reuse. Reuse the `'locationPrime'` phase.
- [ ] Handle the **"Allow Once" silent-fail**: a same-session background request returns denied with
      NO prompt → route to Settings (the existing reduced/denied gate pattern).
- [ ] Needs a native rebuild (dev build / EAS) + **App Store Review notes** stating background
      location is used solely to trigger GPS-anchored audio during an active drive. Gated behind the
      phone-player bet being proven. Sources cited in the decision doc.

## Roam build pass 2 — LOCKED by the founder 2026-06-11 (the "companion grows up" pass)

> ⚠ **Chattiness toggles (quiet/normal/talkative) are not very useful** (founder feedback
> 2026-06-11). The min-gap governor knob is too coarse and blunt in practice. Before
> building anything that assumes the quiet/normal/talkative axis (e.g. wave suppression
> on quiet), reconsider whether to replace it with auto-adaptation or drop it entirely.

Three items locked from the 2026-06-11 brainstorm (full capture: `docs/ideas/free-roam-mode.md`
§Alpha learnings). Order within the pass is free; all three are founder-facing on his daily drive.

- [ ] **Waves: narrate the scenic tier.** ~126 swept scenic pins sit unnarrated (`pois` story/scenic
      tiers — `discover-pois.ts`). Schema already done (V2): `narrations` HAS a `form` column
      ('story'|'scenic'|'break'|'wave', 'bside' reserved) and a `narrations_poi_uq` unique index on
      poiId (one telling per place); the Zod vocabulary is `narrationForm` in
      `@skipper/shared`. The remaining work is the 10–20s WAVE form in
      `generate-narrations.ts` (grammar: one-liner, self-contained, no laterality/volatile; no "ask
      me about it" tease until B-sides exist). Engine + manifest: waves suppressed on quiet
      chattiness, story-over-wave priority on simultaneous candidates. Prompt work is the real
      cost — a wave must sound like HIM, not a gazetteer caption. ⚠ The --apply generation run is
      a PAID run (~$3–5 + TTS) — needs an explicit founder go, never inferred from this lock.
- [ ] **The sonic cue.** ~1s entry motif before every encounter (the duck gets a reason; the
      startle dies) + a soft exit/resolve note as the duck releases. Client-side bundled assets
      (`apps/mobile`), played around the clip in `useRoam`. Sound design taste-gate: founder ear
      on the motif BEFORE wiring (charm shortlist already names sound design).
- [ ] **Persistent encounter history + per-pin mute.** Local store (poiId, lastPlayedAt, count,
      muted) — survives sessions (today's cooldown is session-scoped, `RoamEngine` 4h). Feed the
      engine's cooldown from it; "Don't tell me this one again" action on the encounter sheet
      writes `muted`. Unlocks later: deep-cuts rotation targeting, the corpus meter, revisit
      preambles, mute-as-curation-telemetry. Keep it client-side (toy lens: no server surveillance).

## TTS audio QA: clip loudness normalization

The mechanism shipped 2026-06-11: every ship path (`generate-narrations`, `resynth-narration`)
re-synths once on a ≥3 dB tail-collapse drop (the "mumble"), then linear-loudnorms the winning take
to `LOUDNORM_TARGET_LUFS = −14` / `LOUDNORM_TRUE_PEAK_DB = −1.5` (`pipeline/tail.ts` +
`pipeline/loudnorm.ts`; constants in `models.ts`; ffmpeg-optional). Kills the clip-to-clip spread +
the quiet-vs-Spotify gap.

REMAINING — **founder ear-gate on the −14 target.** A single tunable constant; before the first paid
full regen, A/B the smoke clips on-device against a Spotify reference (the old "music at −13 still
reads 20% quiet" measure suggests −14 may want to nudge to −13/−12). One-line change in `models.ts`.
(Drive-music level is tracked under "Drive music bed" below — blocked on this same ear-gate.)

Refs: `pipeline/loudnorm.ts`, `pipeline/tts.ts`, `pipeline/tail.ts`, `models.ts` (LOUDNORM_*),
`docs/decisions/audio-compression-spike.md`.

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
- [ ] Once confirmed audible, fold in the deferred **drive-music level** task from the loudness
      section above (match the 17 tracks to the −14 LUFS narration target after the ear-gate locks).

Refs: `apps/mobile/src/lib/driveMusic.ts` (`useDriveMusic` + the `TRACKS` rotation),
`apps/mobile/src/lib/useDrive.ts` (~L888 the soundtrack effect; `onClipDone`/`pump` at ~L397-429),
`apps/mobile/app/drives/[id]/play.tsx` (the V2 player + `driveMode`).

## Offline downloads: full re-pull only (no per-clip diff)

DONE (2026-06-10): a re-cut clip (patch-clip / resynth-tour / a regen) is now DETECTABLE +
recoverable on-device. Each stop/bracket carries a `revisedAt` content token (the DB
`updated_at`, which every re-synth path already bumps, surfaced on the tour-detail DTO); the
offline manifest embeds the detail, and the tour screen compares a fresh fetch against the
saved copy (`isDownloadStale`, zero extra network) → a "Fresh cut ready" chip + a "Pull the
fresh copy" ⋯ action. NEVER forced; offline play keeps using the saved bytes until the rider
re-pulls. Manifest bumped to v3 (the V2 reshape — embedded detail is now a DRIVE manifest; a
pre-token download lacks tokens → re-downloads).

REMAINING (post-MVP): the re-pull re-downloads EVERY clip, not just the changed ones. A
per-clip diff (download only the stale clips, merge into the existing manifest) is the
optimization — only matters once tours are large or strangers hold many offline tours.

Refs: `apps/mobile/src/lib/offline.ts` (manifest + `isDownloadStale`),
`apps/mobile/app/drives/[id]/index.tsx` (chip + ⋯ action), `packages/shared/src/schemas.ts`
(`driveClip`/`driveManifest` `revisedAt`), `apps/api/src/index.ts` (detail route).

## Offline downloads: expiration / forced freshness re-check (TTL)

Founder ask 2026-06-16: an offline-downloaded tour should EXPIRE after a while (~**30 days**, a
starting value — usage/ear-tunable like the facts TTL) and force a freshness re-check / re-download.
WHY: offline clips never auto-refresh — the device keeps its cached bytes indefinitely. The existing
content-diff (`isDownloadStale` + the "Fresh cut ready" chip — see the section above) only catches
drift IF the rider re-opens the tour-detail screen AND a fresh fetch is reachable; a tour downloaded
once and never re-opened (or held in a dead zone) can carry STALE facts / a superseded clip forever.
This is the maintenance gap made concrete: a `facts_hash` move, a `patch-clip`, or a `resynth-tour`
never reaches an already-downloaded device. A time-based TTL is the safety net INDEPENDENT of the
content-diff — it fires even when the device never got to compare. Secondary benefit: it bounds how
long a baked Places break-name persists offline (CLAUDE.md notes the frozen-clip-outlives-the-DB-anchor
Places-ToS concern).

- [ ] Stamp `downloadedAt` in the offline manifest (or reuse its existing timestamp); on tour-open,
      if `now − downloadedAt > OFFLINE_TTL_DAYS` (30), surface an "expired — re-download to refresh"
      state.
- [ ] **Soft vs hard — DECIDE.** Lean SOFT (still playable offline, but a more insistent prompt than
      the content-diff chip) to honor the never-strand-a-rider-in-a-dead-zone posture; go HARD (refuse
      offline play past TTL) only if licensing / Places-ToS demands a guaranteed-fresh ceiling.
- [ ] Bump the manifest version if the shape changes (a pre-TTL download lacks `downloadedAt` → treat
      as expired / re-pull, same pattern as the v1→v2 `revisedAt`-token migration).

Refs: `apps/mobile/src/lib/offline.ts` (manifest + `isDownloadStale`),
`apps/mobile/app/drives/[id]/index.tsx` (the chip/⋯ action this rides alongside). Pairs with the
"Offline downloads: full re-pull only" section above (the time-based complement to its content-diff).

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
