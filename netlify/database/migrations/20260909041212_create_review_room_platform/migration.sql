CREATE TABLE "review_pricing_tiers" (
	"id" serial PRIMARY KEY,
	"workspace_id" integer NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"priority_weight" integer DEFAULT 100 NOT NULL,
	"guaranteed" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_queue_entries" (
	"id" serial PRIMARY KEY,
	"submission_id" integer NOT NULL UNIQUE,
	"workspace_id" integer NOT NULL,
	"reviewer_id" integer,
	"queue_key" text DEFAULT 'standard' NOT NULL,
	"priority_score" integer DEFAULT 100 NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_reviewers" (
	"id" serial PRIMARY KEY,
	"workspace_id" integer NOT NULL,
	"member_id" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"queue_rules" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_reviews" (
	"id" serial PRIMARY KEY,
	"submission_id" integer NOT NULL UNIQUE,
	"reviewer_id" integer NOT NULL,
	"scores" jsonb DEFAULT '{}' NOT NULL,
	"overall_score" integer NOT NULL,
	"feedback" text NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"decision" text DEFAULT 'approved' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "review_submissions" (
	"id" serial PRIMARY KEY,
	"public_id" text NOT NULL UNIQUE,
	"workspace_id" integer NOT NULL,
	"artist_id" text NOT NULL,
	"artist_name" text NOT NULL,
	"title" text NOT NULL,
	"source_type" text NOT NULL,
	"source_url" text DEFAULT '' NOT NULL,
	"audio_key" text DEFAULT '' NOT NULL,
	"audio_mime" text DEFAULT '' NOT NULL,
	"genre" text DEFAULT '' NOT NULL,
	"mood" text DEFAULT '' NOT NULL,
	"tags" jsonb DEFAULT '[]' NOT NULL,
	"song_info" text DEFAULT '' NOT NULL,
	"social_links" jsonb DEFAULT '{}' NOT NULL,
	"tier_code" text DEFAULT 'free' NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"payment_status" text DEFAULT 'not_required' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"assigned_reviewer_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "review_transactions" (
	"id" serial PRIMARY KEY,
	"workspace_id" integer NOT NULL,
	"submission_id" integer,
	"artist_id" text NOT NULL,
	"kind" text DEFAULT 'charge' NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "review_workspaces" (
	"id" serial PRIMARY KEY,
	"owner_id" text NOT NULL UNIQUE,
	"slug" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"social_links" jsonb DEFAULT '{}' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "review_pricing_workspace_code_key" ON "review_pricing_tiers" ("workspace_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "review_reviewers_workspace_member_key" ON "review_reviewers" ("workspace_id","member_id");--> statement-breakpoint
ALTER TABLE "review_pricing_tiers" ADD CONSTRAINT "review_pricing_tiers_workspace_id_review_workspaces_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "review_workspaces"("id");--> statement-breakpoint
ALTER TABLE "review_queue_entries" ADD CONSTRAINT "review_queue_entries_submission_id_review_submissions_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "review_submissions"("id");--> statement-breakpoint
ALTER TABLE "review_queue_entries" ADD CONSTRAINT "review_queue_entries_workspace_id_review_workspaces_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "review_workspaces"("id");--> statement-breakpoint
ALTER TABLE "review_queue_entries" ADD CONSTRAINT "review_queue_entries_reviewer_id_review_reviewers_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "review_reviewers"("id");--> statement-breakpoint
ALTER TABLE "review_reviewers" ADD CONSTRAINT "review_reviewers_workspace_id_review_workspaces_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "review_workspaces"("id");--> statement-breakpoint
ALTER TABLE "review_reviews" ADD CONSTRAINT "review_reviews_submission_id_review_submissions_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "review_submissions"("id");--> statement-breakpoint
ALTER TABLE "review_reviews" ADD CONSTRAINT "review_reviews_reviewer_id_review_reviewers_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "review_reviewers"("id");--> statement-breakpoint
ALTER TABLE "review_submissions" ADD CONSTRAINT "review_submissions_workspace_id_review_workspaces_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "review_workspaces"("id");--> statement-breakpoint
ALTER TABLE "review_submissions" ADD CONSTRAINT "review_submissions_x45ZoRv8sdoH_fkey" FOREIGN KEY ("assigned_reviewer_id") REFERENCES "review_reviewers"("id");--> statement-breakpoint
ALTER TABLE "review_transactions" ADD CONSTRAINT "review_transactions_workspace_id_review_workspaces_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "review_workspaces"("id");--> statement-breakpoint
ALTER TABLE "review_transactions" ADD CONSTRAINT "review_transactions_submission_id_review_submissions_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "review_submissions"("id");