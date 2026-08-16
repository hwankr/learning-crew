ALTER TABLE "status" ADD COLUMN "last_started_at" timestamp with time zone;--> statement-breakpoint
UPDATE "status" SET "last_started_at" = "since" WHERE "is_on" = true AND "since" IS NOT NULL;
