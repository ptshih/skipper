# Lean production image for @skipper/api (the Hono backend).
#
# Build from the REPO ROOT (the build context is the whole workspace):
#   docker build -f apps/api/Dockerfile -t skipper-api .
#   docker run -p 8787:8787 -e DOTENV_PRIVATE_KEY_PRODUCTION=<key> skipper-api
#
# WHY this shape (verified, not assumed — per CLAUDE.md "ground tooling decisions in
# docs/empirics"):
#   - `bun install --filter '@skipper/api'` does NOT prune: it still installs the WHOLE
#     workspace, including the Expo/React-Native tree that only apps/mobile needs. bun has
#     no `turbo prune --docker` equivalent yet (oven-sh/bun#28600).
#   - So we TRIM the root `workspaces` to the api's closure (the COPY/workspaces lists below)
#     before installing — that drops the entire react-native/expo tree. R2 uses Bun's built-in
#     S3Client (no @aws-sdk). Internal packages export .ts source, so there is NO build step —
#     bun runs the source directly.
#
# Secrets: .env.production is committed dotenvx-ENCRYPTED. The host MUST inject
# DOTENV_PRIVATE_KEY_PRODUCTION (a real secret, never baked into the image) so
# dotenvx decrypts it at boot (see CLAUDE.md "Secrets via dotenvx").
#
# Reproducibility: no bun.lock is copied — the trimmed set resolves fresh within the
# declared semver ranges (minor drift possible).
# ⚠ DO NOT "fix" this by adding `COPY bun.lock` — TESTED 2026-07-30 and it BREAKS THE BUILD.
# `bun install --production` implies `--frozen-lockfile` (verified: it fails with CI unset and
# BUN_CONFIG_FROZEN_LOCKFILE unset, so it is the flag itself, not the environment), and step 1
# below REWRITES package.json to trim `workspaces` — which is exactly the kind of change a frozen
# lockfile refuses:  `error: lockfile had changes, but lockfile is frozen`.
# `--no-frozen-lockfile` did not clear it either. A repo-wide audit flagged the missing lockfile as
# a supply-chain gap and prescribed `COPY bun.lock`; that prescription would have taken production
# deploys down, which is why the evidence is recorded here rather than the suggestion re-tried.
# The CORRECT fix, if exact pinning is wanted, is still a PRUNED lock: trim workspaces, `bun
# install`, commit the resulting lock as its own file, COPY that. It buys reproducibility at the
# cost of a second lockfile that must be regenerated whenever a dependency moves — so it is a
# deliberate trade, not a one-liner. The ENTRYPOINT's dotenvx is pinned exactly regardless (below),
# which is where the sharp end of this risk actually was.
#
# Leanest alternative (single self-contained binary, no node_modules):
#   bun build ./apps/api/src/index.ts --compile --target=bun-linux-x64 --minify --outfile server
# Tradeoff: the compiled binary's dotenv autoload can't decrypt the dotenvx-encrypted
# file, so you'd still launch it via dotenvx (or have the host inject decrypted env).

FROM oven/bun:1
WORKDIR /app

# dotenvx for deploy-time secret decryption (it's a ROOT devDependency, so a
# --production install drops it — install it on its own).
# ⚠ PINNED EXACTLY, and this is the one pin in the image that most deserves it: dotenvx is the
# ENTRYPOINT and it handles the decrypted secrets, so an unpinned `bun add -g` would pull whatever
# the registry served that minute straight into the process that holds the keys. Keep this in step
# with the root devDependency (`^2.14.0`) — a `bun update` that moves one should move both.
RUN bun add -g @dotenvx/dotenvx@2.14.0

# 1) Manifests only, then resolve deps with the workspace TRIMMED to the api closure
#    so the RN tree is never resolved or installed. --production drops devDeps.
COPY package.json ./
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/storage/package.json packages/storage/
COPY packages/engine/package.json packages/engine/
COPY packages/routing/package.json packages/routing/
RUN bun -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.workspaces=['apps/api','packages/db','packages/shared','packages/storage','packages/engine','packages/routing'];fs.writeFileSync('package.json',JSON.stringify(p,null,2))" \
 && bun install --production

# 2) The source the API actually runs (bun executes .ts directly — no dist build).
COPY apps/api/src apps/api/src
COPY packages/db/src packages/db/src
COPY packages/shared/src packages/shared/src
COPY packages/storage/src packages/storage/src
COPY packages/engine/src packages/engine/src
COPY packages/routing/src packages/routing/src
COPY .env.production ./

ENV NODE_ENV=production
# src/index.ts defaults to PORT 8787; override with -e PORT=...
EXPOSE 8787

# dotenvx decrypts .env.production (needs DOTENV_PRIVATE_KEY_PRODUCTION in the env),
# then runs the bun-native server (apps/api/src/index.ts exports { port, fetch }).
ENTRYPOINT ["dotenvx", "run", "-f", ".env.production", "--", "bun", "run", "apps/api/src/index.ts"]
