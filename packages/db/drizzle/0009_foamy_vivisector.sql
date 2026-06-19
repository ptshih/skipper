ALTER TABLE "segments" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tour_frames" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tours" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tracks" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "segments" CASCADE;--> statement-breakpoint
DROP TABLE "tour_frames" CASCADE;--> statement-breakpoint
DROP TABLE "tours" CASCADE;--> statement-breakpoint
DROP TABLE "tracks" CASCADE;--> statement-breakpoint
-- (the tour_id FKs were already dropped by the DROP TABLE "tours" CASCADE above; IF EXISTS keeps this idempotent)
ALTER TABLE "eval_runs" DROP CONSTRAINT IF EXISTS "eval_runs_tour_id_tours_id_fk";
--> statement-breakpoint
ALTER TABLE "gen_jobs" DROP CONSTRAINT IF EXISTS "gen_jobs_tour_id_tours_id_fk";
--> statement-breakpoint
ALTER TABLE "eval_runs" DROP COLUMN "tour_id";--> statement-breakpoint
ALTER TABLE "gen_jobs" DROP COLUMN "tour_id";--> statement-breakpoint
DROP TYPE "public"."frame_kind";--> statement-breakpoint
DROP TYPE "public"."tour_status";