/** The live App Store listing URL — set 2026-08-20, the day 1.1.0 went READY_FOR_SALE.
 *
 *  ONE home on purpose. Two places need it — the download badge
 *  (`components/sections/FinalCta.astro`) and the `MobileApplication` JSON-LD
 *  (`layouts/Base.astro`) — plus every "coming soon" line the 2026-08-20 sweep made
 *  conditional on this constant. The go-live checklist in
 *  `docs/guides/app-store-submission.md` §13 is a place where "update both" reliably
 *  becomes "update one"; importing a single constant makes that impossible.
 *
 *  This is the CANONICAL US slug URL (what Apple's own "Copy link" hands out — direct
 *  200, no redirect hop). The bare id form `apps.apple.com/app/id6778946770` 301s here
 *  and always will; if the app is ever RENAMED the slug moves, so re-resolve the id
 *  form and update this to the new canonical then.
 */
export const APP_STORE_URL = 'https://apps.apple.com/us/app/skipper-road-trip-audio-tours/id6778946770'
