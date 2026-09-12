CREATE TABLE "live_messages" (
	"id" serial PRIMARY KEY,
	"room_id" integer NOT NULL,
	"member_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"photo_url" text DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"removed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "live_rooms" ADD COLUMN "medium" text DEFAULT 'audio' NOT NULL;--> statement-breakpoint
ALTER TABLE "live_rooms" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "live_messages_room_idx" ON "live_messages" ("room_id","created_at");--> statement-breakpoint
ALTER TABLE "live_messages" ADD CONSTRAINT "live_messages_room_id_live_rooms_id_fkey" FOREIGN KEY ("room_id") REFERENCES "live_rooms"("id");