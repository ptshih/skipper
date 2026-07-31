# Free-roam ALPHA — what v0 actually is

> **Status:** BUILT 2026-06-10 (same-day founder greenlight off
> [free-roam-mode.md](free-roam-mode.md)) — shipped as a founder-only TestFlight alpha.
> This spec records what the alpha IS (including its deliberate cuts) so the next pass knows
> what's real vs. deferred. The idea doc keeps the full product vision.

Free-roam = the skipper rides shotgun on the rider's OWN drive: no route, no tour shape — the
app watches live GPS and pipes up (over the rider's own audio) when the road passes a place with
a roam clip. Tahoe-basin corpus only; the founder (Zephyr Cove) is the alpha user.

## What shipped (code anchors)

- **Data:** the shared `narrations` table (`packages/db/src/schema.ts`) — the 1:1 telling owner
  (UNIQUE `poi_id` via `narrations_poi_uq`; roam is a MODE, not a separate owner)
  (`docs/decisions/tour-data-model-zero-reuse.md` §9): one complete telling per POI, `facts_hash`
  staleness, frozen attribution, per-clip R2 keys `narration/<poiId>/<clipId>.m4a` (regen orphans the
  old object for sweep-orphans).
- **Corpus:** `discover-pois.ts` — bbox Wikidata-spine discovery (3×4 grid over the basin,
  story + scenic tiers upserted through the existing `pois` dedup seam; scenic pins seed the
  future wave layer, unnarrated in v0). First sweep: ~116 story / ~117 scenic.
- **Generation:** `generate-narrations.ts` — ~60s self-contained ENCOUNTERS off the unchanged Skipper
  stop prompt + a new `FREE-ROAM ENCOUNTER` sheet frame (`pipeline/narrate.ts`): route-agnostic,
  no welcome/next-stop/callbacks, **no baked laterality** (no route → side unknowable; the same
  rule family as break-stops' no-volatile). Deep-extract refresh before narrating; Charon voice +
  the blessed style prompt; dadpocalypse.
- **Trigger:** `RoamEngine` (`packages/engine/src/roam.ts`) — proximity + heading-toward with
  ambient governors: speed-adaptive lead (250 m floor; pins aren't road-snapped), min-gap start
  governor (holds through the playing clip), 4 h session cooldown, window-bounded cluster
  suppression, nearest-first, one fire per fix. Missed encounters are invisible by design — the
  failure asymmetry that makes rail-less triggering shippable.
- **API:** `GET /roam?lat=&lng=&radiusKm=` (`apps/api`) — pins + presigned clips; JS haversine
  over the small corpus. **Open** (like `?preview=1`) for the alpha.
- **Mobile:** `app/roam.tsx` + `src/lib/useRoam.ts` + `liveRoamSource` (`src/lib/gps.ts`, no
  polyline/no end-of-route). The UX follows the founder's Claude-design handoff (the
  `design_handoff_roam` bundle, implemented same day): prominent framed entry card on Home
  (kicker + alpha badge + untraveled trail + "Ride along"), a ONE-TIME ambient-contract card
  (`skipper.roamContractSeen`), a session-start opener from a placeless rotating pool
  (`voice.roam.sessionStart`), the riding-along idle base (the `RoamMotif` — a looping
  `RouteTrack`, the session's one moving thing, parked under Reduce Motion; a stat pill; the
  `Duck` music indicator), a **`Chattiness`** segmented control (quiet/normal/talkative → the
  engine's min-gap governor live — a SELECTION knob), a slide-up encounter sheet (STORY badge,
  read-only progress bar, Skip; scrim tap skips; Reduce Motion appears instead of sliding),
  and a hand-ended sign-off card with the session tally. `?mode=sim` replays a fixed demo
  polyline through the same engine for couch testing. Design-states deliberately NOT built
  (no backend yet): waves, the B-side "Tell me more", the offline-pack line, the logbook.
- **Audio posture (deliberate, differs from tours):** session is **`duckOthers`** — piping up
  over the rider's podcast IS the product — and roam makes **no lock-screen Now Playing claim**
  (`setActiveForLockScreen` is documented to want `doNotMix`; an ambient 60 s encounter doesn't
  need transport controls). This sidesteps the M1 duck-flip question entirely for roam.

## Alpha cuts (deliberate; revisit before any non-founder user)

- **No eval panel / grounding audit on roam clips** — founder ear gates; the only inline guards
  are the kit ban + the no-laterality rule (one retake each, then a loud warn).
  ⚠ **Both halves of that sentence are out of date** (accurate for the 2026-06-10 alpha, kept as the
  record): the **kit ban was deleted 2026-06-19** with the persona kit itself
  ([cut-intro-frame-and-persona-kit](../decisions/cut-intro-frame-and-persona-kit.md)), and roam clips
  are no longer un-gated — `generate-narrations` now scores every clip through the fail-closed eval
  panel ([automated-grounding-gate](../decisions/automated-grounding-gate.md)).
- **No diversity lint across clips** (encounters play minutes apart on different drives) — the
  shared-opener risk is real if several fire on one errand; cheap fix later is an opener-tic pass.
- **No offline roam pack** — presigned streaming only (the manifest re-fetches per session).
  Tahoe dead zones WILL eat encounters; the tour player's offline machinery is the template.
- **No persistent encounter history** — the 4 h cooldown is session-scoped; "stop me if you've
  heard this one" preambles, the logbook, and waves/B-sides stay in the idea doc.
- **Endpoint is open** — no account wall, nothing links it but the home card. Takes the
  live-drive gate (free account) when roam ships for real.
- **Host identity is implicit** (no lock-screen metadata, no host card) — fine while the only
  region is the Skipper's.

## Ops notes

- Generation runs on the dev env file; **dev and prod share one Neon DB**, and (since the
  2026-06-10 creds fix) prod serves the same `skipper` R2 bucket — so a local generate-narrations run
  is immediately live on `api.skipper.fm`. Both CLIs preview by default (`--apply` to act).
- Regen story: facts_hash drift → `generate-narrations --apply` re-narrates only stale/missing clips;
  `--force` re-tells everything; old R2 objects orphan → `sweep-orphans`.
