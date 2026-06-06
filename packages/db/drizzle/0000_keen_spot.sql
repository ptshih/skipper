CREATE TYPE "public"."duration_bucket" AS ENUM('short', 'standard', 'long');--> statement-breakpoint
CREATE TYPE "public"."joke_level" AS ENUM('off', 'mild', 'dad', 'dadpocalypse');--> statement-breakpoint
CREATE TYPE "public"."persona" AS ENUM('skipper');--> statement-breakpoint
CREATE TYPE "public"."poi_source" AS ENUM('wikipedia', 'google_places');--> statement-breakpoint
CREATE TYPE "public"."stop_type" AS ENUM('story', 'scenic', 'break');--> statement-breakpoint
CREATE TYPE "public"."tour_status" AS ENUM('draft', 'generating', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "corridors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"polyline" jsonb NOT NULL,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "poi_content" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poi_id" uuid NOT NULL,
	"persona" "persona" NOT NULL,
	"voice" text NOT NULL,
	"joke_level" "joke_level" NOT NULL,
	"script" text NOT NULL,
	"audio_url" text,
	"audio_duration_ms" integer,
	"reviewed" boolean DEFAULT false NOT NULL,
	"attribution" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"summary" text,
	"facts" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tour_stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tour_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"poi_id" uuid NOT NULL,
	"poi_content_id" uuid,
	"stop_type" "stop_type" NOT NULL,
	"trigger_radius_m" integer DEFAULT 120 NOT NULL,
	"approach_heading_deg" integer,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corridor_id" uuid NOT NULL,
	"duration_bucket" "duration_bucket" NOT NULL,
	"interests" text[] DEFAULT '{}' NOT NULL,
	"persona" "persona" NOT NULL,
	"joke_level" "joke_level" NOT NULL,
	"status" "tour_status" DEFAULT 'draft' NOT NULL,
	"route_sig" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "poi_content" ADD CONSTRAINT "poi_content_poi_id_pois_id_fk" FOREIGN KEY ("poi_id") REFERENCES "public"."pois"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tour_stops" ADD CONSTRAINT "tour_stops_tour_id_tours_id_fk" FOREIGN KEY ("tour_id") REFERENCES "public"."tours"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tour_stops" ADD CONSTRAINT "tour_stops_poi_id_pois_id_fk" FOREIGN KEY ("poi_id") REFERENCES "public"."pois"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tour_stops" ADD CONSTRAINT "tour_stops_poi_content_id_poi_content_id_fk" FOREIGN KEY ("poi_content_id") REFERENCES "public"."poi_content"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tours" ADD CONSTRAINT "tours_corridor_id_corridors_id_fk" FOREIGN KEY ("corridor_id") REFERENCES "public"."corridors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "corridors_slug_uq" ON "corridors" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "poi_content_key_uq" ON "poi_content" USING btree ("poi_id","persona","voice","joke_level");--> statement-breakpoint
CREATE UNIQUE INDEX "pois_source_source_id_uq" ON "pois" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX "pois_kind_idx" ON "pois" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "tour_stops_tour_seq_uq" ON "tour_stops" USING btree ("tour_id","seq");--> statement-breakpoint
CREATE INDEX "tour_stops_poi_idx" ON "tour_stops" USING btree ("poi_id");--> statement-breakpoint
CREATE INDEX "tour_stops_content_idx" ON "tour_stops" USING btree ("poi_content_id");--> statement-breakpoint
CREATE INDEX "tours_corridor_idx" ON "tours" USING btree ("corridor_id");--> statement-breakpoint
CREATE INDEX "tours_status_idx" ON "tours" USING btree ("status");