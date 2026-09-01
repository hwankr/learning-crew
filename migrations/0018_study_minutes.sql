ALTER TABLE "entries" ADD COLUMN "study_minutes" integer;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_study_minutes_check" CHECK ("entries"."study_minutes" is null or ("entries"."study_minutes" between 1 and 1440 and "entries"."tag" <> 'OFF'));
