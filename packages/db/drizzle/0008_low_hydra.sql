ALTER TABLE "gen_jobs" ADD COLUMN "output_log" text;--> statement-breakpoint
ALTER TABLE "gen_jobs" ADD COLUMN "output_summary" text;--> statement-breakpoint
ALTER TABLE "gen_jobs" ADD COLUMN "output_data" jsonb;