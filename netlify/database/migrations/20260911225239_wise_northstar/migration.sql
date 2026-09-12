-- The preceding 20260911193000_link_clips_to_wyd migration already adds this
-- column and its unique index. Keep this generated migration idempotent for
-- database branches that replay the complete migration history.
ALTER TABLE "social_posts" ADD COLUMN IF NOT EXISTS "source_clip_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "social_posts_source_clip_id_unique" ON "social_posts" ("source_clip_id");
