// @skipper/storage — the SINGLE R2 (S3-compatible) access point: one S3Client builder + one
// presign helper, shared by the API (presigned GET after the freemium tier check) and the
// generator (upload + presign during a run). Audio objects are PRIVATE in R2; callers store
// the object KEY and presign on demand, so a leaked/shared URL expires and the account wall
// is real. Uses Bun's native S3Client (no @aws-sdk); set S3_ENDPOINT to retarget any other
// S3-compatible provider (Tigris, B2, AWS S3) with no rewrite.

import { S3Client } from 'bun'

/** Default presign TTL — 1 hour, enough to download a whole tour offline. */
export const DEFAULT_TTL_SECONDS = 60 * 60

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set (R2 access).`)
  return v
}

let client: S3Client | undefined

/** The shared, lazily-built R2 client (one per process). */
export function getR2Client(): S3Client {
  if (!client) {
    client = new S3Client({
      accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
      bucket: requireEnv('R2_BUCKET'),
      // R2 by default; the `||` short-circuits, so R2_ACCOUNT_ID is only required when no
      // S3_ENDPOINT override is set.
      endpoint: process.env.S3_ENDPOINT || `https://${requireEnv('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
      region: process.env.S3_REGION || 'auto', // R2/Tigris use "auto"; AWS needs a real region
    })
  }
  return client
}

/** A short-lived presigned GET URL for a private R2 object KEY. */
export function presignGet(key: string, expiresInSeconds: number = DEFAULT_TTL_SECONDS): string {
  return getR2Client().file(key).presign({ method: 'GET', expiresIn: expiresInSeconds })
}
