ALTER TABLE "gen_jobs" ALTER COLUMN "kind" SET DATA TYPE text USING "kind"::text;--> statement-breakpoint
UPDATE "gen_jobs" SET "kind" = 'sweep_region_pois' WHERE "kind" = 'sweep_roam_pois';--> statement-breakpoint
DROP TYPE "gen_job_kind";
