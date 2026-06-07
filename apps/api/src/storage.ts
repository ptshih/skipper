// R2 access for the API — issues short-lived PRESIGNED GET URLs for gated audio.
//
// Audio objects are PRIVATE in R2; poi_content.audioUrl stores the object KEY.
// The API presigns on demand AFTER the tier check, so a leaked/shared URL expires
// and the account wall is real. (Client config mirrors @skipper/generator's
// storage.ts — ~10 stable lines; extract a shared @skipper/storage package if a
// third consumer appears.)

import { S3Client } from 'bun'

const DEFAULT_TTL_SECONDS = 60 * 60 // 1 hour — enough to download a tour offline

let client: S3Client | undefined

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set (R2 presign).`)
  return v
}

function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
      bucket: requireEnv('R2_BUCKET'),
      // R2 by default; set S3_ENDPOINT to point this same S3 code at any other
      // S3-compatible provider (Tigris, B2, AWS S3) with no rewrite. The `||`
      // short-circuits, so R2_ACCOUNT_ID is only required when no override is set.
      endpoint: process.env.S3_ENDPOINT || `https://${requireEnv('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
      region: process.env.S3_REGION || 'auto', // R2/Tigris use "auto"; AWS needs a real region
    })
  }
  return client
}

/** Presigned GET URL for a private R2 audio key. */
export function presignGet(key: string, expiresInSeconds: number = DEFAULT_TTL_SECONDS): string {
  return getClient().file(key).presign({ method: 'GET', expiresIn: expiresInSeconds })
}
