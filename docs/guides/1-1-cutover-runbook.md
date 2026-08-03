# The 1.1 cutover — the first push

**Status:** ✅ **EXECUTED 2026-08-02** — `9dc3987..ecc30f7`, all four builds SUCCESS, every endpoint
below verified green. Written 2026-08-02 against `main` at `3db599d` with 49 commits unpushed; executed
18 commits later at `ecc30f7`. Kept as the record of the first push and the template for the next.
Where this and the code disagree, the code wins.

⚠ **ONE CLAIM BELOW WAS ALREADY FALSE WHEN IT WAS EXECUTED, and it was the load-bearing one** — see
*What does NOT happen*. That is not a criticism of the writing; it is what "measured, not assumed"
costs when the measurement is 18 commits old. **Re-measure the migration claim before any future push;
do not inherit it.**

**What the push actually cost:** the App Store decision (1.0.0 was WITHDRAWN by the founder first, which
is what unblocked it), four concurrent builds, and about six minutes end to end. Verified after: `/health`
`{"ok":true}`, `/regions` returning Lake Tahoe with 6 example anchors (so the prod secret decrypted and
Neon is reachable), `/sample` 200, `/roam/sample` **404** (the flip landed), site `/privacy` `/terms`
`/support` all 200, `delete-user` **400** (not 404 — the 5.1.1(v) route is live), and one anonymous
`POST /drives/plan` answering in character in **2.5 s**, which is the only proof that
`ANTHROPIC_API_KEY` is set on the deployed service. Companion to
[gcp-cloud-run-deploy.md](gcp-cloud-run-deploy.md) (how the pipeline works) and
[app-store-submission.md](app-store-submission.md) §12 (what a reviewer checks) — this covers only the
ordering between them, which neither one owns.

## The shape of it

**The push is cheaply reversible. The App Store decision is not.** That asymmetry is the whole
runbook: everything expensive here happens before `git push`, and the deploy itself is a ~30-second
rollback away from exactly the state prod is in today — *provided* nobody fires the armed `DROP` while
they're in there.

That is a better position than the spec's step 3 implies, and the reason is measured below: **1.1 ships
no database migration at all.**

## What actually fires on `git push origin main`

Four Cloud Build triggers, concurrently and independently. They are not a pipeline; there is no
ordering between them and any one can fail while the others succeed.

| Trigger | Path filter | Fires on this push? |
|---|---|---|
| `skipper-api-deploy` | **none** | **always** — no `--included-files`, so a docs-only commit deploys the API too |
| `skipper-site-deploy` | `apps/site/**` | yes — `apps/site` touched |
| `skipper-admin-deploy` | `apps/admin/**`, `packages/db/**`, `packages/shared/**`, `packages/storage/**` | yes — three of four touched |
| `skipper-studio-deploy` | `packages/studio/**`, `packages/db/**`, `packages/engine/**`, `packages/shared/**` | yes — all four touched |

⚠ **The API trigger has no path filter** (verified against its `triggers create` command in
`gcp-cloud-run-deploy.md` — the other three carry `--included-files`, it does not). So there is **no
"push the docs first" half-step.** Any push is the whole cutover.

⚠ **`apps/mobile` deploys nothing.** EAS is a separate pipeline, so the moment this lands, prod serves
the 1.1 API while every build in the store and in TestFlight is a 1.0.x client. Confirm what is
actually in TestFlight before pushing rather than inferring it from `app.json` (which reads `1.0.1`).

## What does NOT happen — and the one thing that must not

⚠ **CORRECTED 2026-08-02, AT EXECUTION TIME. This section was true when written and false when used.**

It said: no migration pending, zero `.sql` files, the cutover is code-only, rollback is clean. By the
time the push happened, `6bd018e` had landed **migration `0042` — `DROP TABLE "drive_demand" CASCADE`,
already APPLIED to the shared Neon host.** The same commit closed the armed `DROP` this section warns
about two paragraphs down, so the warning worked; the summary above it just never caught up.

**The consequence inverts the rollback advice, so read this before trusting the Rollback section.**
The table was dropped from the DB *before* the code that writes to it was deployed away. The revision
live at push time (`skipper-api-00135-5zz`) still did `.insert(driveDemand)` on the drive-create path
— so `POST /drives` on production was **already broken** in the window between the migration and this
push. The push was the FORWARD FIX, not the risk.

Which means: **rolling back to `skipper-api-00135-5zz` would re-break drive creation.** It restores code
that writes to a table that no longer exists. Rollback is still correct for `/roam/*` and for anything
that does not touch `drive_demand`, but it is no longer "restores prod exactly."

The general rule this earns: **a migration applied ahead of its deploy makes rollback one-way for every
path that touches it.** Check `git diff --name-only origin/main..main -- packages/db/drizzle/` yourself
at push time — one command, and it is the difference between a reversible push and a forward-only one.

⚠ **Do not "tidy up" the schema during the cutover.** `drive_demand` is still **armed**: cut from
`schema.ts` in the 1.1 sweep (D25, `9f43d4e`), still present in the DB and in the newest drizzle
snapshot, so the next `db:generate` writes a `DROP` and `db:push` executes one. `scripts/db-preflight.ts`
guards `db:generate` and `db:push` — but **not `db:migrate`**, which only ever replays SQL already
written to a file. Leaving the table in place costs nothing and keeps rollback trivial. Firing it makes
the push one-way. Do it on a separate, deliberate day.

## Before the push

1. **Make the App Store decision.** This is the actual gate and it has been open for 46 commits.
   ⚠ **1.0.0 was SUBMITTED 2026-07-28** (founder — the spec's "created 2026-06-10" is the version
   *record*, not the submission, and reading it as the submission makes a normal wait look like a
   stuck one). Five days in is an ordinary 2026 wait, which means **the window is live and short**:
   expect a reviewer within days, not weeks. **Re-check the state before pushing** — an approval or a
   rejection changes the answer completely.
   The bind is bigger than one endpoint. `GET /roam/sample` **returns 200 on prod right now** and 404s
   the moment this lands — but step 3 removed roam from the API *entirely*, so every `/roam/*` route
   the shipped 1.0.0 build calls goes with it. **Pushing while 1.0.0 is in review hands the reviewer a
   broken app**, not a stale sample link. `app-store-submission.md` §12 has already been corrected to
   probe `/sample`; the reviewer holding the 1.0.0 submission has not.
   ⚠ The release type is **MANUAL**, so an approval cannot publish itself — it lands in *Pending
   Developer Release*. The exposure here is a REJECTION mid-review, never a surprise launch. That
   asymmetry is why waiting is cheap: let 1.0.0 resolve either way, then push. (Two versions cannot be
   in review at once, so it has to clear or be withdrawn before 1.0.1 goes anywhere regardless.)
2. **Capture the rollback target.** `:latest` is reused for every build, so rollback is **by revision**,
   never by tag. Write this down somewhere outside the terminal:
   ```bash
   gcloud run services describe skipper-api --region=us-east4 \
     --format='value(status.latestReadyRevisionName)'
   ```
3. **Root `bun run check` green, and `apps/mobile`'s too.** The API trigger runs no tests — Cloud Build
   builds the image and deploys it. Nothing between your terminal and prod will catch a red suite.
4. **Confirm `ANTHROPIC_API_KEY` is set on the deployed service.** It is a *runtime* requirement of
   `apps/api` as of 1.1, and the whole planner is dead without it. A missing key does not fail the
   deploy — it fails every rider turn into the in-persona outage line, which looks like a broken app
   rather than a misconfigured one.

## The push, and verifying it

```bash
git push origin main
```

Then verify **each service**, because they fail independently:

```bash
curl -s https://api.skipper.fm/health     # {"ok":true}
curl -s https://api.skipper.fm/sample     # 200 + a clip  (404 = SAMPLE_NARRATION_QID unset or stale deploy)
curl -s https://api.skipper.fm/regions    # DB reachable + prod secret decrypted
curl -s -o /dev/null -w '%{http_code}\n' https://api.skipper.fm/roam/sample   # expect 404 — the flip landed
curl -s -o /dev/null -w '%{http_code}\n' https://skipper.fm/privacy           # site trigger succeeded
```

⚠ **The first call after a deploy is a cold start** — `/health` measured **3.9 s** on 2026-08-02 against
a scaled-to-zero service. Slow is not broken; time out generously before concluding anything.

⚠ **A green `/health` proves the container booted, nothing more.** It is env-free by design. `/regions`
is the first call that proves the prod secret decrypted and the DB is reachable.

Admin and studio are behind IAP and won't show up in a curl sweep; check their builds in Cloud Build
rather than assuming they rode along.

## Rollback

```bash
gcloud run services update-traffic skipper-api --region=us-east4 --to-revisions=<CAPTURED>=100
```

⚠ **This no longer restores prod exactly** — see the correction above. `0042` dropped `drive_demand`
and the pre-push revision writes to it, so rolling back fixes `/roam/*` and re-breaks `POST /drives`.
The captured target for this push was `skipper-api-00135-5zz`; it is a partial escape hatch, not a
time machine. Roll back to stop a bad deploy, then go forward — do not sit on the old revision.

The site is a separate rollback (Firebase Hosting release history) and does not come back with it, so a
half-rolled-back fleet is a real intermediate state: **1.0 API, 1.1 marketing site.**

## What this does not cover

- **RISK-1 — no created drive has ever been driven end to end.** Pushing does not validate the product;
  `device-verification-runbook.md` has no recorded execution. Deploying and *knowing it works* are
  still two different days.
- The submission checklist itself — that is `app-store-submission.md` §12, and it is the more
  dangerous list because most of its items are ASC-side state that no deploy touches.
- `auth.ts` `allowedHosts` against the custom domain (`api.skipper.fm` is mapped and serving as of
  2026-08-02); the failure mode is silent wrong-base-URL links, not an error. See
  `gcp-cloud-run-deploy.md` › Post-deploy wiring.
- Anything about spend. The caps do not change at the push, but the *exposure* does the day riders
  arrive — [rider-spend-exposure.md](../research/rider-spend-exposure.md).
