CREATE TABLE "social_blocks" (
	"id" serial PRIMARY KEY,
	"blocker_id" text NOT NULL,
	"blocked_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_bookmarks" (
	"id" serial PRIMARY KEY,
	"post_id" integer NOT NULL,
	"member_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_comments" (
	"id" serial PRIMARY KEY,
	"post_id" integer NOT NULL,
	"author_id" text NOT NULL,
	"author_name" text NOT NULL,
	"parent_id" integer,
	"body" text NOT NULL,
	"like_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_connections" (
	"id" serial PRIMARY KEY,
	"requester_id" text NOT NULL,
	"addressee_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "social_feed_preferences" (
	"member_id" text PRIMARY KEY,
	"primary_filter" text DEFAULT 'for_you' NOT NULL,
	"connection_filters" jsonb DEFAULT '["everyone"]' NOT NULL,
	"content_filters" jsonb DEFAULT '[]' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_follows" (
	"id" serial PRIMARY KEY,
	"follower_id" text NOT NULL,
	"followed_id" text NOT NULL,
	"favorite" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_likes" (
	"id" serial PRIMARY KEY,
	"post_id" integer NOT NULL,
	"member_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_mutes" (
	"id" serial PRIMARY KEY,
	"member_id" text NOT NULL,
	"muted_member_id" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_notifications" (
	"id" serial PRIMARY KEY,
	"member_id" text NOT NULL,
	"actor_id" text DEFAULT '' NOT NULL,
	"type" text NOT NULL,
	"post_id" integer,
	"room_id" integer,
	"data" jsonb DEFAULT '{}' NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_post_media" (
	"id" serial PRIMARY KEY,
	"post_id" integer NOT NULL,
	"media_type" text NOT NULL,
	"url" text NOT NULL,
	"thumbnail_url" text DEFAULT '' NOT NULL,
	"alt_text" text DEFAULT '' NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"width" integer DEFAULT 0 NOT NULL,
	"height" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_posts" (
	"id" serial PRIMARY KEY,
	"author_id" text NOT NULL,
	"author_name" text NOT NULL,
	"author_photo_url" text DEFAULT '' NOT NULL,
	"author_kind" text DEFAULT 'member' NOT NULL,
	"content_type" text DEFAULT 'text_post' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"original_post_id" integer,
	"room_id" integer,
	"booking_business_id" integer,
	"booking_service_id" integer,
	"booking_label" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"like_count" integer DEFAULT 0 NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"repost_count" integer DEFAULT 0 NOT NULL,
	"bookmark_count" integer DEFAULT 0 NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"watch_time_ms" integer DEFAULT 0 NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_reports" (
	"id" serial PRIMARY KEY,
	"reporter_id" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"reason" text NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "social_reposts" (
	"id" serial PRIMARY KEY,
	"post_id" integer NOT NULL,
	"member_id" text NOT NULL,
	"quote_post_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "social_blocks_pair_key" ON "social_blocks" ("blocker_id","blocked_id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_bookmarks_post_member_key" ON "social_bookmarks" ("post_id","member_id");--> statement-breakpoint
CREATE INDEX "social_comments_post_idx" ON "social_comments" ("post_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "social_connections_pair_key" ON "social_connections" ("requester_id","addressee_id");--> statement-breakpoint
CREATE INDEX "social_connections_addressee_idx" ON "social_connections" ("addressee_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "social_follows_pair_key" ON "social_follows" ("follower_id","followed_id");--> statement-breakpoint
CREATE INDEX "social_follows_followed_idx" ON "social_follows" ("followed_id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_likes_post_member_key" ON "social_likes" ("post_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_mutes_pair_key" ON "social_mutes" ("member_id","muted_member_id");--> statement-breakpoint
CREATE INDEX "social_notifications_member_idx" ON "social_notifications" ("member_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "social_post_media_post_idx" ON "social_post_media" ("post_id","sort_order");--> statement-breakpoint
CREATE INDEX "social_posts_feed_idx" ON "social_posts" ("status","published_at");--> statement-breakpoint
CREATE INDEX "social_posts_author_idx" ON "social_posts" ("author_id","published_at");--> statement-breakpoint
CREATE INDEX "social_posts_type_idx" ON "social_posts" ("content_type","published_at");--> statement-breakpoint
CREATE INDEX "social_reports_review_idx" ON "social_reports" ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "social_reposts_post_member_key" ON "social_reposts" ("post_id","member_id");--> statement-breakpoint
ALTER TABLE "social_bookmarks" ADD CONSTRAINT "social_bookmarks_post_id_social_posts_id_fkey" FOREIGN KEY ("post_id") REFERENCES "social_posts"("id");--> statement-breakpoint
ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_post_id_social_posts_id_fkey" FOREIGN KEY ("post_id") REFERENCES "social_posts"("id");--> statement-breakpoint
ALTER TABLE "social_likes" ADD CONSTRAINT "social_likes_post_id_social_posts_id_fkey" FOREIGN KEY ("post_id") REFERENCES "social_posts"("id");--> statement-breakpoint
ALTER TABLE "social_notifications" ADD CONSTRAINT "social_notifications_post_id_social_posts_id_fkey" FOREIGN KEY ("post_id") REFERENCES "social_posts"("id");--> statement-breakpoint
ALTER TABLE "social_notifications" ADD CONSTRAINT "social_notifications_room_id_live_rooms_id_fkey" FOREIGN KEY ("room_id") REFERENCES "live_rooms"("id");--> statement-breakpoint
ALTER TABLE "social_post_media" ADD CONSTRAINT "social_post_media_post_id_social_posts_id_fkey" FOREIGN KEY ("post_id") REFERENCES "social_posts"("id");--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_room_id_live_rooms_id_fkey" FOREIGN KEY ("room_id") REFERENCES "live_rooms"("id");--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_booking_business_id_booking_businesses_id_fkey" FOREIGN KEY ("booking_business_id") REFERENCES "booking_businesses"("id");--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_booking_service_id_booking_services_id_fkey" FOREIGN KEY ("booking_service_id") REFERENCES "booking_services"("id");--> statement-breakpoint
ALTER TABLE "social_reposts" ADD CONSTRAINT "social_reposts_post_id_social_posts_id_fkey" FOREIGN KEY ("post_id") REFERENCES "social_posts"("id");--> statement-breakpoint
ALTER TABLE "social_reposts" ADD CONSTRAINT "social_reposts_quote_post_id_social_posts_id_fkey" FOREIGN KEY ("quote_post_id") REFERENCES "social_posts"("id");