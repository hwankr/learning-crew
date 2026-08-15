CREATE TABLE "tag_prefs" (
	"member_id" text PRIMARY KEY NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
