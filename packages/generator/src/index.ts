// @skipper/generator — server-side tour generation. Runs entirely before the
// app downloads anything.
//
// M1 (walking skeleton) implements, for ONE seeded tour shell (loaded by slug) /
// duration / persona / dadpocalypse:
//   tour polyline (from the seeded shell)
//     -> Wikidata SPARQL spine                  (the POI discovery spine)
//     -> Wikipedia extracts                     (per-candidate PROSE enrichment)
//     -> Google Places searchAlongRoute         (food/rest break stops)
//     -> select stops to fit duration           (pace by drive TIME, not distance)
//     -> skipper narration (Anthropic)          (facts-only prompt; never invent)
//     -> TTS (Google Cloud, Gemini-TTS) -> Cloudflare R2
//     -> write tours + ordered segments/tracks (Neon/Drizzle; a stop = 1 segment + 1 track)
//
// Invariant: a tour may not be marked `ready` until every story/scenic stop has
// non-null audio. NO cache variants, NO dedup, NO feedback in M1 — generate naively.
// CLI entry point: ./run.ts.
export * from './models'
export { generateTour } from './pipeline/generate-tour'
export type {
  FrameSummary,
  GenerateOptions,
  GenerateResult,
  StopSummary,
} from './pipeline/generate-tour'
