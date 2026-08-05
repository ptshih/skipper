# Skipper, from first principles — an architecture orientation

**Status:** Snapshot — 2026-08-02, written against `main` during 1.1 step 12 by reading the route
table, schema, engine and mobile source directly rather than summarizing the docs. **Partly corrected
2026-08-05** for the download-before-start build
([download-before-start.md](../designs/download-before-start.md)): a live drive is gated on a complete
local copy, drive audio never streams, and the re-sign route is gone. **This is a
derived document and it will drift.** `CLAUDE.md` is operating truth, `docs/decisions/` is why, and
the CODE is the rest of current truth — where any of them disagree with this file, this file is
wrong. Its job is orientation: enough of the shape that a new agent or engineer can read the real
thing without getting lost. Counts and file lists are as of the date above; every volatile *value*
(timeouts, caps, model ids, bitrates) is deliberately left as a pointer to its one home.

## The product

You tell Skipper where you want to drive. It plans a route. As you drive it, a Jungle-Cruise-style
tour guide narrates the places you pass — GPS-triggered, played as phone audio. The persona is the
product; charm is the optimization target, not scale.

## The one artifact

Everything reduces to a **drive**: a user-owned row in `drives`. A second mode (*roam* — wander and
it narrates whatever you pass) existed and was deleted entirely in 1.1. Hand-authored tours are
deferred. One artifact, one ladder.

## The two principles everything else follows from

**1. Fetch facts once per place. The narration is the shared atom. Assemble per drive.**

The naive design generates a bespoke tour per user per route: expensive, slow, nothing reusable.
Instead each *place* has its facts fetched once (`pois`, deduped by Wikidata QID, refreshed on a
TTL), and each place has exactly **one** telling — a single audio object in R2 with a `narrations`
row. A drive is a *selection and ordering* of clips that already exist; **nothing is generated at
request time.** The payoff: a drive stores subject ids and resolves audio live, so regenerating one
telling silently improves every saved drive containing it.

**2. The route is the rails; generation is everything inside.**

The LLM resolves *only the route* — endpoints, waypoints, round-trip, duration target. Which
narrations ride it is deterministic code (`buildDrive`, `packages/engine/src/drive-select.ts`). Both
failure modes are designed out: if the model picked the *content* you would have a fixed script
(Shaka Guide with extra steps); if it picked *coordinates* you would have hallucinated places.

---

## Three machines sharing one database

They meet at Postgres + R2 and otherwise barely know each other.

### A. The studio — operator-run, offline, spends real money

`packages/studio`, ~20 CLIs, safe-by-default (preview unless `--apply`), also drivable from the admin
console. The pipeline is **discover → enrich → generate**:

- **`discover-pois`** — free Wikidata sweep over a region's bbox, populates `pois`.
- **`enrich-pois`** — *paid.* Scouts each story POI into a curated verbatim fact sheet
  (`pois.fact_sheet`). A story telling **requires** a sheet; without one the POI is downgraded to
  scenic. Silence beats a hallucinated battle.
- **`generate-narrations`** — *paid.* Writes the script from the fact sheet through the skipper
  persona prompt, scores it through a **fail-closed** eval panel (a clip whose grounding/TTS gate
  stays dirty after bounded retakes is withheld, never synthesized), then TTS → one ffmpeg pass for
  loudness + encode → R2 → `narrations` row.
- **`curate-places`** — *paid, and load-bearing.* Picks the curated Google Places that can serve as
  drive endpoints. **This set is the planner's allowlist**, which is why it is product surface rather
  than a leftover CLI.

Plus `snapshot-corpus` (free — run before anything destructive), prune, audits, `sweep-orphans`,
`resynth-narration`.

### B. The API — `apps/api`, Hono on Bun, Cloud Run

The public surface, in mount order (`apps/api/src/index.ts`):

| Route | Auth | Spends |
|---|---|---|
| `GET /health`, `GET /version` | none | — |
| `GET /regions` | session-aware | — |
| `GET /sample` | none | — |
| `POST\|GET /api/auth/*` | Better Auth | — |
| `POST /drives/propose` | **none** | Google Routes |
| `POST /drives/plan` | **none** | model tokens |
| `POST /drives` | **account** | a credit |
| `GET /drives`, `GET /drives/:id`, `DELETE /drives/:id` | account | — |

**The wall is at `POST /drives`.** Everything before it is anonymous: a rider can plan an entire
drive by talking, see the route drawn, and hear a real clip from it before making an account.
`requireAccount` sits per-route on the **four** owner routes, never on the `/drives` mount.

⚠ `POST /drives/:id/assets/sign` was **deleted 2026-08-05** — a drive's audio is now only ever played
from disk, so nothing needs a fresh presign after the download
([download-before-start.md](../designs/download-before-start.md) §10). **`GET /drives/:id` survives
and is load-bearing:** it returns the drive manifest with each clip's presigned url **inline** — that
is where the download gets its bytes. `POST /drives` returns the same manifest shape on create. Those
two are now the only way a drive's audio url reaches the app; there is no re-presign after the fact,
which is exactly why the download has to be complete before the drive can roll.

⚠ `/drives/plan` and `/drives/propose` are mounted **above** `app.route('/drives', driveRoutes)`,
and that ordering is load-bearing — Hono matches in registration order, so below the mount they are
swallowed by the sub-app's `requireAccount` and every anonymous plan 401s. That failure reads like an
auth bug and is a routing one. A test pins a 200-with-no-session for exactly this.

### C. The mobile app — `apps/mobile`, Expo/RN, new arch

Nine screens, home being the planner conversation. No state-management library: three contexts and
otherwise local React state plus hand-rolled hooks. Its defining internal pattern is a **pure/native
split** — every module with real logic exists twice, a pure half that runs under `bun test` and a
native half holding only side effects — which is what makes the mobile suite meaningful without an RN
test runner. Full pass: **[mobile-internals.md](mobile-internals.md)**.

---

## The rider flow, end to end

1. **Open the app.** No account. No location prompt — the whole pre-drive flow is location-free.
2. **Talk.** `POST /drives/plan`, SSE-streamed, one tool (`plan_route`) whose fields are
   `start_anchor_id` / `end_anchor_id` / `via_anchor_ids` / `round_trip` / `target_minutes`. **Ids
   from the allowlist, never coordinates.** The prose goes to the rider, the tool call to the server.
   The planner gets no fact sheets and no corpus access, so a question about a *place* is deflected
   in persona — which also manufactures the anticipation beat.
3. **Propose.** The server re-asserts `endpoint_eligible` on every id it was handed; an unknown or
   ineligible id is a **400 before any billed Routes call**. This is what makes "grounded by
   construction" literally true — enforced at the wire, not in a prompt.
4. **Preview.** One presigned clip from the rider's own route, server-chosen, release-filtered. It
   **streams**, deliberately — it plays before a drive exists, so there is nothing on disk yet.
5. **The wall.** `POST /drives` requires an account, consumes one credit, and runs `buildDrive` —
   deterministic selection and pacing of existing clips along the frozen route, frozen into the row.
6. **Save it, automatically.** The create handler starts the download the moment the drive exists, and
   it survives navigation — so the copy usually lands while the rider reads the itinerary.
7. **Drive it.** Clips come off the subject-keyed store on disk; the trigger core fires each stop.
   ⚠ Starting a live drive **requires a complete local copy** (2026-08-05): a drive's audio is only
   ever played from disk, never streamed. The gate steps aside only where it cannot help — offline
   with a partial copy still rolls, disclosing the gap.

---

## The playback engine — `packages/engine`, zero-dep, RN-safe

Shared by the phone *and* the simulator, which is why it is pure. Three landmines encoded in it:

- **Speed-adaptive lead, not a fixed geofence.** Trigger distance is
  `max(radius floor, speed × leadSeconds)`, so lead is constant in *time*. A car crosses a 350 m
  radius in 13 s at 60 mph and 26 s at 30 mph; `trigger_radius_m` is a floor, never the rule.
- **Heading gate above ~5 mph** — fire only when the stop is genuinely ahead. Skipped below that,
  when heading is unknown (the iOS `-1` course sentinel), and when the stop is very close (bearing is
  then noise).
- **Foreground high-rate GPS**, never background polling — the OS throttles background location and a
  car sails straight through a geofence.

Audio takes **exclusive focus** (`doNotMix`) whenever the Skipper speaks. The drive *is* the audio,
not a voice-over ducking the rider's music; ducking was built, tried and rejected. `setAudioModeAsync`
is process-wide, so only one surface may own it at a time.

Offline is keyed by narration *subject id* and filled from the drive's own manifest — and only a
drive's own manifest is authoritative for it, which is why there is no region-level pack. Since
2026-08-05 it is not optional either: **a drive's audio is only ever played from disk**, and one pure
expression (`decideDriveGate`) answers "can this drive roll?" for *both* the detail CTA and the player
— two call sites, one expression, because `skipper://drives/<id>/play` is a real deep link and a gate
that lives only on the CTA is not a gate. ⚠ This governs DRIVE audio only. `GET /sample` and the
route-preview clip play before a drive exists and still stream, by design.

---

## The data model

Schema: `packages/db/src/schema.ts`; the Better Auth pool is `packages/db/src/auth-schema.ts`.

- **`regions`** — a bbox. Region is *geometry*, never a foreign key: a POI's region is point-in-bbox,
  a drive derives its region by intersecting its route bbox. There is no `region_id` anywhere.
- **`pois`** — the facts cache. Wikidata QID is the dedup key; every POI is Wikidata-discovered.
  Carries `fact_sheet`, `facts_hash`, `facts_fetched_at`. A re-fetch that materially changes the
  facts makes every narration grounded on them stale.
- **`poi_clusters`** — a group of places told as one thing (Emerald Bay = Vikingsholm + Eagle Falls +
  Eagle Lake). Members point at it via `pois.cluster_id`.
- **`narrations`** — the shared atom. About exactly one subject: a POI **xor** a cluster, enforced by
  a CHECK. Audio is NOT NULL — a narration is not live until it has audio. `released_at` gates every
  public read; admin is the sole bypass.
- **`places`** — Google-sourced, role-tagged (`endpoint_eligible` / `break_eligible`). Explicitly
  *not* POIs. This is the planner's allowlist.
- **`detours`** — break-stop audio, place-anchored 1:1. **Stubbed; nothing writes it yet.**
- **`poi_overrides`** — hand-authored corrections.
- **`drives`** — the user-owned artifact: `user_id`, route bbox, frozen selection.
- **`credit_entries`** — append-only ledger; balance is `SUM(amount)`, `idempotency_key` UNIQUE gives
  exactly-once.
- **`eval_runs` / `eval_scores`** — the generation gate's records.
- **`studio_jobs`** — admin run tracking.
- **Auth pool** (`user`, `session`, `account`, `verification`) on its *own* Drizzle client, because
  Better Auth needs interactive transactions while the rest of the app runs on stateless neon-http.

## Auth, tiers, money

Access tier is `anonymous` | `free`. **There is no paid tier** — premium is *credits*, not a plan, so
a comp account is just a large admin grant. The free allotment is a lazy grant; each `POST /drives`
is a −1 co-committed via `db.batch`; deletion never refunds. IAP is deferred.

Two constraints that shape a surprising amount of code:

- **An anonymous session is a real user row, hard-deleted at link-to-account, never upgraded.** So
  nothing durable may be keyed on an anonymous user id — state that must survive signup lives on the
  client and is re-sent.
- **In-app account deletion must purge, not unlink** (App Store 5.1.1(v)). `drives.user_id` and
  `credit_entries.user_id` are soft references across the auth-pool boundary with *no FK*, hence no
  cascade — so `purgeUserData` runs in the database-level delete hook, before deletion, because the
  admin remove-user route bypasses the self-serve hooks.

## Two spend regimes — the sharpest distinction in the codebase

- **Operator spend** (enrich, generate, TTS, curate) — needs an explicit human "go" per run; previews
  are free.
- **Rider spend** (`/drives/plan`, `/drives/propose`) — fires on every request, anonymously, forever,
  with no human in the loop. Governed by **caps** in `apps/api/src/limits.ts`, not by approval. That
  is the file where the numbers *are* the control. Exposure analysis:
  [rider-spend-exposure.md](../research/rider-spend-exposure.md).

## Infrastructure

bun everywhere; internal packages export `.ts` source with no dist build. Neon Postgres; R2 for
private audio (presigned, short TTL, after the tier check). Cloud Run for API, admin (behind IAP) and
studio; Firebase Hosting for the marketing site. Secrets via dotenvx, committed encrypted.

⚠ **Dev and prod point at the same Neon database and the same R2 bucket.** There is no staging — a
`db:push` typed in a "development" shell is a production DDL. Deploy ordering:
[1-1-cutover-runbook.md](1-1-cutover-runbook.md).

## Deliberately not built

roam (deleted), hand-authored tours, CarPlay and Android Auto, multilingual, the grounded
place-facts Q&A ("Ask the Skipper" — *not* the planner, which is built), IAP purchases, break audio,
segment trimming, route caching and dedup.

---

## Where the fragility is

The five seams most likely to break quietly:

1. **The `/drives/plan` mount order** — an auth-looking failure with a routing cause.
2. **`requireAccount` placement** — per-route, never on the `driveRoutes` blanket mount; moving it
   re-walls the anonymous preview.
3. **The anonymous-user-row deletion** — anything that accidentally keys durable state on that id.
4. **The narration subject XOR** — hanging a fused cluster telling off one member's `poi_id` once
   produced a clip about downtown Reno attributed to a single apartment building.
5. **The release filter** — the owner-scoped corpus loaders deliberately skip it and are safe only
   because every caller sits behind `requireAccount`.

Three gaps found in the 2026-08-02 read, and their disposition:

- **The conversation cannot survive an unmount.** INTENDED (founder, 2026-08-02) — D10 plus INV-13
  leave no place to put it. Logged in TODO.md so the cost stays visible rather than becoming folklore.
- **Analytics ends at `drive_started`.** Open — the measured part is everything *before* the thing
  the app exists to do. Filed as PostHog Stage 4 in TODO.md.
- **`useRoutePreview`'s terminal state was unreachable** when the vendor did not report an error.
  FIXED 2026-08-02 (`55184a9`) — a pre-start watchdog now bounds it on a clock.
