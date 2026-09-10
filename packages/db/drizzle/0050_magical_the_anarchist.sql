CREATE TABLE "release_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"input_fingerprint" text NOT NULL,
	"model" text NOT NULL,
	"policy_version" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"job_id" uuid,
	"result" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_assessment_status_valid" CHECK ("release_assessments"."status" in ('pending', 'complete', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "listening_review_items" ADD COLUMN "assessment_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "release_assessment_input_uq" ON "release_assessments" USING btree ("input_fingerprint","model","policy_version");--> statement-breakpoint
ALTER TABLE "listening_review_items" ADD CONSTRAINT "listening_review_items_assessment_id_release_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."release_assessments"("id") ON DELETE set null ON UPDATE no action;