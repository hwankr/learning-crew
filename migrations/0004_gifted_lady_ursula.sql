CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entry_id" uuid NOT NULL,
	"member_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reactions" (
	"entry_id" uuid NOT NULL,
	"member_id" text NOT NULL,
	"emojis" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"acted_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reactions_entry_id_member_id_pk" PRIMARY KEY("entry_id","member_id")
);
--> statement-breakpoint
CREATE INDEX "comments_updated_at_id_idx" ON "comments" USING btree ("updated_at","id");--> statement-breakpoint
CREATE INDEX "comments_entry_id_idx" ON "comments" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "reactions_updated_at_idx" ON "reactions" USING btree ("updated_at","entry_id","member_id");