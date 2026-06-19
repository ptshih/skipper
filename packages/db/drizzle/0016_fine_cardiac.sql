CREATE TYPE "public"."credit_entry_kind" AS ENUM('grant', 'consume', 'reverse');--> statement-breakpoint
CREATE TYPE "public"."credit_source" AS ENUM('free_tier', 'apple_iap', 'google_play', 'admin_grant');--> statement-breakpoint
CREATE TABLE "credit_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"amount" integer NOT NULL,
	"kind" "credit_entry_kind" NOT NULL,
	"source" "credit_source",
	"reason" text,
	"idempotency_key" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_entries_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE INDEX "credit_entries_user_idx" ON "credit_entries" USING btree ("user_id");