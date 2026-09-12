ALTER TABLE "social_posts" ADD COLUMN IF NOT EXISTS "source_clip_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "social_posts_source_clip_id_unique" ON "social_posts" ("source_clip_id");
