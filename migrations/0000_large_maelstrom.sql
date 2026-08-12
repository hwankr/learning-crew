CREATE TABLE "entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"day" date NOT NULL,
	"time" text NOT NULL,
	"tag" text NOT NULL,
	"stars" integer,
	"memo" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"todos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "entries_updated_at_id_idx" ON "entries" USING btree ("updated_at","id");