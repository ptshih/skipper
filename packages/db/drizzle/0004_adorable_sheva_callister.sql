CREATE TABLE "roam_clips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poi_id" uuid NOT NULL,
	"script" text NOT NULL,
	"audio_url" text NOT NULL,
	"audio_duration_ms" integer NOT NULL,
	"attribution" jsonb,
	"facts_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "roam_clips" ADD CONSTRAINT "roam_clips_poi_id_pois_id_fk" FOREIGN KEY ("poi_id") REFERENCES "public"."pois"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "roam_clips_poi_uq" ON "roam_clips" USING btree ("poi_id");