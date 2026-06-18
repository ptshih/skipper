CREATE TABLE "drive_demand" (
	"route_sig" text PRIMARY KEY NOT NULL,
	"region_id" uuid,
	"hits" integer DEFAULT 0 NOT NULL,
	"distinct_users" integer DEFAULT 0 NOT NULL,
	"last_hit_at" timestamp with time zone DEFAULT now() NOT NULL,
	"warmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "drives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"region_id" uuid,
	"label" text,
	"start_name" text,
	"start_lat" double precision NOT NULL,
	"start_lng" double precision NOT NULL,
	"end_name" text,
	"end_lat" double precision NOT NULL,
	"end_lng" double precision NOT NULL,
	"polyline" jsonb NOT NULL,
	"distance_meters" integer,
	"duration_seconds" integer,
	"route_provenance" jsonb,
	"route_sig" text NOT NULL,
	"selection" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interludes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region_id" uuid,
	"persona_key" text NOT NULL,
	"kind" text NOT NULL,
	"variant" integer DEFAULT 0 NOT NULL,
	"script" text,
	"audio_url" text NOT NULL,
	"audio_duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interludes_lookup_uq" UNIQUE NULLS NOT DISTINCT("region_id","persona_key","kind","variant")
);
--> statement-breakpoint
CREATE TABLE "narrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poi_id" uuid NOT NULL,
	"form" "track_form" NOT NULL,
	"script" text,
	"audio_url" text NOT NULL,
	"audio_duration_ms" integer NOT NULL,
	"attribution" jsonb,
	"facts_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drive_demand" ADD CONSTRAINT "drive_demand_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drives" ADD CONSTRAINT "drives_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interludes" ADD CONSTRAINT "interludes_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrations" ADD CONSTRAINT "narrations_poi_id_pois_id_fk" FOREIGN KEY ("poi_id") REFERENCES "public"."pois"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drives_user_idx" ON "drives" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "drives_route_sig_idx" ON "drives" USING btree ("route_sig");--> statement-breakpoint
CREATE INDEX "interludes_lookup_idx" ON "interludes" USING btree ("region_id","persona_key","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "narrations_poi_uq" ON "narrations" USING btree ("poi_id");--> statement-breakpoint
-- DATA-PRESERVING HOIST (hand-authored; V2 migration). Copy the existing ROAM tellings
-- (segments.tour_id IS NULL + their track) into narrations, 1:1 per poi. This is PAID TTS content:
-- R2 audio keys are carried VERBATIM (no re-synth) and facts_hash is COPIED, not recomputed, so
-- generate-roam's freshness skip-gate still sees every clip as fresh. Idempotent: ON CONFLICT
-- (poi_id) DO NOTHING, and DISTINCT ON guards any legacy duplicate (keeps the canonical variant-0,
-- most-recent clip). Reads segments/tracks, which still exist this migration (they drop in the
-- later CONTRACT migration, once every consumer is rewired off them).
INSERT INTO "narrations" ("poi_id", "form", "script", "audio_url", "audio_duration_ms", "attribution", "facts_hash", "created_at", "updated_at")
SELECT DISTINCT ON (s."poi_id")
  s."poi_id", t."form", t."script", t."audio_url", t."audio_duration_ms", t."attribution", t."facts_hash", t."created_at", t."updated_at"
FROM "segments" s
JOIN "tracks" t ON t."segment_id" = s."id"
WHERE s."tour_id" IS NULL
  AND t."audio_url" IS NOT NULL
ORDER BY s."poi_id", t."variant" ASC, t."updated_at" DESC
ON CONFLICT ("poi_id") DO NOTHING;