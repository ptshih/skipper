// @skipper/generator — server-side narration generation for the V2 roam-first model.
//
// pois (shared FACTS) ──1:1── narrations (the shared telling) is the spine: the corpus
// pipeline is `discover` → `enrich` → `generate`, and roam + every drive SELECT from that
// one shared corpus. The DEFERRED hand-authored tour pipeline (run.ts and its segments/tracks/
// tour_frames tables, dropped in migration 0009) was removed in the V1→V2 migration; only the
// roam/corpus generators + their pipeline helpers remain. CLI entry points: generate-narrations.ts,
// enrich-pois.ts, discover-pois.ts.
//
// Invariant: a narration goes live only once its audio is synthesized (audio_url NOT NULL).
// Persona lives in DELIVERY (the telling), never in FACTS — "make it funny" never loosens
// accuracy; a place with no curated fact sheet is never narrated from the raw extract.
export * from './models'
