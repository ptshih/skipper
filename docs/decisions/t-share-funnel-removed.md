# /t/ share funnel removed (universal-link capability kept dormant)

**Status:** ✅ **DECIDED + DONE 2026-06-19.** The `/t/<id>` share funnel is removed.
**⚠ AMENDED 2026-07-28 (`c78a3df`), recorded here 2026-08-02:** the entitlement is **no longer
dormant and the AASA is BACK** — for a different job. `apps/mobile/app.json` now declares
`associatedDomains: ["webcredentials:skipper.fm"]` (NOT `applinks:`), and
`apps/site/public/.well-known/apple-app-site-association` is served again carrying a
`webcredentials` key only. That association is what lets iOS Password AutoFill offer the app the
password a rider just set in a browser on `/reset-password`. **Deleting that file, or the
`application/json` Content-Type rule for it in `apps/site/firebase.json`, silently breaks
sign-in AutoFill on device — no test and no build will catch it.** The "Removed" list below is
therefore historically accurate but no longer describes the tree; `applinks` remains gone.

## Why

`/t/<id>` was V1's shareable-**tour** link (the "couch-preview" share funnel). V2 dropped authored
tours, and drives are user-OWNED + account-gated — there is no anonymous-shareable artifact, so a
`/t/` link had no real V2 job. It was also half-built: `apps/site` (skipper.fm) served the AASA file
but had NO `/t/` page, and the web OG fallback (`shareLandingHtml`) lived on `api.skipper.fm`, which
the real share URL (`skipper.fm/t/…`) never reaches. Dead-ish weight carrying V1 framing.

## Removed

- **mobile:** the drive Share button + handler (`app/drives/[id]/index.tsx`), the `app/t/[id].tsx`
  redirect screen, the stale `_layout` deep-link comment.
- **api:** the `GET /t/:id` route + `shareLandingHtml`; the whole `apps/api/src/share.ts` +
  `apps/api/test/share.test.ts`.
- **site:** the static `apps/site/public/.well-known/apple-app-site-association` (the AASA file).
  ⚠ **Restored 2026-07-28 (`c78a3df`)** in a different form — `webcredentials` only, no `applinks`.
  See the amendment in the Status line above; do not read this bullet as current.

## Kept (the dormant capability)

- `apps/mobile/app.json` → `associatedDomains` — the entitlement / provisioning (the finicky
  Apple-side setup: App ID + Team ID `L24UJYJ5DK.fm.skipper.app`). Kept because re-walking the
  universal-link setup (a notorious silent-failure minefield) is the expensive part.
  ⚠ **It reads `["webcredentials:skipper.fm"]` since `c78a3df`, not `["applinks:skipper.fm"]`, and
  it is no longer dormant** — the entitlement is live and doing a real job (Password AutoFill against
  the web password reset). `applinks` is the half that stays gone until a share story exists.

## Reintroducing later

When a real V2 share story exists (shareable drives, or a marketing deep link), serve a fresh AASA on
skipper.fm claiming the chosen path **+** add the target route on whatever host serves that path. The
AASA MUST be live on the domain BEFORE the entitlement'd build is installed (iOS fetches it at install
time; Apple's CDN caches it ~24h).
