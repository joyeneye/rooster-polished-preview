CREATE TABLE "live_participants" (
	"id" serial PRIMARY KEY,
	"room_id" integer NOT NULL,
	"member_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"photo_url" text DEFAULT '' NOT NULL,
	"role" text DEFAULT 'listener' NOT NULL,
	"hand_raised" boolean DEFAULT false NOT NULL,
	"muted" boolean DEFAULT true NOT NULL,
	"session_id" text DEFAULT '' NOT NULL,
	"removed" boolean DEFAULT false NOT NULL,
	"present" boolean DEFAULT true NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live_rooms" (
	"id" serial PRIMARY KEY,
	"room_key" text NOT NULL UNIQUE,
	"title" text NOT NULL,
	"host_id" text NOT NULL,
	"host_name" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'live' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "live_signals" (
	"id" serial PRIMARY KEY,
	"room_id" integer NOT NULL,
	"from_id" text NOT NULL,
	"to_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roster_access" (
	"id" serial PRIMARY KEY,
	"member_id" text NOT NULL UNIQUE,
	"status" text DEFAULT 'pending' NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"invitation_id" integer,
	"invite_code" text DEFAULT '' NOT NULL,
	"grandfathered" boolean DEFAULT false NOT NULL,
	"account_created_at" timestamp with time zone,
	"requested_at" timestamp with time zone,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roster_access_launch" (
	"id" text PRIMARY KEY,
	"launched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roster_invitations" (
	"id" serial PRIMARY KEY,
	"code" text NOT NULL UNIQUE,
	"note" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roster_invite_requests" (
	"id" serial PRIMARY KEY,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"about" text DEFAULT '' NOT NULL,
	"member_id" text,
	"status" text DEFAULT 'waiting' NOT NULL,
	"invitation_id" integer,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "live_participants_room_member_key" ON "live_participants" ("room_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roster_invite_requests_email_key" ON "roster_invite_requests" ("email");--> statement-breakpoint
ALTER TABLE "live_participants" ADD CONSTRAINT "live_participants_room_id_live_rooms_id_fkey" FOREIGN KEY ("room_id") REFERENCES "live_rooms"("id");--> statement-breakpoint
ALTER TABLE "live_signals" ADD CONSTRAINT "live_signals_room_id_live_rooms_id_fkey" FOREIGN KEY ("room_id") REFERENCES "live_rooms"("id");--> statement-breakpoint
ALTER TABLE "roster_access" ADD CONSTRAINT "roster_access_invitation_id_roster_invitations_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "roster_invitations"("id");--> statement-breakpoint
ALTER TABLE "roster_invite_requests" ADD CONSTRAINT "roster_invite_requests_invitation_id_roster_invitations_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "roster_invitations"("id");