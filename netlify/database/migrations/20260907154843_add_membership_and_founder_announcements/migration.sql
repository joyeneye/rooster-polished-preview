CREATE TABLE "announcement_deliveries" (
	"id" serial PRIMARY KEY,
	"announcement_id" integer NOT NULL,
	"member_id" text NOT NULL,
	"message_id" text,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "founder_announcements" (
	"id" serial PRIMARY KEY,
	"slug" text NOT NULL UNIQUE,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"author_id" text NOT NULL,
	"author_name" text DEFAULT 'J.White Did It' NOT NULL,
	"author_title" text DEFAULT 'Founder of JSPACE' NOT NULL,
	"audience_kind" text NOT NULL,
	"audience_levels" jsonb DEFAULT '[]' NOT NULL,
	"audience_member_ids" jsonb DEFAULT '[]' NOT NULL,
	"show_as_message" boolean DEFAULT true NOT NULL,
	"show_as_notification" boolean DEFAULT true NOT NULL,
	"show_on_homepage" boolean DEFAULT false NOT NULL,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership_launch" (
	"id" text PRIMARY KEY,
	"launched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"launched_by" text NOT NULL,
	"early_member_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" serial PRIMARY KEY,
	"member_id" text NOT NULL UNIQUE,
	"display_name" text DEFAULT '' NOT NULL,
	"level" text DEFAULT 'member' NOT NULL,
	"early_member" boolean DEFAULT false NOT NULL,
	"joined_at" timestamp with time zone,
	"level_updated_at" timestamp with time zone,
	"level_updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "announcement_deliveries_announcement_member_key" ON "announcement_deliveries" ("announcement_id","member_id");--> statement-breakpoint
ALTER TABLE "announcement_deliveries" ADD CONSTRAINT "announcement_deliveries_Qk33AEuZtcdT_fkey" FOREIGN KEY ("announcement_id") REFERENCES "founder_announcements"("id");