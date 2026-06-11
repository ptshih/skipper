ALTER TYPE "public"."gen_job_kind" ADD VALUE 'resynth_roam_clip' BEFORE 'sweep_orphans';--> statement-breakpoint
ALTER TYPE "public"."gen_job_kind" ADD VALUE 'sweep_roam_pois';--> statement-breakpoint
ALTER TYPE "public"."gen_job_kind" ADD VALUE 'generate_roam';