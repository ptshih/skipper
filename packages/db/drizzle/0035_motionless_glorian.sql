ALTER TABLE "pois" ADD COLUMN "cluster_anchor_id" uuid;--> statement-breakpoint
ALTER TABLE "pois" ADD COLUMN "cluster_treatment" text;--> statement-breakpoint
ALTER TABLE "pois" ADD COLUMN "cluster_title" text;--> statement-breakpoint
ALTER TABLE "pois" ADD CONSTRAINT "pois_cluster_anchor_id_pois_id_fk" FOREIGN KEY ("cluster_anchor_id") REFERENCES "public"."pois"("id") ON DELETE set null ON UPDATE no action;