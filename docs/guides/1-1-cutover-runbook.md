# The 1.1 cutover — the first push

**Status:** Ready — 2026-08-02, written against `main` at `3db599d` with **49 commits unpushed** and
every fact below measured, not assumed. **Never executed**; the first execution is the one it was
written for. Where this and the code disagree, the code wins. Companion to
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

**No migration is pending.** `git diff --name-only origin/main..main -- packages/db/drizzle/` returns
**zero `.sql` files** across all 49 commits. 1.1 changed no schema. The cutover is code-only, which is
precisely why rollback is clean — there is no DDL to un-apply.

⚠ **Do not "tidy up" the schema during the cutover.** `drive_demand` is still **armed**: cut from
`schema.ts` in the 1.1 sweep (D25, `9f43d4e`), still present in the DB and in the newest drizzle
snapshot, so the next `db:generate` writes a `DROP` and `db:push` executes one. `scripts/db-preflight.ts`
guards `db:generate` and `db:push` — but **not `db:migrate`**, which only ever replays SQL already
written to a file. Leaving the table in place costs nothing and keeps rollback trivial. Firing it makes
the push one-way. Do it on a separate, deliberate day.

## Before the push

1. **Make the App Store decision.** This is the actual gate and it has been open for 46 commits.
   1.0.0 was `WAITING_FOR_REVIEW` when the spec probed it on 2026-07-31; **re-check the current state
   rather than trusting that** — an approval or a rejection in the interim changes the answer
   completely. The bind: `GET /roam/sample` **returns 200 on prod right now** and becomes a 404 the
   moment this lands, and `GET /sample` (its 1.1 replacement) is **404 right now** and becomes the live
   one. `app-store-submission.md` §12 has already been corrected to probe `/sample`; a reviewer holding
   the 1.0.0 submission has not. Withdraw, wait it out, or accept the window — but decide it here.
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

Because there is no migration, this restores prod exactly — including `/roam/sample` answering 200
again. The site is a separate rollback (Firebase Hosting release history) and does not come back with
it, so a half-rolled-back fleet is a real intermediate state: **1.0 API, 1.1 marketing site.**

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
