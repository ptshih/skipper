/** The live App Store listing URL, or '' until Apple approves the release.
 *
 *  ONE home on purpose. Two places need it — the download CTA
 *  (`components/sections/FinalCta.astro`) and the `MobileApplication` JSON-LD
 *  (`layouts/Base.astro`) — and the go-live checklist in
 *  `docs/guides/app-store-submission.md` §13 is a place where "update both" reliably
 *  becomes "update one". Importing a single constant makes that impossible.
 *
 *  ⚠ Stays EMPTY until the release is actually approved. The id `6778946770` has been
 *  real since the ASC record was created, but `apps.apple.com/app/id6778946770`
 *  **404s until release** (verified 2026-07-27). Setting it early doesn't ship the
 *  button early — it ships a dead link and points structured data at a missing page,
 *  which is worse than the honest "coming soon" state both consumers fall back to.
 */
export const APP_STORE_URL = '' // go-live: 'https://apps.apple.com/app/id6778946770'
