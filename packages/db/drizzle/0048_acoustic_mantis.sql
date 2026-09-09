CREATE TABLE "listening_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region_slug" text NOT NULL,
	"corridor" text NOT NULL,
	"drive_id" uuid NOT NULL,
	"corpus_fingerprint" text NOT NULL,
	"route" jsonb NOT NULL,
	"report" jsonb NOT NULL,
	"notes" text NOT NULL,
	"reviewer" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listening_evidence" ADD CONSTRAINT "listening_evidence_region_slug_regions_slug_fk" FOREIGN KEY ("region_slug") REFERENCES "public"."regions"("slug") ON DELETE no action ON UPDATE no action;