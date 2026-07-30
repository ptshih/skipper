ALTER TABLE "pois" DROP CONSTRAINT "pois_cluster_anchor_id_pois_id_fk";
--> statement-breakpoint
ALTER TABLE "pois" DROP COLUMN "cluster_anchor_id";--> statement-breakpoint
ALTER TABLE "pois" DROP COLUMN "cluster_treatment";--> statement-breakpoint
ALTER TABLE "pois" DROP COLUMN "cluster_title";