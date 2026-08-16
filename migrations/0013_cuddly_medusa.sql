CREATE TABLE "events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"title" text NOT NULL,
	"tag" text NOT NULL,
	"memo" text DEFAULT '' NOT NULL,
	"day" date NOT NULL,
	"end_day" date,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "events_updated_at_id_idx" ON "events" USING btree ("updated_at","id");