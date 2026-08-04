# Post-1.1 slate — 1.2 candidates, the charm shelf, cuts, and refusals

> **Status:** IDEA SHELF, 2026-07-31. **Nothing here is greenlit.** Captured from the same ten-lens
> adversarial pass that produced [1-1-adversarial-review.md](1-1-adversarial-review.md) (which holds
> the findings that touch the 1.1 build itself, and the provenance/confidence rules for both docs).
> Every code claim was checked by a verifier quoting `file:line` at `bd8f368`; **line numbers drift,
> code wins.** §3 (cuts) is the natural feed for D36's step-10 simplification sweep — ⚠ but the sweep
> is by explicit path and atomic commits, never a codemod, and `curate-places` is off-limits (INV-2).

---

## 1. 1.2 candidates

**1.1 — Nothing reads the eval panel after the run.** `eval_scores` has exactly two readers: the admin
Runs drawer and `regen-report.ts`, which D26 deletes. So 13 tail-flagged clips and every advisory
finding influence **nothing a rider encounters**. Denormalize a quality flag onto `narrations` at
generation time (or resolve latest-per-subject), then feed it into selection as a demotion and into a
resynth queue — resynth already cleared 22 of 35 flagged clips for $1.25.
`effort M · touches schema + drive-select + admin · downside: a second home for a value whose truth is in eval_scores, and it goes stale on any resynth that doesn't rewrite it`

**1.2 — Drive selection ranks by clip LENGTH — the exact proxy already rejected for grouping.**
`drive-select.ts:188` sorts the co-located survivor by `audioDurationMs`, and `better()`'s final
tiebreak (`:214`) is the same. §4d of the legibility work replaced this with **facts strength** for
grouping ("disagrees on 7 of 10 groups") — but the drive path, now the *only* thing deciding what a
rider hears, still runs the rejected rank. `DriveCandidate` carries no quality field at all.
`effort M — wait for step 2/D40 or buy a conflict · downside: length and richness correlate, so the measured delta may be small; replay the 3 saved drives first`

**1.3 — `narrations.script` has no history.** Regeneration overwrites in place
(`generate-narrations.ts:601-625` — no prior-value capture, no history table among the 13). The
2026-07-30 run that took tail collapse 2% → 21% across 72 clips is recorded as "not revertible", and
that same missing before-state is why the standing prompt-regression test was never built. An
append-only `narration_revisions` is text-only, ~450 rows/region, no personal data.
`effort S · downside: it does NOT restore audio (the R2 objects were swept), and snapshot-corpus covers the catastrophic case — this only wins per-clip diffing`

**1.4 — Region release is irreversible with no readiness pre-flight.**
`POST /admin/regions/:slug/release` guards only `not_found` and `bbox_required`, then stamps. Verified:
**Yosemite's bbox contains zero `places` rows**, so releasing it today would advertise a region where
`loadRegionAnchors` returns `[]` — the conversation would have no endpoints at all, and the failure
renders as a blank list, not an error. Add a readiness projection (pois / enriched / released narrations
/ endpoint-eligible places) and make release refuse or hard-confirm at zero.
`effort M — ReferenceView rides along in the same commit · downside: ceremony on an endpoint one operator uses, and it can't check the thing that matters most (are the clips any good)`

**1.5 — A free distance oracle for the planner.** ⚠ **ITS HEADLINE JUSTIFICATION IS GONE (founder,
2026-08-04): the planner no longer ASKS how long, so there is no ninety-minute ask waiting for
arithmetic** — see [planner-stops-asking-how-long.md](../decisions/planner-stops-asking-how-long.md).
The observation below is what made that call obvious and still stands. If this is ever built, justify it
by what it lets him ANSWER, not by a question he is no longer asked. Nothing downstream consumes a duration target:
`driveProposeRequest` has no duration field, and the real number only exists **after** the billed Routes
call. Precompute a pairwise minutes table over featured anchors at prefix-build time (verified sizing: 6
featured → 15 pairs; all 26 eligible → 325) and put it in the cached prefix. *"I've got about ninety
minutes"* then gets arithmetic on numbers the model was handed. D11 survives; zero dollars.
`effort M · downside: straight-line × factor is 30%+ wrong on west-shore switchbacks — the card must show the real Routes duration, and the prompt must let him be gracefully wrong`

**1.6 — Never play the same preview clip twice in one conversation.** The pick doesn't exist yet (step
8a), but the selection under it is **fully deterministic** (no randomness anywhere in
`drive-select.ts`), and a conversation invites iteration over a heavily overlapping corridor — so a
naive pick returns the same clip three turns running. **An AI narrator repeating himself reads as a
glitch, not a bit.** Bounded client-held `heardSubjectIds` (max ~8) excluded from the pick, with an
explicit fallback.
`effort S · downside: one more caller-supplied array on an unauthenticated endpoint — bound it in limits.ts; it can only shrink the candidate set`

**1.7 — A dollar breaker on the tally.** Process-global dollars-since-boot; above a named ceiling in
`limits.ts`, stop calling the model and serve the RISK-2 outage state that has to exist anyway. Today's
guards bound **requests**, not dollars.
`effort S · downside: per-instance, so it is a floor not a ceiling — and someone will read it as "RISK-4 solved"`

**1.8 — Re-measure the fill rate before building legibility phase 5.** The §2 table (8/12, 8/10, 2/3)
was measured 2026-07-29; **every fused narration was created 2026-07-30.** Verified the build corpus now
suppresses fused members via `notSupersededByServedCluster` — and the suppressed set is **~219 pois
today, not the 104 recorded**. Replay the 3 saved drives before spending build time on phase 5.
`effort S · downside: 3 Tahoe-basin drives is a thin sample, and widening it costs billed Routes calls`

---

## 2. The charm shelf (ranked)

The existing shelf in [../README.md](../README.md) still stands; these are what the 1.1 shape makes
newly cheap or newly valuable, plus what wasn't on it at all.

**2.1 — "Ticket punched": give ANTICIPATE a moment.** Create currently ends in
`router.replace('/drives/[id]')` — the drive just *appears in a list*. Land instead on one full-bleed
placard reusing the shipped passport-stamp cascade, with save-for-offline promoted from a hint under the
CTA to **the ritual**: *"She's yours now, folks. Make it today, drive it whenever."* / "Stow it for the
road". The 1.1 thesis is that three of four beats need no car — **anticipate is the one beat 1.1 doesn't
touch.** ⚠ Ship it only after step 12's real drive proves the artifact is worth anticipating.

**2.2 — The one anonymous preview clip should be picked by EAR.** A `preview_pick boolean` on
`narrations` + an admin toggle; the preview prefers a flagged clip on the rider's route. That single
clip is the most-heard minute in the product and the whole pitch to a stranger. Verified there is no
existing curation flag and no API path reads `eval_scores` — so this must be **curation**, not an eval
ranking.

**2.3 — Home opens with the skipper already talking.** Seed the client-held transcript with an assistant
turn from a small pool keyed to time of day and whether the rider has saved drives. ⚠ Rotate by **day**,
not by app open — four greetings in an hour teaches the rider he's a slot machine. Correction: rotating
copy already exists (`voice.ts:111-118` + `useRoam.ts:763`), but it is inline in roam and dies with it,
so **extract rather than invent**.

**2.4 — Pay off the deflection.** Have the planner emit `deflected: string[]` alongside the route; the
client substring-matches against stop names and marks the row — *"you asked about this one."*
⚠ The `sublabel` prop this originally leaned on is GONE (2026-08-03): the row is one line now, and its
one text slot is `meta`, which carries the clip length. So this needs a real decision rather than a free
prop — either a third slot or a mark that isn't text. Right now the deflection is a promise nothing
redeems. Keep the match strict and let it fail invisibly; do **not** add a fuzzy matcher.

**2.5 — Curtain-up: one baked line at "Let's roll."** ~8 place-free departure lines, synthesized once,
at fixed R2 keys, played outside `useDrive`'s queue — not a `narrations` row, no seq, no geometry.
Verified the queue is now route-anchored only, with no sentinel machinery left, so this needs no table.
⚠ It re-litigates reason #4 of
[../decisions/cut-intro-frame-and-persona-kit.md](../decisions/cut-intro-frame-and-persona-kit.md)
("it duplicated what the persona already does") — that was a founder call, so this needs an **explicit
reversal, not a quiet build.**

---

## 3. Cuts

Feed for D36's step-10 sweep. ⚠ Claim paths before starting; several of these files are edited by steps
4 and 8a.

**3.1 — `drives.route_sig`, entirely.** Hand-verified: `routeSigOf` (`drives.ts:140`) is called twice
(`:445`, `:593`) and its only real consumer is the `drive_demand` upsert at `:660-662` that **D25
deletes**. **No SELECT reads the column**, and `routeSig` has zero hits in mobile/admin/site/engine. The
build note's "`routeSigOf` **survives**" is a self-justifying loop: a NOT NULL column, an index
maintained on every insert, a hash function, and a wire field, each keeping the others alive. Cut
`routeSigOf`, `drives.route_sig`, `drives_route_sig_idx`, `driveProposal.routeSig` (`schemas.ts:226`),
and the assertion at `packages/db/test/schema.test.ts:138`. M4 can re-derive 15 lines of hashing when
caching actually lands.
`effort M · ⚠ contradicts a build note the implementer will read as settled — announce it`

**3.2 — `GET /sources` and `apps/api/src/sources.ts`. ✅ DONE** — cut in the 1.1 sweep; the route, the
file, the two DTOs, `getSources()` and the `useEffect` are all gone, and `packages/shared/src/schemas.ts`
carries the tombstone recording why. One home now: `apps/mobile/src/lib/licenses.ts`, where the rename
landed as `DATA_SOURCES` — the "fallback" was never a fallback. ⚠ CATALOG only: per-clip `attribution`,
frozen on the narration row, is untouched and is what CC BY-SA actually requires. Verified both lists carry the same four entries
and `getSources()` has exactly one caller (`legal.tsx:52`), which already seeds from the bundled copy.
The endpoint's justification — "credit a new source without an App Store release" — is a scale argument
for a list that has changed twice, and it isn't even satisfied, since the bundle must be maintained in
lockstep anyway. **Two homes for the CC BY-SA source list is strictly worse than one.** Cut the route,
the file, `dataSource`/`sourcesResponse`, `getSources()`, and the `useEffect`; rename
`FALLBACK_DATA_SOURCES` to the truth.
`effort S · downside: a fifth fact source then needs an app release to credit — per-clip attribution is unaffected`

**3.3 — `durationBucket` and `interest` in `packages/shared/src/enums.ts`. ✅ DONE** — both deleted in
the 1.1 sweep; `enums.ts` carries the tombstone comment recording why. (The `judge-voice.ts:42` hit
cited below is also gone: that local interface was deleted when the CLI was repointed at the live
corpus on 2026-08-02. Nothing to do here; kept so the reasoning isn't re-derived.) Zero importers repo-wide
(the `judge-voice.ts:42` hit was an unrelated local `string` field). Both were documented as "kept for
forward use" and have survived two pivots untouched, which is the proof they are sediment, not
vocabulary. ⚠ **Correction to an earlier pass that claimed three:** `stopType` is **not** dead — its
inferred type is used across studio. Leave it.
`effort S · downside: interests-as-a-filter is a real M4 idea and would re-add six strings`

**3.4 — Take the stop FORM off the wire.** Live DB: `narrations` is a **single group — 458 rows, all
`story`.** Zero wave, zero bside, zero scenic, zero break. D24 collapses runtime handling but leaves
`driveClip.form` on the wire, two icon maps, a coercion switch, a Zod enum, and a pg enum.
⚠ **There is a third client consumer** the spec doesn't name: `useDrive.ts:315` maps `stopType: c.form`
into `labels.ts:11-16`'s own `STOP_LABEL` map (with its own `wave: 'Passing by'`), used at
`play.tsx:310/321/604`. ⚠ And `lint:enums` pairs `narration_form ⇄ narrationForm` exactly, so dropping
values from the Zod narration enum **forces a pgEnum migration in the same commit** — whereas dropping
`wave` from `driveClipForm` is lint-free and migration-free. **Do the cheap half; treat the pgEnum
narrowing as separate destructive DDL.**
`effort M · downside: contradicts cut-wave-form.md's "reserved vocabulary", and scenic returns as the density lever in M3/M4`

**3.5 — Hard-delete drives; drop `deleted_at`.** The handler's rationale (`drives.ts:899-900`, "the row
stays so it keeps counting toward the credit") is **contradicted by `schema.ts:713`** ("Credits are NO
LONGER coupled to this"). Account deletion is immediate and total; deleting one drive leaving a row
forever is indefensible, and it costs an `isNull` predicate on every owner-scoped read.
⚠ **Real behaviour change:** `drives.ts:490-497`'s idempotent-replay branch is the only read *without*
that predicate — with the row gone, a replay creates a NEW drive while the `drive:<id>` UNIQUE key
no-ops the charge, i.e. **a free drive**. The replay must key off the ledger entry, not the drive row.
`effort M — right after 1.1 · downside: loses the forensic link from a consume entry to the drive it paid for`

**3.6 — Kill the `...(x ? {x} : {})` hop idiom in the drive relay.** Ten conditional spreads across
`NarrationRow → DriveCandidate → DriveSelectionItem → DriveClip`. This is the **generalized form of a
bug that already fired in production here** — `NarrationRow`'s own comment says dropping `area` at the
mapper "is exactly what this code path did until 2026-07-30". A required key with a `| undefined` value
makes tsc catch a dropped field, and `JSON.stringify` still omits undefined, so the wire is
byte-identical. Do it in **step 10, on what survives** — the two loudest instances die with D40.
Related, same commit: eight `schemas.ts` fields are optional citing "an older server/client", a premise
**D3 deletes**, and four handler response literals (`drives.ts:438`, `:718`, `:892`, `index.ts:344`)
carry no DTO type at all — so an optional field is invisible to tsc in *both* directions. Verified safe
to require `attribution`: 457 released narrations, **zero** null or empty.
`effort M · downside: noisier literals in a file steps 4 and 8a both edit — claim paths`

**3.7 — Move `tierOf`/`isAdmin` to `@skipper/shared`. ✅ DONE 2026-08-03** — `packages/shared/src/access.ts`
is the one implementation (plus `isSignedIn` and a structural `AccessSession` both sides satisfy);
`apps/api/src/tiers.ts` is deleted and `apps/mobile/src/lib/auth.ts` re-exports. ⚠ The move was NOT the
mechanical one predicted below: unifying the copies surfaced that they encoded two DIFFERENT correctness
rules and each side needs its own — an ABSENT `isAnonymous` must read `free` (the client's: a session
cached before the plugin was registered, where reading anonymous logs a real rider out of their drives),
while PRESENT-and-not-exactly-`false` must read `anonymous` (the server's fail-closed direction, since
`free` is what mints a grant and takes ownership). Both branches are in `tierOf` on purpose; read its
comment before "simplifying" them. The drift has already happened and it is
structural, not a dropped condition: `apps/mobile/src/lib/auth.ts:51-55` types the session as
`{user?: {role?: string|null}}` — it **cannot even see** `isAnonymous`, while `tiers.ts:27-29` excludes
it. `tiers.ts` has exactly one import (`AccessTier`, already in shared), so the move is mechanical.
Latent today (the anonymous plugin mints no admin role) but **INV-9 makes this predicate decide what
every rider sees.**
`effort S — pairs with step 8b · downside: an auth-shaped concept in a "Zod DTOs" package, though accessTier already lives there`

**3.8 — Trim drive music 17 tracks → ~6; delete the unused `intro.mp3`/`outro.mp3`.** 61 MB of
`require`d assets, ~40 MB off every IPA and EAS build, and the file's own comment says intro/outro are
staged but "intentionally NOT used yet". A rider on a two-hour drive hears three or four tracks;
shuffle-from-six is indistinguishable from shuffle-from-seventeen.
`effort S · ⚠ contradicts D28 (drive music is out of scope for 1.1) · downside: pure founder taste — nobody else can pick; the win is build time and repo weight, not a blocked install`

**3.9 — One region-bbox parser. ✅ DONE** — `parseRegionBbox` lives in `@skipper/engine` (`geo.ts`) and
every caller imports it: studio's `pipeline/region.ts` (which re-exports `RegionBbox` so its own importers
didn't move), `apps/admin/server/bbox.ts`, `apps/api/src/drives.ts` — and a FOURTH the count below missed,
`apps/api/src/example-anchors.ts`. `bboxError` was the last hold-out and now validates THROUGH the reader
(2026-08-03); a validator that parses differently from the reader is the worst version of this bug, since
it approves the string the reader then misreads. ⚠ `MAX_BBOX_SPAN_DEG` stayed in admin, per the note below.
Three independently-written implementations
(`studio/pipeline/region.ts:28-33`, `admin/server/bbox.ts:47-53`, and inline at `drives.ts:90-92`) that
agree only by luck — one trims, one doesn't, and two disagree on sw/ne vs min/max. `@skipper/engine` is
zero-dep and already a declared dependency of all three. **First thing to cut if step 10 is time-boxed.**
⚠ Do **not** move `bboxError`'s `MAX_BBOX_SPAN_DEG` — that is an operator write-boundary guard against a
paid-run runaway, different semantics.

**3.10 — `places.featured`: feed it or cut it — but probably feed it.** Its only rider-facing readers
are `create.tsx:208` and `:387`, both deleted at step 3. ⚠ **Correction:** admin also reads it for
behaviour (`server/index.ts:412` orders by it, `google-map.tsx:82` branches pin colour,
`PlacesView.tsx:152` toggles it) and `curate-places.ts:206` merges it — so "only consumer" is wrong, and
a full removal would touch `curate-places`, which INV-2 puts off-limits. **The better answer is not to
cut**: `featured` is the natural source for D17's example asks and the RISK-2 anchor list (see the
review doc §1.11). Decide; don't leave an admin checkbox that changes nothing rider-side.

**3.11 — The credit block on `GET /drives` — RE-EXAMINE, do not cut blind.** `ensureFreeGrant` has four
call sites and `GET /drives` (`drives.ts:715`) is the **only read-only one** — which is precisely
INV-15's hazard, so cutting it would shrink the blast radius rather than backstop it, and would remove
two DB round-trips from the most-hit authenticated endpoint.
⚠ **But the original argument for cutting it is now void.** It rested on `FREE_DRIVE_CAP` being 100
(making the low-balance branch dead for a decade); the cap was reverted to **10** the same day, and the
hint is now deliberately gated to a low balance
([../decisions/free-allotment-through-1-1.md](../decisions/free-allotment-through-1-1.md)). At a cap of
10 the branch is live and load-bearing — it is the **only** thing that tells a rider the email top-up
exists. So: keep the readout, and address INV-15 by making the grant write conditional on a
non-anonymous session instead.
`effort S · downside: none if scoped this way; the cut version second-guesses a fresh founder tuning call`

---

## 4. Explicitly NOT worth doing

Recorded so they aren't re-proposed. ⚠ **Each ops refusal expires at launch** — the expiry condition is
part of the note, or it becomes an argument against ever hardening.

- **A co-located-coordinate / `audit-location` detector** — already built (`f210bcb`), wired into
  `discover-pois.ts:155` + `prune-corpus.ts:170`, unit-tested, and already run (13 pairs, 1 real bug).
- **A fact-sheet-drift detector** — exists as `sheetDriftSpans` (`pipeline/select.ts:90-96`), consumed
  by `refetch-poi.ts:112` and `admin/server/index.ts:1009`. What's missing is a corpus-wide **run**,
  which is free. Schedule that; don't build the check.
- **Scope Yosemite's paid enrich by road legibility** — `speakable_road_class` has **0** non-null rows
  in the Yosemite bbox (Tahoe: 681/764). The filter doesn't exist there; refuted until a free re-snap runs.
- **Unify the two `withRetry`s** (`apps/api/src/retry.ts` vs `studio/pipeline/http.ts`) — the divergence
  **is** the design (3 attempts/120 ms on the rider's latency path vs 4/500 on a batch run that already
  spent), both files document why, and there is no honest shared home (`apps/api` deliberately does not
  depend on `@skipper/studio`).
- **Zod-ify the admin client/server DTOs** — 407 hand-written interfaces against a 1,756-line server,
  operator-only behind IAP with one operator, so drift surfaces immediately as a visibly broken console.
  An L-effort diff on the largest file in the repo, mid-1.1, for near-zero risk removed.
- **A Redis/shared-store rate limiter** — `--max-instances` makes the per-instance limiter honest enough
  until launch. *Expires: real traffic.*
- **App Attest / DeviceCheck attestation** — a real build, and any native client is curl-able anyway.
- **Cloud Armor / an external HTTPS load balancer** — it also changes `TRUSTED_PROXY_HOPS` and can
  silently re-open the XFF bypass. *Expires: sustained abuse.*
- **A staging environment or a second Neon branch** — CLAUDE.md already declared storage break-freely;
  there is deliberately no staging. *Expires: the day 1.0 is actually released to users.*
- **Sentry or any log-ingestion SaaS** — Cloud Logging plus one log-based metric covers this scale.
- **A scheduled synthetic canary on `/drives/plan`** — spends real money forever to test what a
  per-deploy smoke step already covers.
- **Any control on R2 egress or presign volume** — R2 egress is free on every plan; the preview clip is
  a bandwidth non-event.
- **A Google Routes per-day quota cap** — Routes documents adjustable *per-minute* quotas (3,000 QPM)
  and Maps Platform states there are no maximum daily request limits. The Anthropic workspace cap is
  real; this one isn't. Don't budget time for it.
- **Metering the conversation** — ⛔ **answered by the founder 2026-07-31: planning is never metered,
  only the artifact is** ([../decisions/free-allotment-through-1-1.md](../decisions/free-allotment-through-1-1.md)).
  The cost asymmetry is real (a redeemed credit costs ~$0.08 to serve while the conversation preceding
  it is where the spend lives) and is recorded there, with the corollary that **no credit price can ever
  bound planner spend**, because an anonymous rider never reaches `POST /drives`. The lever is
  `limits.ts`.
