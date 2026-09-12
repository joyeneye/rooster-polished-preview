CREATE TABLE "rcm_ai_messages" (
	"id" serial PRIMARY KEY,
	"member_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"action" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rcm_profiles" (
	"member_id" text PRIMARY KEY,
	"artist_name" text DEFAULT '' NOT NULL,
	"real_name" text DEFAULT '' NOT NULL,
	"roles" jsonb DEFAULT '[]' NOT NULL,
	"genre" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"pro_affiliation" text DEFAULT '' NOT NULL,
	"distributor" text DEFAULT '' NOT NULL,
	"management_status" text DEFAULT 'Independent' NOT NULL,
	"publishing_status" text DEFAULT 'Needs review' NOT NULL,
	"onboarding_complete" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rcm_records" (
	"id" serial PRIMARY KEY,
	"member_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"relation_key" text DEFAULT '' NOT NULL,
	"data" jsonb DEFAULT '{}' NOT NULL,
	"due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "rcm_ai_messages_member_idx" ON "rcm_ai_messages" ("member_id","created_at");--> statement-breakpoint
CREATE INDEX "rcm_records_member_kind_idx" ON "rcm_records" ("member_id","kind","updated_at");--> statement-breakpoint
CREATE INDEX "rcm_records_relation_idx" ON "rcm_records" ("member_id","relation_key");