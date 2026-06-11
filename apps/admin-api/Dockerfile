# Cloud Run SERVICE image for the admin console — the Hono admin-api + the built SPA, one
# container behind Google IAP (spec §6/§7). Build from the REPO ROOT:
#   docker build -f apps/admin-api/Dockerfile -t skipper-admin .
#
# Two stages: (1) build the Vite SPA, (2) the bun Hono server that serves /admin/* AND the
# built dist (same-origin, so the IAP cookie/headers flow). Mirrors apps/api/Dockerfile's
# workspace-trim pattern (bun has no `turbo prune`, so trim the root `workspaces` to the
# closure to skip the RN tree).

# ---- stage 1: build the SPA ----
FROM oven/bun:1 AS web
WORKDIR /app
COPY package.json ./
COPY apps/admin-web/package.json apps/admin-web/
RUN bun -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.workspaces=['apps/admin-web'];fs.writeFileSync('package.json',JSON.stringify(p,null,2))" \
 && bun install
COPY apps/admin-web apps/admin-web
# The browser Maps JS key is a BUILD-TIME public var (Vite inlines VITE_* into the bundle; it
# is referrer-restricted, not a secret). Passed via cloudbuild --build-arg.
ARG VITE_GOOGLE_MAPS_BROWSER_KEY=""
ENV VITE_GOOGLE_MAPS_BROWSER_KEY=$VITE_GOOGLE_MAPS_BROWSER_KEY
RUN cd apps/admin-web && bun run build

# ---- stage 2: the Hono server ----
FROM oven/bun:1
WORKDIR /app

RUN bun add -g @dotenvx/dotenvx

# Trim the workspace to the admin server's closure: admin + @skipper/{db,shared,storage}.
# (NOT generator — the admin TRIGGERS the Job, it doesn't run generation. @anthropic-ai/sdk +
# google-auth-library are admin's own deps and install with it.)
COPY package.json ./
COPY apps/admin-api/package.json apps/admin-api/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/storage/package.json packages/storage/
RUN bun -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.workspaces=['apps/admin','packages/db','packages/shared','packages/storage'];fs.writeFileSync('package.json',JSON.stringify(p,null,2))" \
 && bun install --production

COPY apps/admin-api/src apps/admin-api/src
COPY packages/db/src packages/db/src
# seed/ carries materialize.ts + tour-specs.ts (Create Tour calls materializeRoute).
COPY packages/db/seed packages/db/seed
COPY packages/shared/src packages/shared/src
COPY packages/storage/src packages/storage/src
COPY .env.production ./
# the built SPA, served by the Hono server at ADMIN_WEB_ROOT.
COPY --from=web /app/apps/admin-web/dist ./public

ENV NODE_ENV=production
ENV ADMIN_WEB_ROOT=./public
# src/index.ts defaults to PORT 8788; Cloud Run injects PORT.
EXPOSE 8788

# dotenvx decrypts .env.production (needs DOTENV_PRIVATE_KEY_PRODUCTION); ADMIN_EMAIL,
# GOOGLE_CLOUD_PROJECT, ANTHROPIC_API_KEY, GOOGLE_MAPS_API_KEY, R2_* ride in it.
ENTRYPOINT ["dotenvx", "run", "-f", ".env.production", "--", "bun", "run", "apps/admin-api/src/index.ts"]
