ALTER TABLE "poi_clusters" ADD COLUMN "highlights" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "poi_clusters" ADD COLUMN "dropped" jsonb DEFAULT '[]'::jsonb NOT NULL;