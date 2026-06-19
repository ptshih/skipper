// R2 access for the API — issues short-lived PRESIGNED GET URLs for gated audio.
//
// Audio objects are PRIVATE in R2; narrations.audioUrl (and asides.audioUrl) store the
// object KEY. The API presigns on demand AFTER the tier check, so a leaked/shared URL expires
// and the account wall is real. The R2 client, presign, and key→MIME helper all live in
// @skipper/storage (the single R2 door, shared with admin + the generator) — re-exported here
// so route handlers keep importing from './storage'.
export { presignGet, contentTypeForKey } from '@skipper/storage'
