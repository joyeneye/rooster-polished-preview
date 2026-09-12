-- ROSTER LIVE gains a real video broadcast and the lines people type in a room.
--
-- `medium` tells an audio Room apart from a video broadcast so the list, the
-- labels and the viewer can be honest about which experience a member is
-- opening. Existing rooms are audio, which is what they have always been.
ALTER TABLE "live_rooms" ADD COLUMN IF NOT EXISTS "medium" text NOT NULL DEFAULT 'audio';--> statement-breakpoint
ALTER TABLE "live_rooms" ADD COLUMN IF NOT EXISTS "description" text NOT NULL DEFAULT '';--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "live_messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "room_id" integer NOT NULL,
  "member_id" text NOT NULL,
  "name" text DEFAULT '' NOT NULL,
  "photo_url" text DEFAULT '' NOT NULL,
  "body" text NOT NULL,
  "removed" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "live_messages_room_idx" ON "live_messages" ("room_id","created_at");--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "live_messages" ADD CONSTRAINT "live_messages_room_id_live_rooms_id_fkey" FOREIGN KEY ("room_id") REFERENCES "live_rooms"("id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
