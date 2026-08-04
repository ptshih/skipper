DROP INDEX "places_endpoint_idx";--> statement-breakpoint
ALTER TABLE "places" DROP COLUMN "endpoint_eligible";--> statement-breakpoint
ALTER TABLE "places" DROP COLUMN "break_eligible";--> statement-breakpoint
ALTER TABLE "places" DROP COLUMN "featured";