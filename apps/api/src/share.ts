// Shareable-tour link surface for skipper.fm/t/<tourId> universal links — the couch-preview
// share funnel's public face. Two server jobs (the iOS app + Expo Router do the rest):
//   1. APPLE_APP_SITE_ASSOCIATION — the canonical AASA payload (iOS claims /t/* for the app).
//      NO LONGER served by this API (api.skipper.fm isn't an associated domain): the apex site
//      (apps/site) serves it as a STATIC file at public/.well-known/apple-app-site-association.
//      Keep that file in sync with this constant — the test below validates the shape.
//   2. shareLandingHtml — the human/crawler fallback page for the /t/<id> URL when the app
//      isn't there to intercept (Android, desktop, iMessage/social link unfurlers).
//
// AASA serving rules the route MUST honor (see src/index.ts) — verified against Apple's
// "Supporting associated domains" docs: Content-Type application/json, HTTP 200, NO redirect,
// NO auth, served at exactly /.well-known/apple-app-site-association with NO file extension,
// over HTTPS, < 128 KB. Use the MODERN applinks.details[].appIDs + components form — the
// legacy appID + paths form is IGNORED on iOS 13+ when components is present, so never mix
// them. (Apple's CDN caches the file ~24h; on a dev build append ?mode=developer to fetch the
// origin directly.) Refs: developer.apple.com/documentation/xcode/supporting-associated-domains.

// <Apple Team ID>.<bundle identifier>. Skipper ships under the **Manoa, Inc.** Apple Developer
// team (L24UJYJ5DK) — NOT the founder's personal team (AYA5T52A22) whose dev cert happens to be
// in the local keychain. The App ID fm.skipper.app must be registered under Manoa, Inc. and this
// appID MUST carry the company team prefix, or iOS silently refuses the universal-link claim (a
// wrong Team ID is the most common silent failure). Bundle id from apps/mobile/app.json.
export const IOS_APP_ID = 'L24UJYJ5DK.fm.skipper.app'

export const APPLE_APP_SITE_ASSOCIATION = {
  applinks: {
    details: [
      {
        appIDs: [IOS_APP_ID],
        // `*` is greedy and crosses '/', so /t/* claims every /t/... path — that's exactly the
        // tour-link space today. Add an `exclude` component before this one if other /t/ URLs
        // ever appear. AASA can't express a UUID grammar; the id is validated in-app + by the
        // /t/:id route, not here.
        components: [{ '/': '/t/*', comment: 'Shareable Skipper tour links open in the app.' }],
      },
    ],
  },
} as const

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}
const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (ch) => HTML_ESCAPE[ch]!)

/**
 * Branded Open-Graph landing for a shared tour link when no app intercepts it. The OG/Twitter
 * tags make skipper.fm/t/<id> unfurl with the tour's name in iMessage/social — the funnel's
 * first impression. Brand hexes are inlined (this is standalone server HTML, NOT the mobile
 * design-system surface that lint:tokens governs): #14201B dusk / #F2E7CC paper, from the
 * app.json splash palette. No og:image yet — add a share card when one exists.
 */
export function shareLandingHtml(opts: { title: string; description: string; url: string }): string {
  const title = escapeHtml(opts.title)
  const description = escapeHtml(opts.description)
  const url = escapeHtml(opts.url)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Skipper</title>
<meta name="description" content="${description}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Skipper">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${url}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; box-sizing:border-box; display:flex; align-items:center;
         justify-content:center; padding:24px; text-align:center; background:#14201B;
         color:#F2E7CC; font-family:-apple-system,system-ui,Segoe UI,Roboto,sans-serif; }
  main { max-width:32rem; }
  .kicker { margin:0 0 .75rem; font-size:.8rem; letter-spacing:.14em; text-transform:uppercase; opacity:.65; }
  h1 { margin:0 0 1rem; font-size:1.9rem; line-height:1.15; }
  p.lede { margin:0 0 1.5rem; font-size:1.05rem; line-height:1.5; opacity:.85; }
  p.note { margin:0; font-size:.9rem; line-height:1.5; opacity:.6; }
</style>
</head>
<body>
<main>
  <p class="kicker">Skipper · road-trip tours</p>
  <h1>${title}</h1>
  <p class="lede">${description}</p>
  <p class="note">Open this link on an iPhone with the Skipper app to start the drive. App Store launch coming soon.</p>
</main>
</body>
</html>`
}
