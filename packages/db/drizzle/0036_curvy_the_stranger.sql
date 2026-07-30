CREATE TABLE "poi_clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"treatment" text NOT NULL,
	"title" text NOT NULL,
	"subject_poi_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poi_clusters_treatment" CHECK ("poi_clusters"."treatment" in ('cluster', 'district'))
);
--> statement-breakpoint
ALTER TABLE "narrations" ALTER COLUMN "poi_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "narrations" ADD COLUMN "cluster_id" uuid;--> statement-breakpoint
ALTER TABLE "pois" ADD COLUMN "cluster_id" uuid;--> statement-breakpoint
ALTER TABLE "poi_clusters" ADD CONSTRAINT "poi_clusters_subject_poi_id_pois_id_fk" FOREIGN KEY ("subject_poi_id") REFERENCES "public"."pois"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrations" ADD CONSTRAINT "narrations_cluster_id_poi_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."poi_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pois" ADD CONSTRAINT "pois_cluster_id_poi_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."poi_clusters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "narrations_cluster_uq" ON "narrations" USING btree ("cluster_id");--> statement-breakpoint
ALTER TABLE "narrations" ADD CONSTRAINT "narrations_subject_xor" CHECK (("narrations"."poi_id" IS NOT NULL) <> ("narrations"."cluster_id" IS NOT NULL));