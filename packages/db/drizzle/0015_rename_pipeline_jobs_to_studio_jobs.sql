-- Rename `pipeline_jobs` → `studio_jobs` — align the cloud job-execution record with the
-- @skipper/studio package rename (generator → studio). A CLEAN in-place rename (PRESERVES the run
-- history rows, unlike 0013's destructive gen_jobs→pipeline_jobs recreate): the table, its status
-- enum, both indexes, and the FK + PK constraints are all renamed to the `studio_jobs_*` identifiers.
-- drizzle-kit can't emit a table rename non-interactively (needs a TTY), so this is hand-authored;
-- the 0015 snapshot encodes the same end state.
ALTER TABLE "pipeline_jobs" RENAME TO "studio_jobs";--> statement-breakpoint
ALTER TYPE "pipeline_job_status" RENAME TO "studio_job_status";--> statement-breakpoint
ALTER INDEX "pipeline_jobs_created_idx" RENAME TO "studio_jobs_created_idx";--> statement-breakpoint
ALTER INDEX "pipeline_jobs_status_idx" RENAME TO "studio_jobs_status_idx";--> statement-breakpoint
ALTER TABLE "studio_jobs" RENAME CONSTRAINT "pipeline_jobs_eval_run_id_eval_runs_id_fk" TO "studio_jobs_eval_run_id_eval_runs_id_fk";--> statement-breakpoint
ALTER TABLE "studio_jobs" RENAME CONSTRAINT "pipeline_jobs_pkey" TO "studio_jobs_pkey";
