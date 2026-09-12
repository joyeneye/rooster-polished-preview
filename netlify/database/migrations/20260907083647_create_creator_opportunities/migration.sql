CREATE TABLE "opportunities" (
	"id" serial PRIMARY KEY,
	"slug" text NOT NULL UNIQUE,
	"title" text NOT NULL,
	"headline" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"poster_role" text NOT NULL,
	"seeking_role" text NOT NULL,
	"lanes" jsonb DEFAULT '[]' NOT NULL,
	"genre" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"region" text DEFAULT '' NOT NULL,
	"work_mode" text DEFAULT 'either' NOT NULL,
	"posted_by_kind" text DEFAULT 'member' NOT NULL,
	"posted_by_member_id" text,
	"posted_by_name" text NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"application_count" integer DEFAULT 0 NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_applications" (
	"id" serial PRIMARY KEY,
	"opportunity_id" integer NOT NULL,
	"lane" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"artist_name" text NOT NULL,
	"age_confirmed" boolean DEFAULT false NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"region" text DEFAULT '' NOT NULL,
	"contact_email" text DEFAULT '' NOT NULL,
	"instagram" text DEFAULT '' NOT NULL,
	"tiktok" text DEFAULT '' NOT NULL,
	"streaming_links" text DEFAULT '' NOT NULL,
	"work_samples" text DEFAULT '' NOT NULL,
	"performance_video" text DEFAULT '' NOT NULL,
	"can_perform" text DEFAULT '' NOT NULL,
	"will_travel" text DEFAULT '' NOT NULL,
	"pitch" text DEFAULT '' NOT NULL,
	"member_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunity_applications" ADD CONSTRAINT "opportunity_applications_opportunity_id_opportunities_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id");