ALTER TABLE "narrations" ADD COLUMN "released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "regions" ADD COLUMN "released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "tester" boolean DEFAULT false;--> statement-breakpoint
-- Backfill (region-release-gate): every EXISTING region + narration is currently PUBLIC — the read
-- paths (GET /roam, buildDrive corpus) had no release filter before this migration — so stamp them
-- released to preserve the live alpha corpus exactly as shipped. Rows created AFTER this migration
-- default to NULL (region = draft, narration = staged). This is the monotonic "never un-publish what's
-- already shipped" invariant applied to the migration itself. See docs/decisions/region-release-gate.md.
UPDATE "regions" SET "released_at" = now() WHERE "released_at" IS NULL;--> statement-breakpoint
UPDATE "narrations" SET "released_at" = now() WHERE "released_at" IS NULL;