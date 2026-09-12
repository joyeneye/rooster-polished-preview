ALTER TABLE "live_rooms" ADD COLUMN IF NOT EXISTS "comments_enabled" boolean DEFAULT true NOT NULL;

CREATE TABLE IF NOT EXISTS "live_moderators" (
  "id" serial PRIMARY KEY NOT NULL,
  "room_id" integer NOT NULL REFERENCES "live_rooms"("id"),
  "member_id" text NOT NULL,
  "assigned_by" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "live_moderators_room_member_key" ON "live_moderators" USING btree ("room_id", "member_id");

CREATE TABLE IF NOT EXISTS "live_moderation_actions" (
  "id" serial PRIMARY KEY NOT NULL,
  "room_id" integer NOT NULL REFERENCES "live_rooms"("id"),
  "actor_id" text NOT NULL,
  "target_member_id" text,
  "message_id" integer,
  "action" text NOT NULL,
  "reason" text DEFAULT '' NOT NULL,
  "reversed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "live_moderation_actions_room_idx" ON "live_moderation_actions" USING btree ("room_id", "created_at");
