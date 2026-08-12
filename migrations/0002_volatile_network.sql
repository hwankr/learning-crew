CREATE TABLE "push_subs" (
	"endpoint" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "status" ADD COLUMN "last_notified_at" timestamp with time zone;