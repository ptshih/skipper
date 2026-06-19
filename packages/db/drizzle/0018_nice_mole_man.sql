-- 0018 — pois becomes Wikidata-only (qid NOT NULL, the canonical identity + dedup key); Google
-- break anchors move OUT of pois into their own `places` table (keyed by the Google place_id).
-- Hand-edited from the drizzle skeleton to add the DATA migration + correct statement ORDER:
-- move the google_places rows before the enum recreate; backfill qid before NOT NULL + the unique index.

-- 1. The new Google-anchor table (a different identity universe from pois — no QID).
CREATE TABLE "places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"place_id" text NOT NULL,
	"name" text NOT NULL,
	"primary_type" text,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- 2. Move existing google_places break anchors out of pois → places (kind = Google primaryType).
INSERT INTO "places" ("place_id", "name", "primary_type", "lat", "lng")
SELECT "source_id", "name", "kind", "lat", "lng" FROM "pois" WHERE "source" = 'google_places';
--> statement-breakpoint
-- 3. Drop them from pois (so the enum recreate below has no out-of-vocabulary values).
DELETE FROM "pois" WHERE "source" = 'google_places';
--> statement-breakpoint
-- 4. Recreate poi_source without 'google_places' (pois is Wikidata-spine only now). Safe: poi_overrides
--    is all 'wikipedia' and pois no longer has any google_places rows after step 3.
ALTER TABLE "poi_overrides" ALTER COLUMN "source" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "pois" ALTER COLUMN "source" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."poi_source";--> statement-breakpoint
CREATE TYPE "public"."poi_source" AS ENUM('wikipedia', 'wikidata');--> statement-breakpoint
ALTER TABLE "poi_overrides" ALTER COLUMN "source" SET DATA TYPE "public"."poi_source" USING "source"::"public"."poi_source";--> statement-breakpoint
ALTER TABLE "pois" ALTER COLUMN "source" SET DATA TYPE "public"."poi_source" USING "source"::"public"."poi_source";--> statement-breakpoint
-- 5. Add qid NULLABLE, backfill (story ← facts.qid, scenic ← source_id), THEN enforce NOT NULL.
ALTER TABLE "pois" ADD COLUMN "qid" text;--> statement-breakpoint
UPDATE "pois" SET "qid" = "facts"->>'qid' WHERE "source" = 'wikipedia';--> statement-breakpoint
UPDATE "pois" SET "qid" = "source_id" WHERE "source" = 'wikidata';--> statement-breakpoint
ALTER TABLE "pois" ALTER COLUMN "qid" SET NOT NULL;--> statement-breakpoint
-- 6. Indexes. pois_qid_uq is the new PRIMARY dedup invariant (no dups exist — verified pre-migration).
CREATE UNIQUE INDEX "places_place_id_uq" ON "places" USING btree ("place_id");--> statement-breakpoint
CREATE INDEX "places_lat_lng_idx" ON "places" USING btree ("lat","lng");--> statement-breakpoint
CREATE UNIQUE INDEX "pois_qid_uq" ON "pois" USING btree ("qid");
