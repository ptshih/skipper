ALTER TABLE "tour_frames" ALTER COLUMN "audio_url" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tour_frames" ALTER COLUMN "audio_duration_ms" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tracks" ALTER COLUMN "audio_url" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tracks" ALTER COLUMN "audio_duration_ms" SET NOT NULL;