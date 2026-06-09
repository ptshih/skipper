CREATE TYPE "public"."bracket_kind" AS ENUM('intro', 'outro');--> statement-breakpoint
CREATE TYPE "public"."poi_source" AS ENUM('wikipedia', 'google_places');--> statement-breakpoint
CREATE TYPE "public"."stop_type" AS ENUM('story', 'scenic', 'break');--> statement-breakpoint
CREATE TYPE "public"."tour_status" AS ENUM('draft', 'generating', 'ready', 'failed');--> statement-breakpoint
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
CREATE TABLE "saved_tours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"tour_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tour_brackets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tour_id" uuid NOT NULL,
	"kind" "bracket_kind" NOT NULL,
	"script" text,
	"audio_url" text,
	"audio_duration_ms" integer,
	"reviewed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tour_stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tour_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"poi_id" uuid NOT NULL,
	"stop_type" "stop_type" NOT NULL,
	"script" text,
	"audio_url" text,
	"audio_duration_ms" integer,
	"attribution" jsonb,
	"reviewed" boolean DEFAULT false NOT NULL,
	"facts_hash" text,
	"trigger_radius_m" integer DEFAULT 120 NOT NULL,
	"trigger_lat" double precision,
	"trigger_lng" double precision,
	"approach_heading_deg" integer,
	"meta" jsonb,
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
	"start_anchor_name" text NOT NULL,
	"start_anchor_lat" double precision NOT NULL,
	"start_anchor_lng" double precision NOT NULL,
	"end_anchor_name" text NOT NULL,
	"end_anchor_lat" double precision NOT NULL,
	"end_anchor_lng" double precision NOT NULL,
	"status" "tour_status" DEFAULT 'draft' NOT NULL,
	"route_sig" text,
	"is_preview" boolean DEFAULT false NOT NULL,
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
ALTER TABLE "saved_tours" ADD CONSTRAINT "saved_tours_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_tours" ADD CONSTRAINT "saved_tours_tour_id_tours_id_fk" FOREIGN KEY ("tour_id") REFERENCES "public"."tours"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tour_brackets" ADD CONSTRAINT "tour_brackets_tour_id_tours_id_fk" FOREIGN KEY ("tour_id") REFERENCES "public"."tours"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tour_stops" ADD CONSTRAINT "tour_stops_tour_id_tours_id_fk" FOREIGN KEY ("tour_id") REFERENCES "public"."tours"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tour_stops" ADD CONSTRAINT "tour_stops_poi_id_pois_id_fk" FOREIGN KEY ("poi_id") REFERENCES "public"."pois"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tours" ADD CONSTRAINT "tours_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pois_source_source_id_uq" ON "pois" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX "pois_kind_idx" ON "pois" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "regions_slug_uq" ON "regions" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_tours_user_tour_uq" ON "saved_tours" USING btree ("user_id","tour_id");--> statement-breakpoint
CREATE INDEX "saved_tours_user_idx" ON "saved_tours" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tour_brackets_tour_kind_uq" ON "tour_brackets" USING btree ("tour_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "tour_stops_tour_seq_uq" ON "tour_stops" USING btree ("tour_id","seq");--> statement-breakpoint
CREATE INDEX "tour_stops_poi_idx" ON "tour_stops" USING btree ("poi_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tours_slug_uq" ON "tours" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "tours_region_idx" ON "tours" USING btree ("region_id");--> statement-breakpoint
CREATE INDEX "tours_status_idx" ON "tours" USING btree ("status");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");