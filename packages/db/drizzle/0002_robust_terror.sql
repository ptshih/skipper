CREATE TYPE "public"."eval_run_kind" AS ENUM('generation', 'offline_audit');--> statement-breakpoint
CREATE TYPE "public"."eval_score_source" AS ENUM('judge', 'human');--> statement-breakpoint
CREATE TYPE "public"."poi_override_kind" AS ENUM('fact_edit', 'side_anchor');--> statement-breakpoint
CREATE TYPE "public"."upstream_status" AS ENUM('not_filed', 'filed', 'merged', 'reverted', 'not_applicable');--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tour_id" uuid,
	"slug" text NOT NULL,
	"kind" "eval_run_kind" NOT NULL,
	"dry_run" boolean DEFAULT false NOT NULL,
	"git_sha" text,
	"narration_model" text,
	"judge_model" text,
	"pass" boolean NOT NULL,
	"grounding_score" double precision,
	"tts_score" double precision,
	"diversity_score" double precision,
	"charm_score" double precision,
	"veracity_score" double precision,
	"artifact" jsonb NOT NULL,
	"scorecard" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"poi_source" text,
	"poi_source_id" text,
	"seq" integer NOT NULL,
	"stop_type" text,
	"dimension" text NOT NULL,
	"source" "eval_score_source" DEFAULT 'judge' NOT NULL,
	"pass" boolean NOT NULL,
	"value" double precision NOT NULL,
	"findings" jsonb NOT NULL,
	"detail" jsonb,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "poi_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "poi_source" NOT NULL,
	"source_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" "poi_override_kind" NOT NULL,
	"find" text,
	"replace" text,
	"side_anchor_lat" double precision,
	"side_anchor_lng" double precision,
	"reason" text NOT NULL,
	"source_url" text,
	"upstream_status" "upstream_status" DEFAULT 'not_filed' NOT NULL,
	"upstream_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poi_overrides_identity_uq" UNIQUE NULLS NOT DISTINCT("source","source_id","kind","find")
);
--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_tour_id_tours_id_fk" FOREIGN KEY ("tour_id") REFERENCES "public"."tours"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_scores" ADD CONSTRAINT "eval_scores_run_id_eval_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."eval_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_runs_slug_idx" ON "eval_runs" USING btree ("slug","created_at");--> statement-breakpoint
CREATE INDEX "eval_scores_run_idx" ON "eval_scores" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "eval_scores_case_idx" ON "eval_scores" USING btree ("poi_source","poi_source_id","dimension");--> statement-breakpoint
CREATE INDEX "poi_overrides_source_idx" ON "poi_overrides" USING btree ("source","source_id");