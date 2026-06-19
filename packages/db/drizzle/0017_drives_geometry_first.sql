-- Drives geometry-first (docs/decisions/geometry-first-regions.md): a drive stores NO region FK —
-- its region(s) are DERIVED by intersecting the route bbox with regions. Add the route's bounding
-- rectangle (a STALE-PROOF cache of the frozen polyline). drive_demand drops its region FK too.
-- Zero real users → TRUNCATE the handful of test drives so the NOT NULL bbox columns add cleanly
-- (clean-destructive migration, per the CLAUDE.md no-users STORAGE rule).
TRUNCATE TABLE "drives" CASCADE;
--> statement-breakpoint
TRUNCATE TABLE "drive_demand";
--> statement-breakpoint
ALTER TABLE "drives" DROP CONSTRAINT IF EXISTS "drives_region_id_regions_id_fk";
--> statement-breakpoint
ALTER TABLE "drive_demand" DROP CONSTRAINT IF EXISTS "drive_demand_region_id_regions_id_fk";
--> statement-breakpoint
ALTER TABLE "drives" DROP COLUMN "region_id";
--> statement-breakpoint
ALTER TABLE "drive_demand" DROP COLUMN "region_id";
--> statement-breakpoint
ALTER TABLE "drives" ADD COLUMN "bbox_min_lat" double precision NOT NULL;
--> statement-breakpoint
ALTER TABLE "drives" ADD COLUMN "bbox_min_lng" double precision NOT NULL;
--> statement-breakpoint
ALTER TABLE "drives" ADD COLUMN "bbox_max_lat" double precision NOT NULL;
--> statement-breakpoint
ALTER TABLE "drives" ADD COLUMN "bbox_max_lng" double precision NOT NULL;
