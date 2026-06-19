// Bootstrap rows for `personas` — the first-class host entity (decoupled from region).
//
// IDENTITY in the table, RECIPE in code: this seeds the host registry (persona_key + name + the
// server-only voice_id). In v2 it is UN-CONSUMED scaffolding — the old `segments.persona_id` FK was
// dropped, so nothing reads it yet (one host, resolved in code; playback shows a fixed 'Skipper').
// The GENERATION recipe (system prompt, kit, TTS style) lives in @skipper/generator's PersonaDef —
// bridged to this row by `persona_key` when region-skippers (M4) wire it back in.
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
