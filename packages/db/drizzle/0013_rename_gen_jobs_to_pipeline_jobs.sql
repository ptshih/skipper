-- Rename `gen_jobs` → `pipeline_jobs` (V2 naming pass — the corpus pipeline's job-execution record).
-- gen_jobs is OBSERVABILITY only (the operational run record; nothing in the player/API reads it for
-- logic), so per the no-users storage doctrine this is a CLEAN destructive drop + recreate (mirrors
-- 0012's rename style; drizzle-kit can't generate a rename non-interactively): the run audit trail is
-- intentionally dropped, the status enum is renamed in place, and every constraint/index is reborn
-- with the `pipeline_jobs_*` name — no lingering `gen_jobs_*` / `gen_job_status` identifiers.
DROP TABLE "gen_jobs";--> statement-breakpoint
ALTER TYPE "gen_job_status" RENAME TO "pipeline_job_status";--> statement-breakpoint
CREATE TABLE "pipeline_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"status" "pipeline_job_status" DEFAULT 'queued' NOT NULL,
	"target_slug" text,
	"target_id" text,
	"args" jsonb NOT NULL,
	"dry_run" boolean DEFAULT true NOT NULL,
	"phase" text,
	"cost_usd" double precision,
	"eval_run_id" uuid,
	"cloud_run_execution" text,
	"triggered_by" text NOT NULL,
	"error" text,
	"output_log" text,
	"output_summary" text,
	"output_data" jsonb,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pipeline_jobs" ADD CONSTRAINT "pipeline_jobs_eval_run_id_eval_runs_id_fk" FOREIGN KEY ("eval_run_id") REFERENCES "public"."eval_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pipeline_jobs_created_idx" ON "pipeline_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "pipeline_jobs_status_idx" ON "pipeline_jobs" USING btree ("status");
