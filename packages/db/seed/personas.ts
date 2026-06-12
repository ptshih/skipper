// Bootstrap rows for `personas` — the first-class host entity (decoupled from region).
//
// IDENTITY in the table, RECIPE in code: this seeds the minimal FK target (persona_key + name
// + the server-only voice_id) so `segments.persona_id` has something to point at. The display
// identity the client sees (tagline/backstory/portrait/voice-sample) is still served by
// apps/api `host.ts` (region-keyed) in v1, and the GENERATION recipe (system prompt, kit, TTS
// style) lives in @skipper/generator's PersonaDef — bridged to this row by `persona_key`.
//
// `voice_id` mirrors the generator's SKIPPER_VOICE_ID ('Charon' in packages/generator/models.ts);
// kept as a literal here so @skipper/db carries no dependency on the generator. Keep them in step.
//
// Usage (DATABASE_URL injected via dotenvx):
//   dotenvx run -f .env.development -- bun packages/db/seed/personas.ts

import { sql } from 'drizzle-orm'
import { db } from '../src/client'
import { personas, type NewPersona } from '../src/schema'

export const PERSONA_SEED: NewPersona[] = [
  {
    personaKey: 'skipper',
    name: 'Skipper',
    voiceId: 'Charon',
  },
]

/** Idempotent upsert on persona_key — refresh identity, mint on first run. */
export async function seedPersonas(): Promise<void> {
  for (const row of PERSONA_SEED) {
    await db
      .insert(personas)
      .values(row)
      .onConflictDoUpdate({
        target: personas.personaKey,
        set: { name: row.name, voiceId: row.voiceId, updatedAt: sql`now()` },
      })
  }
  const n = await db.select({ count: sql<number>`count(*)::int` }).from(personas)
  console.log(`✓ personas seeded — ${n[0]?.count ?? 0} rows in DB`)
}

// Runnable directly (the seed.ts main also calls seedPersonas).
if (import.meta.main) {
  await seedPersonas()
}
