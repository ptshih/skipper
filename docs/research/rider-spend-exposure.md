# Rider-triggered spend: what the caps actually bound

**Status:** Findings — 2026-08-01, from a read-only pass during 1.1 step 10. **Not decisions and not
greenlit.** Every number below is a CEILING derived from the repo's own constants and Cloud Run's
documented defaults, never a forecast of real traffic. Where this doc and the code disagree, the code
wins. Successor to the spend-exposure theme in
[api-best-practices-audit.md](api-best-practices-audit.md), whose top finding (the spoofable
leftmost `X-Forwarded-For`) has since been fixed.

## Why this exists

CLAUDE.md's STOP rule says rider-triggered spend is governed by **caps, not by a founder go-per-run**:
`POST /drives/plan` and `POST /drives/propose` bill an external vendor on every request, forever,
anonymously, with no `--apply` and no human in the loop. `apps/api/src/limits.ts` states the
consequence plainly — "there is no approval step in which a bad number gets caught, so the numbers
themselves ARE the control."

That is true for a single hammering caller. This doc is about the part it cannot be true for.

⚠ **The premise moved in 1.1 step 8 and the acceptance did not.** `PROPOSE_RATE` was set when
`/propose` sat behind an account wall — the wall was the first-order guard and the limiter was
defence-in-depth. After D14/D15 both paid endpoints are reachable by any stranger and the limiter is
the only guard. RISK-4 was accepted "while unlaunched"; what changed since is not launch, it is the
removal of the wall that made the acceptance cheap.

## Already handled — do not re-report these

- **Per-instance multiplication is documented, not missed.** `limits.ts`: "Keyed per-IP and
  per-INSTANCE, so the effective ceiling is limit × live instances (RISK-4, accepted while
  unlaunched)." `rate-limit.ts` says the same and names the M4 upgrade (shared store or an LB-layer
  limit).
- **The `X-Forwarded-For` bypass is fixed and fixed correctly.** `clientIp` parses from the RIGHT,
  skipping `TRUSTED_PROXY_HOPS` (0 today — a domain mapping, no LB). The comment records that the old
  leftmost read let any caller mint a fresh bucket per request, and that a wrong HOPS value can only
  over-share a bucket, never re-open the bypass. This was the June audit's top finding.
- **Two stacked windows on `/drives/plan` were verified by probe**, not assumed: a second
  `rateLimit()` closes over its own map, so `PLAN_RATE_MINUTE` + `PLAN_RATE_HOUR` are independent
  buckets and the tighter one wins.

## Findings

### 1. The multiplier in "limit × live instances" is an unchosen platform default

`cloudbuild.yaml`'s deploy step passes `--region`, `--no-invoker-iam-check` and `--set-secrets`.
There is **no `--max-instances`, no `--min-instances`, no `--concurrency`**. So the multiplier is
Cloud Run's default cap of **100**, which is what you get by not saying rather than a number anyone
picked. RISK-4 was accepted against a figure that appears nowhere in the repo.

### 2. The costliest endpoint is the one that most easily forces the multiplication

Instance count is driven by concurrency, and concurrency is occupancy × duration. Cloud Run's default
is 80 concurrent requests per instance. A planner call can hold its slot for `PLANNER_TIMEOUT_MS`
(45 s) — roughly 45× an ordinary request. The endpoint with the highest per-call cost is therefore
also the one that fills concurrency slots fastest and triggers scale-out with the least traffic. The
limiter's weakness and the endpoint's cost point the same direction.

### 3. `PLAN_RATE_HOUR` is structurally the weakest cap, and it is the one `limits.ts` calls the most important

The window is 3,600 s; the counter is in-memory and dies with the instance. With no `--min-instances`,
Cloud Run scales to zero and recycles idle instances in minutes. **A one-hour fixed window on a
process that frequently does not live an hour is close to no cap at all.** `PLAN_RATE_MINUTE`
survives instance churn fine — a 60 s window mostly fits inside an instance lifetime. The hourly
bucket, added precisely because 20/min alone permits ~28,800 requests/day, is the one churn erases.

⚠ This is a different failure from RISK-4. RISK-4 is "N instances each enforce the cap separately."
This is "an instance that dies inside the window never enforces the long cap at all," and it applies
even at one instance.

### 4. Per-IP caps are an abuse guard, not a wallet guard — and nothing else is one

Every cap in `limits.ts` keys on client IP, so each bounds ONE caller. Nothing anywhere bounds
aggregate spend. A thousand IPs each staying inside 120/hr violates no limit and produces 120,000
calls/hour. There is no global token ceiling, no daily budget, no circuit breaker.

There is also no backstop below the code: TODO.md records that the GCP **Budget API is not enabled**
on the project (`gcloud beta billing budgets list` → `SERVICE_DISABLED`), and that there is no
alerting of any kind — no uptime checks, no alert policies, no notification channels. Prod already
500'd for **14 undetected days** and was found by a human running `curl`. The first signal of runaway
model spend today would be the invoice.

## The numbers, and what they are worth

Derived from the repo's own constants — `spend.ts` (`claude-opus-5` at $5/$25 per MTok),
`PLANNER_MAX_TOKENS` 2,048, `MAX_PLAN_TOTAL_CHARS` 12,000, `MAX_PLAN_ANCHORS` 200 — plus Cloud Run
defaults.

| | worst-case planner turn |
|---|---|
| input | ~5k tok (12k chars ≈ 3–4k, plus system prompt + up to 200 anchors) → ~$0.025 |
| output | 2,048 tok, thinking + visible in one budget → ~$0.051 |
| **per call** | **~$0.08** |

| ceiling | rate | ≈ cost |
|---|---|---|
| one IP, one instance | 120/hr | ~$9.60/hr |
| one IP × 100 default instances | 12,000/hr | ~$960/hr (~$23k/day) |
| 1,000 IPs, every request compliant | 120,000/hr | ~$9,600/hr |

⚠ **These are ceilings, not predictions, and three things pull the real figure down**: prompt caching
cuts input materially (the transcript now sits inside the cached prefix — a step-6 adversary fix);
sustaining 100 instances takes real sustained concurrency; and `PLANNER_MAX_TOKENS` is a ceiling, not
a reservation, so a typical turn spends far less. The point is the SHAPE — the ceiling is set by a
platform default nobody chose, and nothing in the system converts request counts into dollars.

⚠ `/drives/propose` bills Google Routes per call rather than a model, at a lower unit cost. No price
is quoted here because none is verified in-repo. Structurally it is the same finding.

## What would be cheap

Ranked by value per minute of work. None is a limiter redesign.

1. **Enable the Budget API and set a billing alert.** Free, ~5 min, no code, no shared-tree risk, and
   it catches every runaway mode including ones nobody predicted — the only control here that does not
   depend on having correctly anticipated the attack. Billing is the documented root cause of the only
   real outage this project has had. Already tracked in TODO.md's ops-hardening section.
2. **Set `--max-instances` on the API deploy.** One line in `cloudbuild.yaml`. Converts "up to 100×,
   by default" into a number someone chose. For an unlaunched app a small value bounds the worst case
   while sitting far above real demand, and it is trivially raised at launch.
3. **Re-accept or re-price RISK-4 deliberately**, given that step 8 removed the wall that made the
   original acceptance cheap. This is a founder call under the STOP rule, not a refactor — the
   recommendation here is only that it be *made* rather than inherited.

Deliberately NOT recommended for now: a shared-state limiter or a global spend ceiling. That is real
machinery, `rate-limit.ts` already puts it at M4, and pulling it forward would cost more than the
exposure while there are no riders.

## What would change this analysis

- Setting `--max-instances` (finding 1 collapses to whatever number is chosen).
- A `--min-instances ≥ 1` (finding 3 weakens — a warm instance can span the hourly window).
- Launch, or any real traffic (every ceiling here stops being hypothetical).
- A shared-state limiter or an LB-layer limit (findings 1 and 3 both dissolve).
