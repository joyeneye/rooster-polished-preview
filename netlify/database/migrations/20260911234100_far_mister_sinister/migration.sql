CREATE TABLE "live_moderation_actions" (
	"id" serial PRIMARY KEY,
	"room_id" integer NOT NULL,
	"actor_id" text NOT NULL,
	"target_member_id" text,
	"message_id" integer,
	"action" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"reversed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live_moderators" (
	"id" serial PRIMARY KEY,
	"room_id" integer NOT NULL,
	"member_id" text NOT NULL,
	"assigned_by" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "live_rooms" ADD COLUMN "comments_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX "live_moderation_actions_room_idx" ON "live_moderation_actions" ("room_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "live_moderators_room_member_key" ON "live_moderators" ("room_id","member_id");--> statement-breakpoint
ALTER TABLE "live_moderation_actions" ADD CONSTRAINT "live_moderation_actions_room_id_live_rooms_id_fkey" FOREIGN KEY ("room_id") REFERENCES "live_rooms"("id");--> statement-breakpoint
ALTER TABLE "live_moderators" ADD CONSTRAINT "live_moderators_room_id_live_rooms_id_fkey" FOREIGN KEY ("room_id") REFERENCES "live_rooms"("id");