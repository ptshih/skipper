// @ts-check
import { defineConfig } from 'astro/config'
import sitemap from '@astrojs/sitemap'

// The skipper.fm apex site — static (default output), deployed to Firebase Hosting.
// It does NOT serve an iOS universal-links AASA: the static
// public/.well-known/apple-app-site-association was removed with the /t/ share funnel
// (the associatedDomains entitlement is kept dormant). See
// docs/decisions/t-share-funnel-removed.md; reintroduce a fresh AASA here before the
// next entitlement'd build if deep links return.
export default defineConfig({
  site: 'https://skipper.fm',
  // v7 flipped the compressHTML default true→'jsx' (whitespace between adjacent inline
  // elements now collapses under JSX rules); pin `true` to preserve v6 rendering exactly.
  compressHTML: true,
  integrations: [sitemap()],
})
