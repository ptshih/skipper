# /t/ share funnel removed (universal-link capability kept dormant)

**Status:** ✅ **DECIDED + DONE 2026-06-19.** The `/t/<id>` share funnel is removed; the iOS
universal-link *capability* (the `associatedDomains` entitlement) is retained, dormant.

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

## Kept (the dormant capability)

- `apps/mobile/app.json` → `associatedDomains: ["applinks:skipper.fm"]` — the entitlement /
  provisioning (the finicky Apple-side setup: App ID + Team ID `L24UJYJ5DK.fm.skipper.app`). With no
  AASA served, iOS establishes no association at install — harmless. Keeping it avoids re-walking the
  universal-link setup (a notorious silent-failure minefield) when links return.

## Reintroducing later

When a real V2 share story exists (shareable drives, or a marketing deep link), serve a fresh AASA on
skipper.fm claiming the chosen path **+** add the target route on whatever host serves that path. The
AASA MUST be live on the domain BEFORE the entitlement'd build is installed (iOS fetches it at install
time; Apple's CDN caches it ~24h).
