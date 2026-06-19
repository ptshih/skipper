# Lean production image for @skipper/api (the Hono backend).
#
# Build from the REPO ROOT (the build context is the whole workspace):
#   docker build -f apps/api/Dockerfile -t skipper-api .
#   docker run -p 8787:8787 -e DOTENV_PRIVATE_KEY_PRODUCTION=<key> skipper-api
#
# WHY this shape (verified, not assumed — per CLAUDE.md "ground tooling decisions in
# docs/empirics"):
#   - `bun install --filter '@skipper/api'` does NOT prune: it still installs the
#     WHOLE workspace, including the Expo/React-Native tree that only apps/mobile
#     needs (verified: 1161 packages, react-native@0.85.3 + expo@56 present). bun
#     has no `turbo prune --docker` equivalent yet (oven-sh/bun#28600).
#   - So we TRIM the root `workspaces` to the api's closure (api + @skipper/db +
#     @skipper/shared + @skipper/storage + @skipper/drive-core) before installing. That installs
#     ~90 packages, zero react-native/expo (verified). The api imports @skipper/db, @skipper/shared,
#     @skipper/storage + @skipper/drive-core (zero-dep); R2 uses Bun's built-in S3Client (no @aws-sdk). Internal packages export .ts
#     source, so there is NO build step — bun runs the source directly.
#
# Secrets: .env.production is committed dotenvx-ENCRYPTED. The host MUST inject
# DOTENV_PRIVATE_KEY_PRODUCTION (a real secret, never baked into the image) so
# dotenvx decrypts it at boot (see CLAUDE.md "Secrets via dotenvx").
#
# Reproducibility: no bun.lock is copied — the trimmed set resolves fresh within the
# declared semver ranges (minor drift possible). To pin exact versions, generate a
# pruned lock once (trim workspaces, `bun install`, commit the resulting lock) and
# COPY it before install.
#
# Leanest alternative (single self-contained binary, no node_modules):
#   bun build ./apps/api/src/index.ts --compile --target=bun-linux-x64 --minify --outfile server
# Tradeoff: the compiled binary's dotenv autoload can't decrypt the dotenvx-encrypted
# file, so you'd still launch it via dotenvx (or have the host inject decrypted env).

FROM oven/bun:1
WORKDIR /app

# dotenvx for deploy-time secret decryption (it's a ROOT devDependency, so a
# --production install drops it — install it on its own).
RUN bun add -g @dotenvx/dotenvx

# 1) Manifests only, then resolve deps with the workspace TRIMMED to the api closure
#    so the RN tree is never resolved or installed. --production drops devDeps.
COPY package.json ./
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/storage/package.json packages/storage/
COPY packages/drive-core/package.json packages/drive-core/
RUN bun -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.workspaces=['apps/api','packages/db','packages/shared','packages/storage','packages/drive-core'];fs.writeFileSync('package.json',JSON.stringify(p,null,2))" \
 && bun install --production

# 2) The source the API actually runs (bun executes .ts directly — no dist build).
COPY apps/api/src apps/api/src
COPY packages/db/src packages/db/src
COPY packages/db/seed packages/db/seed
COPY packages/shared/src packages/shared/src
COPY packages/storage/src packages/storage/src
COPY packages/drive-core/src packages/drive-core/src
COPY .env.production ./

ENV NODE_ENV=production
# src/index.ts defaults to PORT 8787; override with -e PORT=...
EXPOSE 8787

# dotenvx decrypts .env.production (needs DOTENV_PRIVATE_KEY_PRODUCTION in the env),
# then runs the bun-native server (apps/api/src/index.ts exports { port, fetch }).
ENTRYPOINT ["dotenvx", "run", "-f", ".env.production", "--", "bun", "run", "apps/api/src/index.ts"]
