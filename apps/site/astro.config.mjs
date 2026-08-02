// @ts-check
import { defineConfig } from 'astro/config'
import sitemap from '@astrojs/sitemap'

// The skipper.fm apex site — static (default output), deployed to Firebase Hosting.
//
// ⚠⚠ THE SITE DOES SERVE AN AASA, AND IT IS LOAD-BEARING. This comment said the opposite until
// 2026-08-02 ("does NOT serve an iOS universal-links AASA … removed with the /t/ share funnel, the
// associatedDomains entitlement is kept dormant"). That was true for one week: c78a3df
// ("fix(ios): serve a real AASA — webcredentials, not the vestigial applinks") put
// public/.well-known/apple-app-site-association back on 2026-07-28 and flipped
// apps/mobile/app.json to `associatedDomains: ["webcredentials:skipper.fm"]` in the same commit.
// The entitlement is LIVE, not dormant, and it needs this exact file served as application/json.
//
// So: do NOT delete public/.well-known/apple-app-site-association, and do NOT remove the
// Content-Type `headers` rule for it in firebase.json. Either one silently kills iOS Password
// AutoFill for the app's sign-in screen — which is the whole loop c78a3df closed, since the rider
// sets their new password in a browser here (/reset-password) and the app has to be able to offer
// it back. Nothing in `bun run check` or the site build would notice; it only shows up on a device.
// The file carries `webcredentials` ONLY — no `applinks` key, deliberately: the /t/ share funnel is
// gone (docs/decisions/t-share-funnel-removed.md).
export default defineConfig({
  site: 'https://skipper.fm',
  // v7 flipped the compressHTML default true→'jsx' (whitespace between adjacent inline
  // elements now collapses under JSX rules); pin `true` to preserve v6 rendering exactly.
  compressHTML: true,
  integrations: [
    sitemap({
      // @astrojs/sitemap only drops 404/500 on its own (its STATUS_CODE_PAGES set), so a page that
      // ships `noindex` still gets submitted unless it is filtered here. Google files that as
      // "Submitted URL marked 'noindex'" — an Error, not a warning — and it publishes the shape of
      // the token-bearing reset endpoint in a machine-readable file.
      // ⚠ Keep this in step with every `noindex={true}` page.
      filter: (page) => !page.includes('/reset-password'),
    }),
  ],
})
