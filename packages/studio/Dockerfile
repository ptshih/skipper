# Cloud Run JOB image for @skipper/studio — runs the tour-ops CLIs in the cloud.
#
# Build from the REPO ROOT (context = whole workspace):
#   docker build -f packages/studio/Dockerfile -t skipper-studio .
#
# This is a Cloud Run *Job* (run-to-completion), NOT a service: no port, no server.
# ONE image serves all four CLIs — the per-execution override `args` pick the script:
#   gcloud run jobs execute skipper-studio --args="packages/studio/src/run.ts,<slug>,--dry-run"
#   ... patch-clip.ts | resynth-tour.ts | sweep-orphans.ts (see the spec §5 args contract).
#
# Shape mirrors apps/api/Dockerfile (verified pattern): bun has no `turbo prune` yet, so
# `bun install --filter` still pulls the whole RN tree. We TRIM the root `workspaces` to
# the generator's closure — generator + @skipper/{db,engine,shared,storage} (from its
# package.json) — so the Expo/React-Native tree is never resolved. `engine` is in the
# closure here (the api image doesn't need it). Internal packages export .ts source: no
# build step, bun runs the source directly.
#
# Secrets: .env.production is committed dotenvx-ENCRYPTED; the Job runtime injects
# DOTENV_PRIVATE_KEY_PRODUCTION from Secret Manager to decrypt at boot (see cloudbuild.studio.yaml
# + docs/specs/admin-ops-console-spec.md §10). TTS auth is ADC off the Job's runtime service
# account (no key file) — no GOOGLE_APPLICATION_CREDENTIALS needed.

FROM oven/bun:1
WORKDIR /app

# ffmpeg powers the TTS tail-collapse probe (pipeline/tail.ts) — without it the probe
# skips gracefully and cloud-generated takes would ship UNMEASURED (the mumble guard
# exists precisely for unattended runs like this Job).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

# dotenvx for deploy-time secret decryption (a ROOT devDependency, dropped by --production).
RUN bun add -g @dotenvx/dotenvx

# 1) Manifests only, then resolve deps with the workspace TRIMMED to the generator closure
#    so the RN tree is never resolved or installed. --production drops devDeps.
COPY package.json ./
COPY packages/studio/package.json packages/studio/
COPY packages/db/package.json packages/db/
COPY packages/engine/package.json packages/engine/
COPY packages/shared/package.json packages/shared/
COPY packages/storage/package.json packages/storage/
RUN bun -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.workspaces=['packages/studio','packages/db','packages/engine','packages/shared','packages/storage'];fs.writeFileSync('package.json',JSON.stringify(p,null,2))" \
 && bun install --production

# 2) The source the CLIs run (bun executes .ts directly — no dist build).
COPY packages/studio/src packages/studio/src
COPY packages/db/src packages/db/src
COPY packages/engine/src packages/engine/src
COPY packages/shared/src packages/shared/src
COPY packages/storage/src packages/storage/src
COPY .env.production ./

ENV NODE_ENV=production

# dotenvx decrypts .env.production (needs DOTENV_PRIVATE_KEY_PRODUCTION in the env), then
# runs `bun`. The per-execution Cloud Run `args` append the script + flags to this ENTRYPOINT,
# e.g. args=["packages/studio/src/run.ts","<slug>","--max-cost=3"].
ENTRYPOINT ["dotenvx", "run", "-f", ".env.production", "--", "bun"]
