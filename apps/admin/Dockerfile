# Cloud Run SERVICE image for the admin console — ONE app (apps/admin): the Hono server
# (server/) + the built Vite SPA (client/), one container behind Google IAP.
# Build from the REPO ROOT:
#   docker build -f apps/admin/Dockerfile -t skipper-admin .
#
# Two stages: (1) build the client SPA, (2) the bun Hono server that serves /admin/* AND the
# built dist (same-origin, so the IAP cookie/headers flow). Mirrors apps/api/Dockerfile's
# workspace-trim. The SPA build deps (vite/react/tailwind) are devDependencies, so stage 2's
# --production install drops them → lean server image.

# ---- stage 1: build the client SPA ----
FROM oven/bun:1 AS web
WORKDIR /app
COPY package.json ./
COPY apps/admin/package.json apps/admin/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/storage/package.json packages/storage/
COPY packages/engine/package.json packages/engine/
COPY packages/sim/package.json packages/sim/
RUN bun -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.workspaces=['apps/admin','packages/db','packages/shared','packages/storage','packages/engine','packages/sim'];fs.writeFileSync('package.json',JSON.stringify(p,null,2))" \
 && bun install
COPY apps/admin apps/admin
# Workspace value imports must resolve to source during the isolated SPA build.
# Engine supplies region geometry; shared supplies the same hard-review gate as the server.
# Local builds have the whole repo, so the client-workspace-imports test guards missing COPYs.
COPY packages/engine/src packages/engine/src
COPY packages/shared/src packages/shared/src
# The browser Maps JS key is a BUILD-TIME public var (Vite inlines VITE_* into the bundle; it
# is referrer-restricted, not a secret). Passed via cloudbuild --build-arg.
ARG VITE_GOOGLE_MAPS_BROWSER_KEY=""
ENV VITE_GOOGLE_MAPS_BROWSER_KEY=$VITE_GOOGLE_MAPS_BROWSER_KEY
# AdvancedMarkers need a cloud Map ID; optional — google-map.tsx falls back to DEMO_MAP_ID (watermarked).
ARG VITE_GOOGLE_MAPS_MAP_ID=""
ENV VITE_GOOGLE_MAPS_MAP_ID=$VITE_GOOGLE_MAPS_MAP_ID
RUN cd apps/admin && bun run build

# ---- stage 2: the Hono server ----
FROM oven/bun:1
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
RUN bun add -g @dotenvx/dotenvx

# Trim the workspace to the server's closure: admin + @skipper/{db,shared,storage,engine}. --production
# drops the SPA build deps (vite/react/tailwind, all devDependencies) → no RN/React tree at runtime.
COPY package.json ./
COPY apps/admin/package.json apps/admin/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/storage/package.json packages/storage/
COPY packages/engine/package.json packages/engine/
COPY packages/sim/package.json packages/sim/
RUN bun -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.workspaces=['apps/admin','packages/db','packages/shared','packages/storage','packages/engine','packages/sim'];fs.writeFileSync('package.json',JSON.stringify(p,null,2))" \
 && bun install --production

# The source the server runs (bun executes .ts directly — no dist build).
COPY apps/admin/server apps/admin/server
COPY packages/db/src packages/db/src
COPY packages/shared/src packages/shared/src
COPY packages/storage/src packages/storage/src
COPY packages/engine/src packages/engine/src
COPY packages/sim/src packages/sim/src
COPY .env.production ./
# the built SPA, served by the Hono server at ADMIN_WEB_ROOT.
COPY --from=web /app/apps/admin/client/dist ./public

ENV NODE_ENV=production
ENV ADMIN_WEB_ROOT=./public
# server/index.ts defaults to PORT 8788; Cloud Run injects PORT.
EXPOSE 8788

# dotenvx decrypts .env.production (needs DOTENV_PRIVATE_KEY_PRODUCTION); ADMIN_EMAIL,
# GOOGLE_CLOUD_PROJECT, ANTHROPIC_API_KEY, GOOGLE_MAPS_API_KEY, R2_* ride in it.
ENTRYPOINT ["dotenvx", "run", "-f", ".env.production", "--", "bun", "run", "apps/admin/server/index.ts"]
