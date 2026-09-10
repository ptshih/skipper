---
name: canary
description: Use right after pushing to verify prod is actually healthy — probes the API, diffs revisions, scans Cloud Run logs for new error signatures. For "did the deploy work", "check prod", "is it up", "canary".
---

# Canary

A push to `main` deploys the API to Cloud Run **at 100% with no canary**. Asking
before the push is only half the loop; this is the other half.

## Iron Law

**A deploy is not done because the build went green.** A build proves the image
was produced. Only prod answering correctly proves the deploy worked.

## The facts you need

| Thing | Value |
|---|---|
| Service | `skipper-api`, region `us-east4` |
| Public URL | `https://api.skipper.fm` (a Cloud Run **domain mapping** — no load balancer in front) |
| Liveness | `GET /health` → `{"ok":true}` |
| Contract | `GET /version` → the version policies |

Everything below is read-only. `gcloud run deploy`, `builds submit`, and job
execution all prompt through the guard for good reason — this skill does not
run them.

## Phase 0: Baseline — before the push, if you still can

If the push has not happened yet, capture the "before" first. A canary without a
baseline can only find total failure, not regression.

```bash
curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' https://api.skipper.fm/health
gcloud run services describe skipper-api --region us-east4 \
  --format='value(status.latestReadyRevisionName)'
```

Record the revision name and the response time. If the push already happened,
say so plainly in the report — you are working without a baseline, and "no new
error signatures" then means "none in the window I could see."

## Phase 1: Wait for the build

CD runs on push via Cloud Build (`cloudbuild.yaml`). Find the run and wait for a
terminal status rather than guessing at a duration:

⚠ **`--region=us-east4` IS REQUIRED, and omitting it does not error — it lies.** The trigger is a
REGIONAL 2nd-gen trigger (`docs/guides/gcp-cloud-run-deploy.md`), and both `gcloud builds list` and
`gcloud builds triggers list` default to **global**, where this project has no triggers and no build
since 2026-06-10. Run without the flag and CD looks like it never fired — a false "the push deployed
nothing", reached on 2026-08-05 and only caught by re-checking against the deploy guide.

```bash
gcloud builds list --region=us-east4 --limit 4 --format='table(id,status,createTime)'
```

There are four configured triggers, but they have **path filters**. Inspect the current filters and
match them against the pushed diff before deciding how many builds are expected:

```bash
gcloud builds triggers list --region=us-east4 --format='json(name,includedFiles,ignoredFiles,disabled)'
```

A service whose paths did not change may correctly have no build. For every expected trigger, track
the build matching the pushed commit to a terminal status; never count an older successful build.
The 2026-09-09 Yosemite operator push triggered API, Admin and Studio; Site correctly did not run.

If it is `WORKING` or `QUEUED`, wait and re-check. If it is `FAILURE`, stop —
there is nothing to canary, and the previous revision is still serving. Report
the failed step; do not try to fix the build from inside this skill.

## Phase 2: Did the revision actually change?

```bash
gcloud run services describe skipper-api --region us-east4 \
  --format='value(status.latestReadyRevisionName,status.traffic)'
```

The revision name **must differ from the baseline**. A green build with an
unchanged serving revision means the deploy did not take — that is a finding,
not a pass. Confirm traffic is 100% to the new revision.

## Phase 3: Probe the contract

```bash
curl -sS https://api.skipper.fm/health
curl -sS https://api.skipper.fm/version
```

`/health` must return `{"ok":true}`. It is deliberately env-free — it boots
without `DATABASE_URL`, so **a green `/health` proves the process is up, not
that the database or R2 is reachable.** Say that in the report rather than
implying more coverage than you have.

If the change touched a specific route, probe that route too — an anonymous
one is safe to hit (`GET /sample`, `GET /regions`). ⚠ Do **not** exercise
`POST /drives/plan` or `/drives/propose` as a smoke test: both spend real money
on every request, forever, with no human in the loop. Probing them is a rider-
triggered paid call you invented. Never do it.

## Phase 4: New error signatures

Compare against the window *before* the deploy, not against zero — a steady
background error is not a regression, and reporting it as one buries the signal.

```bash
gcloud logging read \
  'resource.type=cloud_run_revision AND resource.labels.service_name=skipper-api AND severity>=ERROR' \
  --limit 50 --freshness=15m --format='value(timestamp,textPayload,jsonPayload.message)'
```

Group by signature, not by line. Report **signatures that are new since the
deploy**, with counts. ⚠ Never paste a raw request body into the report — the
API deliberately does not log them, and a log dump can reintroduce exactly the
personal data that decision was protecting.

## Phase 5: Verdict

Be decisive. "Looks fine" is not a verdict.

```
Canary: skipper-api / us-east4
  Build:      <id> SUCCESS
  Revision:   <old> → <new>, traffic 100%
  /health:    200 {"ok":true} in 84ms  (process up; says nothing about DB or R2)
  /version:   200, policies unchanged
  Errors:     no new signatures in 15m (baseline had 2 × <sig>, still 2)
  VERDICT:    healthy | degraded | rolled back needed
```

**If it is bad:** say so immediately and name the rollback rather than
performing it. Traffic rollback is a real production action and needs an
explicit go:

```
gcloud run services update-traffic skipper-api --region us-east4 --to-revisions=<previous>=100
```

Recommend it, state what it costs (the fix is reverted, riders on the new
revision move back mid-session), and let the human decide.

## What this does not cover

The mobile client. A healthy API says nothing about whether the app still
works — TestFlight ships on its own cadence and a wire-contract change can be
green here and broken there. If the push touched a shared DTO, say so.
