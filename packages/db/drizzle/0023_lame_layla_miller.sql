CREATE TYPE "public"."delivery_register" AS ENUM('landscape', 'story', 'town', 'civic');--> statement-breakpoint
ALTER TABLE "pois" ADD COLUMN "delivery_register" "delivery_register";