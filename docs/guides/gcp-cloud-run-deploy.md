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
# 1. Connect GitHub (one interactive OAuth step — follow the printed link to install
#    the Cloud Build GitHub App on ptshih/skipper). Region must match the trigger.
gcloud builds connections create github skipper-gh --region=us-east4

# 2. Link the repo under the connection
gcloud builds repositories create skipper \
  --remote-uri=https://github.com/ptshih/skipper.git \
  --connection=skipper-gh --region=us-east4

# 3. Trigger: push to main -> run cloudbuild.yaml
gcloud builds triggers create github --name=skipper-api-deploy --region=us-east4 \
  --repository=projects/lithe-window-491818-k8/locations/us-east4/connections/skipper-gh/repositories/skipper \
  --branch-pattern='^main$' --build-config=cloudbuild.yaml

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
curl -s "$URL/tours"    # {"tours":[...]}        — DB reachable + secret decrypted
```

## Post-deploy wiring

- **`apps/api/src/auth.ts` `allowedHosts`** must contain the live host (currently
  `skipper-api-csslmysz7q-uk.a.run.app`). If it's missing, Better Auth falls back to a
  wrong base URL and sign-in / OAuth / password-reset links break (anonymous preview
  still works). Update + push (CD redeploys). A custom domain, once mapped, replaces it.
- **Mobile:** build with `EXPO_PUBLIC_API_URL=$URL`.

## Gotchas we hit (so the next deploy doesn't re-discover them)

| Symptom | Cause | Fix |
| --- | --- | --- |
| `builds submit` 403 `storage.objects.get` | New projects run Cloud Build as the Compute SA, which lacks perms | Grant the Compute SA `cloudbuild.builds.builder` (+ `artifactregistry.writer` to push) |
| `bun install` "Workspace dependency @skipper/storage not found" | Dockerfile trimmed workspaces to api+db+shared; `storage` was extracted later | Dockerfile now copies `packages/storage` + lists it in the trimmed workspaces |
| Deploy: `Permission denied on secret … for Revision service account` | Runtime SA lacked secret access | Grant the Compute SA `secretmanager.secretAccessor` on the secret |
| Deploy: secret `versions/latest was not found` | `gcloud secrets create` stored an empty value (`$DOTENV_PRIVATE_KEY_PRODUCTION` wasn't set in the shell) | Re-add the version reading from `.env.keys` (see One-time setup) |
| `--allow-unauthenticated` → `One or more users named in the policy do not belong to a permitted customer` | Domain Restricted Sharing org policy blocks `allUsers` | Use `--no-invoker-iam-check` instead (public without an `allUsers` binding; app auth still applies) |

## Files

- `cloudbuild.yaml` — the build → push → deploy pipeline (this is the contract).
- `.gcloudignore` — trims the Cloud Build upload; re-excludes `.env.keys`.
- `apps/api/Dockerfile` — the lean Bun image (header explains the workspace trim).
