# GCP Cloud Run deploy

**Status:** ✅ **Live 2026-06-10.** `@skipper/api` runs on Cloud Run in **us-east4**;
deploys continuously on push to `main` via a Cloud Build trigger. First production
deploy. Values below (project number, service URL, SA) are real for this project —
re-derive if the project is recreated; the *shape* is the durable part.

## What & where

- **Service:** `skipper-api` on Cloud Run, region **us-east4** (Ashburn). Chosen to
  co-locate with the Neon Postgres in **AWS us-east-1** (~2 ms): the API does several
  *sequential* DB round-trips per request and serves audio via R2 presigned URLs (not
  through itself), so DB proximity dominates latency, not user proximity.
- **Image:** built from `apps/api/Dockerfile` — a lean Bun image (the workspace is
  trimmed to `api + db + shared + storage`; no React-Native tree). Pushed to Artifact
  Registry `us-east4-docker.pkg.dev/<project>/skipper/api`.
- **Deploy config:** `cloudbuild.yaml` (build → push → deploy) + `.gcloudignore`
  (trims the build upload and re-excludes `.env.keys`).
- **Project:** `lithe-window-491818-k8` (number `666110297056`).

## How deploys happen

- **Push to `main` → auto build + deploy** (Cloud Build trigger runs `cloudbuild.yaml`).
- **Manual fallback** (same pipeline): `gcloud builds submit --config cloudbuild.yaml`.
- **Rollback:** by Cloud Run revision, not image tag —
  `gcloud run services update-traffic skipper-api --region=us-east4 --to-revisions=REVISION=100`.

## Secrets model

`.env.production` is committed **dotenvx-encrypted** and baked into the image. The
runtime decrypts it at boot with `DOTENV_PRIVATE_KEY_PRODUCTION`, mounted from Secret
Manager. **Nothing secret enters GitHub or CI** — the only secret is that one key.

## One-time setup (done; recorded for rebuild / disaster recovery)

```bash
# APIs
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com developerconnect.googleapis.com

# Artifact Registry repo
gcloud artifacts repositories create skipper --repository-format=docker --location=us-east4

# Secret: populate from the gitignored .env.keys (NOT from $ENV — the var isn't exported).
# $(...) strips the trailing newline; the value is never printed.
printf '%s' "$(grep '^DOTENV_PRIVATE_KEY_PRODUCTION=' .env.keys | cut -d= -f2-)" | \
  gcloud secrets create dotenv-private-key-production --data-file=-
# verify it's exactly 64 chars:
gcloud secrets versions access latest --secret=dotenv-private-key-production | wc -c

# IAM — all on the Compute Engine default SA, which is the Cloud Build AND Cloud Run
# runtime identity on new projects:
SA=666110297056-compute@developer.gserviceaccount.com
gcloud projects add-iam-policy-binding lithe-window-491818-k8 --member=serviceAccount:$SA --role=roles/cloudbuild.builds.builder    # build + read source bucket + logs
gcloud projects add-iam-policy-binding lithe-window-491818-k8 --member=serviceAccount:$SA --role=roles/artifactregistry.writer      # push image
gcloud projects add-iam-policy-binding lithe-window-491818-k8 --member=serviceAccount:$SA --role=roles/run.admin                    # deploy (CD)
gcloud projects add-iam-policy-binding lithe-window-491818-k8 --member=serviceAccount:$SA --role=roles/iam.serviceAccountUser       # act-as the runtime SA (CD)
gcloud secrets add-iam-policy-binding dotenv-private-key-production --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor  # read the secret at runtime
```

**Public access:** handled by `--no-invoker-iam-check` in the deploy step (see Gotchas
— Domain Restricted Sharing blocks the usual `allUsers` binding). If a future org
policy enforces `constraints/run.managed.requireInvokerIam`, relax it for this project
(needs `roles/orgpolicy.policyAdmin`) before that flag will take.

## Continuous deployment (the GitHub trigger)

```bash
# 0. One-time: the Cloud Build SERVICE AGENT (P4SA, distinct from the Compute SA) stores
#    the GitHub OAuth token in Secret Manager, so it needs secretmanager.admin first.
gcloud projects add-iam-policy-binding lithe-window-491818-k8 \
  --member=serviceAccount:service-666110297056@gcp-sa-cloudbuild.iam.gserviceaccount.com \
  --role=roles/secretmanager.admin

# 1. Connect GitHub (one interactive OAuth step — follow the printed link to install
#    the Cloud Build GitHub App on ptshih/skipper). Region must match the trigger.
gcloud builds connections create github skipper-gh --region=us-east4

# 2. Link the repo under the connection
gcloud builds repositories create skipper \
  --remote-uri=https://github.com/ptshih/skipper.git \
  --connection=skipper-gh --region=us-east4

# 3. Trigger: push to main -> run cloudbuild.yaml. --service-account is REQUIRED on this
#    project (no usable default Cloud Build SA → a regional 2nd-gen trigger must name one;
#    omitting it fails with a bare INVALID_ARGUMENT). The compute SA already has the roles.
gcloud builds triggers create github --name=skipper-api-deploy --region=us-east4 \
  --repository=projects/lithe-window-491818-k8/locations/us-east4/connections/skipper-gh/repositories/skipper \
  --branch-pattern='^main$' --build-config=cloudbuild.yaml \
  --service-account=projects/lithe-window-491818-k8/serviceAccounts/666110297056-compute@developer.gserviceaccount.com

# Kick the first CD build without waiting for a new commit:
gcloud builds triggers run skipper-api-deploy --branch=main --region=us-east4
```

If `connections create` reports us-east4 isn't a supported Cloud Build region, use
`--region=us-central1` for all three commands (the build still deploys to us-east4 via
`cloudbuild.yaml`; the trigger region is independent of the Cloud Run region).

## Verify

```bash
URL=$(gcloud run services describe skipper-api --region=us-east4 --format='value(status.url)')
curl -s "$URL/health"   # {"ok":true}            — container up + public
curl -s "$URL/regions"  # {"regions":[...]}      — DB reachable + secret decrypted
```

## Post-deploy wiring

- **`apps/api/src/auth.ts` `allowedHosts`** must contain the live host (currently
  `skipper-api-csslmysz7q-uk.a.run.app`). If it's missing, Better Auth falls back to a
  wrong base URL and sign-in / OAuth / password-reset links break (anonymous preview
  still works). Update + push (CD redeploys). A custom domain, once mapped, replaces it.
  ⚠ Entries are matched against the Host header **verbatim, including the port** — bare
  `localhost` does NOT match `localhost:8787`, which is why the dev entry is a `localhost:*`
  wildcard. A near-miss here doesn't error; it silently falls through to `fallback`, so a local
  server happily generates production links.
- **Cloud Run terminates TLS**, so the container always sees `http://` no matter how the rider
  connected. `baseURL.protocol: 'auto'` therefore needs `advanced.trustedProxyHeaders: true`
  (in `auth.ts`) to read `x-forwarded-proto` — it defaults to false, and without it every
  generated link is `http`, including the password-reset link that carries a one-time recovery
  token in its path. The host redirects http→https so nothing visibly breaks, which is exactly
  why this went unnoticed from 2026-06-10 until 2026-07-27. Verify after a deploy by reading the
  protocol on a real reset mail, not by assuming.
- **Mobile:** build with `EXPO_PUBLIC_API_URL=$URL`.

## Gotchas we hit (so the next deploy doesn't re-discover them)

| Symptom | Cause | Fix |
| --- | --- | --- |
| `builds submit` 403 `storage.objects.get` | New projects run Cloud Build as the Compute SA, which lacks perms | Grant the Compute SA `cloudbuild.builds.builder` (+ `artifactregistry.writer` to push) |
| `bun install` "Workspace dependency @skipper/storage not found" | Dockerfile trimmed workspaces to api+db+shared; `storage` was extracted later | Dockerfile now copies `packages/storage` + lists it in the trimmed workspaces |
| Deploy: `Permission denied on secret … for Revision service account` | Runtime SA lacked secret access | Grant the Compute SA `secretmanager.secretAccessor` on the secret |
| Deploy: secret `versions/latest was not found` | `gcloud secrets create` stored an empty value (`$DOTENV_PRIVATE_KEY_PRODUCTION` wasn't set in the shell) | Re-add the version reading from `.env.keys` (see One-time setup) |
| `--allow-unauthenticated` → `One or more users named in the policy do not belong to a permitted customer` | Domain Restricted Sharing org policy blocks `allUsers` | Use `--no-invoker-iam-check` instead (public without an `allUsers` binding; app auth still applies) |
| `connections create github` → `could not assert Secret Manager permissions … P4SA … secretmanager.secrets.create denied` | The Cloud Build service agent (`…@gcp-sa-cloudbuild…`, not the Compute SA) stores the GitHub token as a secret | Grant that service agent `roles/secretmanager.admin` |
| `triggers create github` → bare `INVALID_ARGUMENT` (even with a valid `--repository`) | Secure-by-default: no usable default Cloud Build SA, so a regional 2nd-gen trigger must name one | Add `--service-account=projects/<id>/serviceAccounts/<compute-SA>` |
| `builds submit` → `COPY failed: file not found in build context: packages/<name>/package.json` (push-triggered builds fine) | `.gcloudignore` excluded a package the Dockerfile COPYs. Only `builds submit` reads that file — a trigger build gets a full repo checkout — so the two paths drift silently until someone reaches for the fallback | Drop it from `.gcloudignore`; keep that file in lockstep with the Dockerfile's COPY list (hit 2026-07-29 on `packages/engine`, which the API has imported since roam) |

## The apex site (skipper.fm) — Firebase Hosting

`apps/site` is a static Astro app for the `skipper.fm` apex, deployed to **Firebase
Hosting** in the SAME project (`lithe-window-491818-k8`). It serves the iOS association file
(`public/.well-known/apple-app-site-association`); `firebase.json` sets `appAssociation:NONE`
+ the `application/json` Content-Type and drops the `**/.*` ignore glob so the dotfolder
deploys. (Until 2026-07-27 this paragraph described a file that did not exist — the path 404'd.)

⚠ That file declares **`webcredentials` only — deliberately no `applinks`**, and the app's
`associatedDomains` matches. There is no universal-link destination to declare: `/t/<id>` was
the SHARED-TOUR model, and the v2 pivot made drives user-owned and private, so nothing on
skipper.fm is shareable content. The one page an app could claim, `/reset-password`, is
deliberately web-only — intercepting it would recreate the exact failure the web reset exists
to avoid (a reset that only works on the device that still has a session). What `webcredentials`
buys is real though: reset finishes in a BROWSER, so iOS saves the new password against
skipper.fm, and without the association the app's sign-in field can't autofill the password the
rider just set. Don't "restore" applinks without a route that actually handles it. CD reuses the SAME `skipper-gh` GitHub
connection via a second trigger (`cloudbuild.site.yaml`), path-filtered to `apps/site/**`,
deploying with the official `us-docker.pkg.dev/firebase-cli/us/firebase` image (ADC, no token).

```bash
SA=666110297056-compute@developer.gserviceaccount.com
# Build SA roles for Firebase deploy (per Cloud Build→Firebase docs; firebase.admin can be
# narrowed to firebasehosting.admin if a hosting-only deploy is enough)
gcloud projects add-iam-policy-binding lithe-window-491818-k8 --member=serviceAccount:$SA --role=roles/firebase.admin
gcloud projects add-iam-policy-binding lithe-window-491818-k8 --member=serviceAccount:$SA --role=roles/serviceusage.apiKeysViewer

# Ensure the default Hosting site exists (id = project id). If empty, use the console
# (Build → Hosting → Get started) or:
gcloud firebase hosting:sites:list --project lithe-window-491818-k8

# Second trigger (reuses skipper-gh; only fires on apps/site changes)
gcloud builds triggers create github --name=skipper-site-deploy --region=us-east4 \
  --repository=projects/lithe-window-491818-k8/locations/us-east4/connections/skipper-gh/repositories/skipper \
  --branch-pattern='^main$' --build-config=cloudbuild.site.yaml \
  --included-files='apps/site/**,cloudbuild.site.yaml' \
  --substitutions=_FIREBASE_PROJECT=lithe-window-491818-k8 \
  --service-account=projects/lithe-window-491818-k8/serviceAccounts/$SA
```

Custom domain: Hosting console → Add custom domain → `skipper.fm` → add its records at
Cloudflare as **DNS-only (grey cloud)**. Manual deploy: `firebase deploy --only hosting`
from `apps/site` (a `.firebaserc` pins the project).

## The admin console + the skipper-studio job — Cloud Run (admin DEPLOYED 2026-06-11)

`apps/admin` (the founder-only ops console: a bun Hono API + the built `apps/admin/client`
Vite/React SPA, ONE container) → a Cloud Run **service** `skipper-admin` behind **Google
IAP**. `packages/studio` → a Cloud Run **job** `skipper-studio` (the corpus/roam CLI runner:
discover-pois / enrich-pois / generate-narrations / resynth-narration / sweep-orphans / refetch-poi,
one image, per-execution `args`). Both reuse the
SAME `skipper-gh` connection + the `skipper` Artifact Registry repo — CD is two more
triggers. Full design: `docs/specs/admin-ops-console-spec.md` (§7/§10). Code-complete on
branch `feat/admin-ops-v0`; the steps below are the first deploy.

**Sequence:** merge to `main` → one-time setup → register triggers → first build → enable
IAP (+ DRS relax) → smoke-test. (Triggers fire on `^main$`, so nothing auto-deploys until merge.)

**Deployed 2026-06-11.** `skipper-admin` is live behind IAP. Real-world fixes (folded into the
steps below): the run.developer grant on the gen job moves AFTER its first build (NOT_FOUND
otherwise); the IAP accessor binds via `iap web … --resource-type=cloud-run`, NOT `run services
add-iam-policy-binding` (which rejects the role); direct IAP walls the WHOLE service, so an
external `curl /health` returns "Invalid IAP credentials: empty token" — that's success, not a
broken route. **Admin identity = `peter@manoa.health`** (in-domain): a personal-gmail accessor
needs DRS relaxed, so we switched to the Workspace account and re-enabled DRS. **Gen image
context:** the root `.dockerignore` (api-tuned) excluded `packages/studio` + `packages/engine`,
which the gen Dockerfile COPYs → "file does not exist in build context"; it's SHARED across all
three image builds, so it must only exclude what NO build COPYs (fixed + commented in the file).
**Prod GCP auth = ADC, not a key file:** `.env.production` carried a dev-local
`GOOGLE_APPLICATION_CREDENTIALS=./keys/…json` (absent in the container) → the admin's `jobs:run`
`GoogleAuth` and the gen Job's TTS both ENOENT'd; fix = empty `GOOGLE_APPLICATION_CREDENTIALS` +
`GOOGLE_TTS_USE_ADC=true` in prod so both use the runtime SA's ADC (`config.ts:39` predicts this
exact trap). **Footgun:** `.env.production` lives at the repo ROOT, outside EVERY trigger's
`--included-files`, so a prod-env change (`ADMIN_EMAIL`, the ADC vars, …) does NOT auto-deploy AND
is baked into BOTH the admin service and the gen Job images — push, then manually rebuild **both**:
`gcloud builds triggers run skipper-admin-deploy --branch=main --region=us-east4` and
`… skipper-studio-deploy …`. **Smoke-tested 2026-06-11:** New run → Sweep orphans (dry-run) ran the
full IAP→jobs:run→reconcile chain green.

```bash
PROJECT=lithe-window-491818-k8
COMPUTE=666110297056-compute@developer.gserviceaccount.com

# 1) One-time setup (BEFORE the first build — the cloudbuild files reference these).
gcloud services enable iap.googleapis.com texttospeech.googleapis.com --project $PROJECT

gcloud iam service-accounts create skipper-studio  --project $PROJECT
gcloud iam service-accounts create skipper-admin --project $PROJECT
GEN=skipper-studio@$PROJECT.iam.gserviceaccount.com
ADMIN=skipper-admin@$PROJECT.iam.gserviceaccount.com

# gen job: read the dotenv secret. TTS authorizes via THIS SA's ADC token — no IAM role, no key.
gcloud secrets add-iam-policy-binding dotenv-private-key-production --member=serviceAccount:$GEN --role=roles/secretmanager.secretAccessor --project $PROJECT
# admin: read the secret. (The run.developer grant ON the gen job is DEFERRED to step 3 —
# the job does not exist until its first build creates it, so binding here fails NOT_FOUND.)
gcloud secrets add-iam-policy-binding dotenv-private-key-production --member=serviceAccount:$ADMIN --role=roles/secretmanager.secretAccessor --project $PROJECT
# the Compute BUILD SA must act-as both runtime SAs to deploy them
gcloud iam service-accounts add-iam-policy-binding $GEN   --member=serviceAccount:$COMPUTE --role=roles/iam.serviceAccountUser --project $PROJECT
gcloud iam service-accounts add-iam-policy-binding $ADMIN --member=serviceAccount:$COMPUTE --role=roles/iam.serviceAccountUser --project $PROJECT

# ADMIN_EMAIL = the single allowed IAP principal, into the ENCRYPTED prod env (commit the re-encrypted file).
dotenvx set ADMIN_EMAIL "ptshih@gmail.com" -f .env.production

# additive migrations to prod (the jobs table + drives.route_provenance — 0005/0006). NOTE: the
# jobs table is now `studio_jobs` (gen_jobs → pipeline_jobs → studio_jobs, renamed in 0013/0015),
# and route_provenance lives on `drives` — the `tours` table was dropped in the V2 pivot (0009).
bun run db:migrate:prod

# 2) CD triggers (reuse skipper-gh; path-filtered). The browser Maps key is HARDCODED in
#    cloudbuild.admin.yaml's --build-arg (public, referrer-restricted) — so NO _VITE_MAPS_KEY sub
#    (a declared-but-unused substitution fails the default MUST_MATCH check).
gcloud builds triggers create github --name=skipper-studio-deploy --region=us-east4 \
  --repository=projects/$PROJECT/locations/us-east4/connections/skipper-gh/repositories/skipper \
  --branch-pattern='^main$' --build-config=cloudbuild.studio.yaml \
  --included-files='packages/studio/**,packages/db/**,packages/engine/**,packages/shared/**,packages/storage/**,cloudbuild.studio.yaml' \
  --service-account=projects/$PROJECT/serviceAccounts/$COMPUTE

gcloud builds triggers create github --name=skipper-admin-deploy --region=us-east4 \
  --repository=projects/$PROJECT/locations/us-east4/connections/skipper-gh/repositories/skipper \
  --branch-pattern='^main$' --build-config=cloudbuild.admin.yaml \
  --included-files='apps/admin/**,packages/db/**,packages/shared/**,packages/storage/**,cloudbuild.admin.yaml' \
  --service-account=projects/$PROJECT/serviceAccounts/$COMPUTE

# 3) First build (after merge) — or `gcloud builds submit --config cloudbuild.<gen|admin>.yaml`.
# Build the gen JOB FIRST so `skipper-studio` exists, THEN grant admin run.developer on it (deferred
# from step 1; run.developer carries run.jobs.runWithOverrides + run.executions.get — run.invoker
# is NOT enough because we send an overrides body).
gcloud builds triggers run skipper-studio-deploy --branch=main --region=us-east4
gcloud run jobs add-iam-policy-binding skipper-studio --region=us-east4 --member=serviceAccount:$ADMIN --role=roles/run.developer --project $PROJECT
gcloud builds triggers run skipper-admin-deploy --branch=main --region=us-east4

# 4) Enable IAP on the admin service (AFTER its first deploy creates it), founder-only.
gcloud beta run services update skipper-admin --region=us-east4 --iap --project $PROJECT
# Grant the founder the IAP accessor. Bind on the IAP RESOURCE via `iap web`
# (--resource-type=cloud-run) — NOT `run services add-iam-policy-binding`, which rejects the
# role with "roles/iap.httpsResourceAccessor is not supported for this resource". Verified vs
# the IAP-for-Cloud-Run doc 2026-06-11. Use the email you actually SIGN IN with (== ADMIN_EMAIL).
gcloud iap web add-iam-policy-binding --resource-type=cloud-run --service=skipper-admin \
  --region=us-east4 --member=user:ptshih@gmail.com --role=roles/iap.httpsResourceAccessor --project $PROJECT

# 5) Verify. Direct IAP on Cloud Run walls the WHOLE service — NO per-path bypass — so an
# external `curl $URL/health` returns "Invalid IAP credentials: empty token". That rejection
# IS the success signal (IAP is enforcing); it does NOT mean /health is broken. Cloud Run's own
# startup/liveness probes hit the container directly (not via IAP), so the revision stays healthy.
# REAL check: open $URL in a browser → IAP sign-in with ADMIN_EMAIL → you reach the SPA (a 403
# after sign-in = IAP ok but the email != ADMIN_EMAIL).
URL=$(gcloud run services describe skipper-admin --region=us-east4 --format='value(status.url)')
# the gen job runs out-of-band (not behind IAP). The CLI was split into per-script
# entry-points in the V1→V2 migration (no single run.ts dispatcher) — name a real script,
# e.g. sweep-orphans.ts (or discover-pois.ts / enrich-pois.ts / generate-narrations.ts):
gcloud run jobs execute skipper-studio --region=us-east4 \
  --args="packages/studio/src/sweep-orphans.ts,--dry-run"
```

⚠️ **DRS gotcha (same as the api's `--no-invoker-iam-check`):** enabling IAP adds a
`serviceAccount:service-666110297056@gcp-sa-iap…` → `roles/run.invoker` binding that the
legacy `iam.allowedPolicyMemberDomains` (DRS) constraint blocks (out-of-domain service
agent). Temporarily relax DRS (needs `roles/orgpolicy.policyAdmin`) to register it, then restore.

## Files

- `cloudbuild.yaml` — the API build → push → deploy pipeline (this is the contract).
- `cloudbuild.site.yaml` — the apex site build → Firebase Hosting deploy.
- `cloudbuild.studio.yaml` — the `skipper-studio` Cloud Run **job** build → `jobs deploy`.
- `cloudbuild.admin.yaml` — the `skipper-admin` service (multi-stage: SPA + Hono) build → deploy.
- `.gcloudignore` — trims the Cloud Build upload; re-excludes `.env.keys`.
- `apps/api/Dockerfile` — the lean Bun image (header explains the workspace trim).
- `packages/studio/Dockerfile` — the `skipper-studio` Job image (one image; pass a per-script entry-point
  as the first arg — the real CLIs are `discover-pois.ts` / `enrich-pois.ts` / `generate-narrations.ts` /
  `resynth-narration.ts` / `sweep-orphans.ts` / `refetch-poi.ts`, NOT a single `run.ts` dispatcher).
  TODO (separate code follow-up): the Dockerfile's own header comment still lists removed scripts
  (`run.ts` / `patch-clip.ts` / `resynth-tour.ts`) — don't trust it; it's stale, not authoritative.
- `apps/admin/Dockerfile` — the admin service (stage 1 builds `apps/admin/client`, stage 2 serves it).
- `apps/site/` — the Astro apex site (`firebase.json`, `.firebaserc`, static AASA).
