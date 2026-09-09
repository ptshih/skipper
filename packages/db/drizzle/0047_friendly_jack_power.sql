CREATE TABLE "listening_review_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"narration_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"queue" text NOT NULL,
	"verdict" text DEFAULT 'unreviewed' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"advisory_reason" text DEFAULT '' NOT NULL,
	"technical" jsonb,
	"reviewer" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listening_verdict_valid" CHECK ("listening_review_items"."verdict" in ('unreviewed', 'good', 'needs_work'))
);
--> statement-breakpoint
CREATE TABLE "listening_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region_slug" text NOT NULL,
	"narration_id" uuid,
	"fingerprint" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"reviewer" text NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listening_review_items" ADD CONSTRAINT "listening_review_items_review_id_listening_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."listening_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listening_reviews" ADD CONSTRAINT "listening_reviews_region_slug_regions_slug_fk" FOREIGN KEY ("region_slug") REFERENCES "public"."regions"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "listening_review_item_uq" ON "listening_review_items" USING btree ("review_id","narration_id");