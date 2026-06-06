// @skipper/generator — server-side tour generation. Runs entirely before the
// app downloads anything.
//
// M1 (walking skeleton) implements, for ONE hardcoded corridor / duration /
// persona / dadpocalypse:
//   corridor polyline
//     -> Wikipedia geosearch + extracts        (grounded story facts)
//     -> Google Places searchAlongRoute        (food/rest break stops)
//     -> select stops to fit duration           (pace by drive TIME, not distance)
//     -> skipper narration (Anthropic)          (facts-only prompt; never invent)
//     -> TTS (OpenAI) -> Cloudflare R2
//     -> write tours + ordered tour_stops (Neon/Drizzle)
//
// Invariant: a tour may not be marked `ready` until every story/scenic stop has
// non-null audio. NO cache variants, NO dedup, NO feedback in M1 — generate naively.
export * from './models'
