CREATE TYPE "public"."eval_run_kind" AS ENUM('generation', 'offline_audit');--> statement-breakpoint
CREATE TYPE "public"."eval_score_source" AS ENUM('judge', 'human');--> statement-breakpoint
CREATE TYPE "public"."frame_kind" AS ENUM('intro', 'outro');--> statement-breakpoint
CREATE TYPE "public"."gen_job_kind" AS ENUM('generate', 'patch_clip', 'resynth', 'resynth_roam_clip', 'sweep_orphans', 'sweep_roam_pois', 'generate_roam');--> statement-breakpoint
CREATE TYPE "public"."gen_job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."poi_source" AS ENUM('wikipedia', 'google_places', 'wikidata');--> statement-breakpoint
CREATE TYPE "public"."tour_status" AS ENUM('draft', 'generating', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."track_form" AS ENUM('story', 'scenic', 'break', 'wave', 'bside');--> statement-breakpoint
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
	"output_log" text,
	"output_summary" text,
	"output_data" jsonb,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"persona_key" text NOT NULL,
	"name" text NOT NULL,
	"tagline" text,
	"backstory" text,
	"portrait_url" text,
	"voice_sample_url" text,
	"voice_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "poi_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "poi_source" NOT NULL,
	"source_id" text NOT NULL,
	"name" text NOT NULL,
	"find" text,
	"replace" text,
	"reason" text NOT NULL,
	"source_url" text,
	"upstream_status" "upstream_status" DEFAULT 'not_filed' NOT NULL,
	"upstream_url" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poi_overrides_identity_uq" UNIQUE NULLS NOT DISTINCT("source","source_id","find")
);
--> statement-breakpoint
CREATE TABLE "pois" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "poi_source" NOT NULL,
	"source_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"speakable_lat" double precision,
	"speakable_lng" double precision,
	"summary" text,
	"facts" jsonb,
	"facts_hash" text,
	"facts_fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poi_id" uuid NOT NULL,
	"tour_id" uuid,
	"persona_id" uuid NOT NULL,
	"seq" integer,
	"trigger_lat" double precision,
	"trigger_lng" double precision,
	"approach_heading_deg" integer,
	"radius_m" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "segments_tour_seq_ck" CHECK (("segments"."tour_id" is null) = ("segments"."seq" is null))
);
--> statement-breakpoint
CREATE TABLE "tour_frames" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tour_id" uuid NOT NULL,
	"kind" "frame_kind" NOT NULL,
	"script" text,
	"audio_url" text,
	"audio_duration_ms" integer,
	"attribution" jsonb,
	"facts_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"headline" text NOT NULL,
	"polyline" jsonb NOT NULL,
	"distance_meters" integer,
	"duration_seconds" integer,
	"summary" text,
	"route_provenance" jsonb,
	"start_anchor_name" text NOT NULL,
	"start_anchor_lat" double precision NOT NULL,
	"start_anchor_lng" double precision NOT NULL,
	"end_anchor_name" text NOT NULL,
	"end_anchor_lat" double precision NOT NULL,
	"end_anchor_lng" double precision NOT NULL,
	"status" "tour_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"segment_id" uuid NOT NULL,
	"form" "track_form" NOT NULL,
	"variant" integer DEFAULT 0 NOT NULL,
	"script" text,
	"audio_url" text,
	"audio_duration_ms" integer,
	"attribution" jsonb,
	"facts_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"is_anonymous" boolean DEFAULT false,
	"tier" text DEFAULT 'free',
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_tour_id_tours_id_fk" FOREIGN KEY ("tour_id") REFERENCES "public"."tours"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_scores" ADD CONSTRAINT "eval_scores_run_id_eval_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."eval_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gen_jobs" ADD CONSTRAINT "gen_jobs_tour_id_tours_id_fk" FOREIGN KEY ("tour_id") REFERENCES "public"."tours"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gen_jobs" ADD CONSTRAINT "gen_jobs_eval_run_id_eval_runs_id_fk" FOREIGN KEY ("eval_run_id") REFERENCES "public"."eval_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_poi_id_pois_id_fk" FOREIGN KEY ("poi_id") REFERENCES "public"."pois"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_tour_id_tours_id_fk" FOREIGN KEY ("tour_id") REFERENCES "public"."tours"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tour_frames" ADD CONSTRAINT "tour_frames_tour_id_tours_id_fk" FOREIGN KEY ("tour_id") REFERENCES "public"."tours"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tours" ADD CONSTRAINT "tours_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_runs_slug_idx" ON "eval_runs" USING btree ("slug","created_at");--> statement-breakpoint
CREATE INDEX "eval_scores_run_idx" ON "eval_scores" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "eval_scores_case_idx" ON "eval_scores" USING btree ("poi_source","poi_source_id","dimension");--> statement-breakpoint
CREATE INDEX "gen_jobs_created_idx" ON "gen_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "gen_jobs_status_idx" ON "gen_jobs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "personas_key_uq" ON "personas" USING btree ("persona_key");--> statement-breakpoint
CREATE INDEX "poi_overrides_source_idx" ON "poi_overrides" USING btree ("source","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pois_source_source_id_uq" ON "pois" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX "pois_kind_idx" ON "pois" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "regions_slug_uq" ON "regions" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "segments_tour_seq_uq" ON "segments" USING btree ("tour_id","seq");--> statement-breakpoint
CREATE INDEX "segments_poi_idx" ON "segments" USING btree ("poi_id");--> statement-breakpoint
CREATE INDEX "segments_tour_idx" ON "segments" USING btree ("tour_id");--> statement-breakpoint
CREATE INDEX "segments_persona_idx" ON "segments" USING btree ("persona_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tour_frames_tour_kind_uq" ON "tour_frames" USING btree ("tour_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "tours_slug_uq" ON "tours" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "tours_region_idx" ON "tours" USING btree ("region_id");--> statement-breakpoint
CREATE INDEX "tours_status_idx" ON "tours" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "tracks_segment_form_variant_uq" ON "tracks" USING btree ("segment_id","form","variant");--> statement-breakpoint
CREATE INDEX "tracks_segment_idx" ON "tracks" USING btree ("segment_id");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");