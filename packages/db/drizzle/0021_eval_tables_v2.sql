DROP TABLE "eval_scores" CASCADE;--> statement-breakpoint
DROP TABLE "eval_runs" CASCADE;--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region" text NOT NULL,
	"kind" "eval_run_kind" NOT NULL,
	"dry_run" boolean DEFAULT false NOT NULL,
	"git_sha" text,
	"narration_model" text,
	"judge_model" text,
	"pass" boolean NOT NULL,
	"total" integer NOT NULL,
	"shipped" integer NOT NULL,
	"withheld" integer NOT NULL,
	"grounding_score" double precision,
	"tts_score" double precision,
	"diversity_score" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"poi_id" uuid,
	"qid" text,
	"name" text,
	"dimension" text NOT NULL,
	"source" "eval_score_source" DEFAULT 'judge' NOT NULL,
	"pass" boolean NOT NULL,
	"value" double precision NOT NULL,
	"withheld" boolean DEFAULT false NOT NULL,
	"findings" jsonb NOT NULL,
	"detail" jsonb,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "eval_scores" ADD CONSTRAINT "eval_scores_run_id_eval_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."eval_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_scores" ADD CONSTRAINT "eval_scores_poi_id_pois_id_fk" FOREIGN KEY ("poi_id") REFERENCES "public"."pois"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_jobs" ADD CONSTRAINT "studio_jobs_eval_run_id_eval_runs_id_fk" FOREIGN KEY ("eval_run_id") REFERENCES "public"."eval_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_runs_region_idx" ON "eval_runs" USING btree ("region","created_at");--> statement-breakpoint
CREATE INDEX "eval_scores_run_idx" ON "eval_scores" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "eval_scores_case_idx" ON "eval_scores" USING btree ("qid","dimension");