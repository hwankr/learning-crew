CREATE TABLE "status" (
	"member_id" text PRIMARY KEY NOT NULL,
	"is_on" boolean DEFAULT false NOT NULL,
	"place" text,
	"since" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
