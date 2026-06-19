-- Rename the `interludes` table → `asides` (V2 naming pass). The table is EMPTY (the framing
-- library is unsynthesized), so this is a CLEAN destructive drop + recreate per the no-users
-- storage doctrine — every constraint/index is reborn with the `asides_*` name, no lingering
-- `interludes_*` identifiers. Hand-authored (mirrors 0010's rename style); drizzle-kit can't
-- generate a rename non-interactively.
DROP TABLE "interludes";--> statement-breakpoint
CREATE TABLE "asides" (
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
	CONSTRAINT "asides_lookup_uq" UNIQUE NULLS NOT DISTINCT("region_id","persona_key","kind","variant")
);
--> statement-breakpoint
ALTER TABLE "asides" ADD CONSTRAINT "asides_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asides_lookup_idx" ON "asides" USING btree ("region_id","persona_key","kind");
