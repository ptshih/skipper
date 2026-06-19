// R2 access for the admin console — short-lived presigned GET URLs for the ear-pass.
//
// Same one-door pattern as apps/api/src/storage.ts: the R2 client, presign, and key→MIME helper
// live in @skipper/storage (the single R2 door, shared with the generator) — re-exported here.
// The admin presigns ANY roam clip with NO tier gate (it's founder-only behind IAP) — unlike
// the public API, where presign sits behind the freemium check.
export { presignGet, contentTypeForKey } from '@skipper/storage'
