CREATE TYPE "public"."gen_job_kind" AS ENUM('generate', 'patch_clip', 'resynth', 'sweep_orphans');--> statement-breakpoint
CREATE TYPE "public"."gen_job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'canceled');--> statement-breakpoint
CREATE TABLE "gen_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "gen_job_kind" NOT NULL,
	"status" "gen_job_status" DEFAULT 'queued' NOT NULL,
	"target_slug" text,
	"tour_id" uuid,
	"target_id" text,
	"args" jsonb NOT NULL,
	"dry_run" boolean DEFAULT true NOT NULL,
	"phase" text,
	"cost_usd" double precision,
	"eval_run_id" uuid,
	"cloud_run_execution" text,
	"triggered_by" text NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gen_jobs" ADD CONSTRAINT "gen_jobs_tour_id_tours_id_fk" FOREIGN KEY ("tour_id") REFERENCES "public"."tours"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gen_jobs" ADD CONSTRAINT "gen_jobs_eval_run_id_eval_runs_id_fk" FOREIGN KEY ("eval_run_id") REFERENCES "public"."eval_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gen_jobs_created_idx" ON "gen_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "gen_jobs_status_idx" ON "gen_jobs" USING btree ("status");