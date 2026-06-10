// @ts-check
import { defineConfig } from 'astro/config'
import sitemap from '@astrojs/sitemap'

// The skipper.fm apex site — static (default output), deployed to Firebase Hosting.
// It also serves the iOS universal-links AASA as a STATIC file from
// public/.well-known/apple-app-site-association. The API (api.skipper.fm) no longer
// serves the AASA — api.skipper.fm is not an associated domain, so the file lives only
// here (single source of truth). See docs/guides/gcp-cloud-run-deploy.md for the split.
export default defineConfig({
  site: 'https://skipper.fm',
  integrations: [sitemap()],
})
