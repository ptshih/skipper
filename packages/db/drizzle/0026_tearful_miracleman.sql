-- Pre-cleanup: settle any pre-existing DUPLICATE active rows (the double-spend residue this index
-- prevents — a crash-stuck or double-submitted pair) so the CREATE UNIQUE INDEX below can't abort with
-- 23505 "could not create unique index ... contains duplicated values". Keep the NEWEST active row per
-- (kind, target_id); fail the older ones. NULL target_id is left alone (the partial index treats NULLs
-- as distinct, so those rows never conflict). A no-op when the corpus is already clean. (audit #1)
UPDATE "studio_jobs" SET "status" = 'failed', "ended_at" = now(),
  "error" = 'superseded duplicate active run (pre-index cleanup)'
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", row_number() OVER (PARTITION BY "kind", "target_id" ORDER BY "created_at" DESC) AS rn
    FROM "studio_jobs"
    WHERE "status" IN ('queued', 'running') AND "target_id" IS NOT NULL
  ) ranked
  WHERE ranked.rn > 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX "studio_jobs_active_target_uq" ON "studio_jobs" USING btree ("kind","target_id") WHERE "studio_jobs"."status" in ('queued', 'running');
