ALTER TABLE "pois" ADD COLUMN "fact_sheet" jsonb;--> statement-breakpoint
ALTER TABLE "pois" ADD COLUMN "enriched_at" timestamp with time zone;--> statement-breakpoint
-- Backfill the curated sheet OUT of the facts bag into its own typed columns. COPY-ONLY: facts.well /
-- facts.enrichedAt are NOT stripped here, so this migration is fully reversible (a later cleanup drops
-- them once we've confirmed everything reads from the columns). Touches only the enriched rows.
UPDATE "pois" SET
  "fact_sheet" = "facts" -> 'well',
  "enriched_at" = ("facts" ->> 'enrichedAt')::timestamptz
WHERE jsonb_typeof("facts" -> 'well') = 'array' AND jsonb_array_length("facts" -> 'well') > 0;