ALTER TABLE "places" ADD COLUMN "endpoint_eligible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "break_eligible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "featured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "places_endpoint_idx" ON "places" USING btree ("lat","lng") WHERE "places"."endpoint_eligible";