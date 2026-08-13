CREATE TABLE "notif_prefs" (
	"member_id" text PRIMARY KEY NOT NULL,
	"start_mode" text DEFAULT 'daily' NOT NULL,
	"per_member" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cm_mine" boolean DEFAULT true NOT NULL,
	"cm_reply" boolean DEFAULT true NOT NULL,
	"cm_all" boolean DEFAULT false NOT NULL,
	"react_mode" text DEFAULT 'daily' NOT NULL,
	"quiet_enabled" boolean DEFAULT true NOT NULL,
	"quiet_from" text DEFAULT '22:00' NOT NULL,
	"quiet_to" text DEFAULT '07:00' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" text NOT NULL,
	"kind" text NOT NULL,
	"why" text NOT NULL,
	"actor" text,
	"entry_id" uuid,
	"quote" text DEFAULT '' NOT NULL,
	"ctx" text DEFAULT '' NOT NULL,
	"actors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"day" date NOT NULL,
	"agg_key" text,
	"pushed_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "notifications_updated_at_id_idx" ON "notifications" USING btree ("updated_at","id");--> statement-breakpoint
CREATE INDEX "notifications_member_created_idx" ON "notifications" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_agg_uq" ON "notifications" USING btree ("member_id","day","agg_key");