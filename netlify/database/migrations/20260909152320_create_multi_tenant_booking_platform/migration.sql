CREATE TABLE "booking_appointments" (
	"id" serial PRIMARY KEY,
	"public_id" text NOT NULL UNIQUE,
	"confirmation_code" text NOT NULL UNIQUE,
	"business_id" integer NOT NULL,
	"service_id" integer NOT NULL,
	"staff_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"source" text DEFAULT 'online' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"deposit_cents" integer DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"private_notes" text DEFAULT '' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text DEFAULT '' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_availability_blocks" (
	"id" serial PRIMARY KEY,
	"business_id" integer NOT NULL,
	"staff_id" integer,
	"kind" text DEFAULT 'blocked' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_availability_rules" (
	"id" serial PRIMARY KEY,
	"business_id" integer NOT NULL,
	"staff_id" integer,
	"weekday" integer NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	"valid_from" text DEFAULT '' NOT NULL,
	"valid_until" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_business_hours" (
	"id" serial PRIMARY KEY,
	"business_id" integer NOT NULL,
	"weekday" integer NOT NULL,
	"start_minute" integer DEFAULT 540 NOT NULL,
	"end_minute" integer DEFAULT 1020 NOT NULL,
	"closed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_business_members" (
	"id" serial PRIMARY KEY,
	"business_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" text DEFAULT 'staff' NOT NULL,
	"permissions" jsonb DEFAULT '[]' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_businesses" (
	"id" serial PRIMARY KEY,
	"owner_user_id" integer NOT NULL,
	"category_id" integer,
	"slug" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"logo_url" text DEFAULT '' NOT NULL,
	"cover_url" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"address_line_1" text DEFAULT '' NOT NULL,
	"address_line_2" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"region" text DEFAULT '' NOT NULL,
	"postal_code" text DEFAULT '' NOT NULL,
	"country" text DEFAULT 'US' NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"average_rating" integer DEFAULT 0 NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"theme" jsonb DEFAULT '{}' NOT NULL,
	"social_links" jsonb DEFAULT '{}' NOT NULL,
	"gallery" jsonb DEFAULT '[]' NOT NULL,
	"booking_rules" jsonb DEFAULT '{}' NOT NULL,
	"policies" jsonb DEFAULT '{}' NOT NULL,
	"stripe_account_id" text DEFAULT '' NOT NULL,
	"stripe_charges_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_categories" (
	"id" serial PRIMARY KEY,
	"slug" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"icon" text DEFAULT 'briefcase' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_clients" (
	"id" serial PRIMARY KEY,
	"business_id" integer NOT NULL,
	"identity_user_id" text,
	"name" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"birthday" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"tags" jsonb DEFAULT '[]' NOT NULL,
	"total_spend_cents" integer DEFAULT 0 NOT NULL,
	"appointment_count" integer DEFAULT 0 NOT NULL,
	"no_show_count" integer DEFAULT 0 NOT NULL,
	"last_appointment_at" timestamp with time zone,
	"next_appointment_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_favorites" (
	"id" serial PRIMARY KEY,
	"identity_user_id" text NOT NULL,
	"business_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_notifications" (
	"id" serial PRIMARY KEY,
	"business_id" integer,
	"identity_user_id" text,
	"appointment_id" integer,
	"channel" text DEFAULT 'in_app' NOT NULL,
	"template" text NOT NULL,
	"recipient" text DEFAULT '' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"data" jsonb DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_payments" (
	"id" serial PRIMARY KEY,
	"business_id" integer NOT NULL,
	"appointment_id" integer,
	"client_id" integer,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"provider_payment_id" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'charge' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"tip_cents" integer DEFAULT 0 NOT NULL,
	"platform_fee_cents" integer DEFAULT 0 NOT NULL,
	"provider_net_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_plans" (
	"id" serial PRIMARY KEY,
	"code" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"billing_interval" text DEFAULT 'month' NOT NULL,
	"features" jsonb DEFAULT '{}' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_platform_settings" (
	"key" text PRIMARY KEY,
	"value" jsonb DEFAULT '{}' NOT NULL,
	"updated_by" text DEFAULT 'system' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_platform_users" (
	"id" serial PRIMARY KEY,
	"identity_user_id" text NOT NULL UNIQUE,
	"email" text DEFAULT '' NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"platform_role" text DEFAULT 'user' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_promotions" (
	"id" serial PRIMARY KEY,
	"business_id" integer NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"discount_type" text DEFAULT 'percent' NOT NULL,
	"discount_value" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"usage_limit" integer DEFAULT 0 NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_reports" (
	"id" serial PRIMARY KEY,
	"business_id" integer,
	"reporter_user_id" text DEFAULT '' NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"reason" text NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "booking_reviews" (
	"id" serial PRIMARY KEY,
	"business_id" integer NOT NULL,
	"appointment_id" integer NOT NULL UNIQUE,
	"client_id" integer NOT NULL,
	"rating" integer NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"photos" jsonb DEFAULT '[]' NOT NULL,
	"provider_response" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "booking_services" (
	"id" serial PRIMARY KEY,
	"business_id" integer NOT NULL,
	"category_id" integer,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"image_url" text DEFAULT '' NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"duration_minutes" integer DEFAULT 30 NOT NULL,
	"buffer_before_minutes" integer DEFAULT 0 NOT NULL,
	"buffer_after_minutes" integer DEFAULT 0 NOT NULL,
	"deposit_type" text DEFAULT 'none' NOT NULL,
	"deposit_value" integer DEFAULT 0 NOT NULL,
	"cancellation_policy" text DEFAULT '' NOT NULL,
	"online_booking_enabled" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_staff" (
	"id" serial PRIMARY KEY,
	"business_id" integer NOT NULL,
	"user_id" integer,
	"name" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"photo_url" text DEFAULT '' NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"role" text DEFAULT 'professional' NOT NULL,
	"color" text DEFAULT '#ad5d3b' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_staff_services" (
	"id" serial PRIMARY KEY,
	"business_id" integer NOT NULL,
	"staff_id" integer NOT NULL,
	"service_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_subscriptions" (
	"id" serial PRIMARY KEY,
	"business_id" integer NOT NULL UNIQUE,
	"plan_id" integer NOT NULL,
	"provider_subscription_id" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "booking_appointments_business_time_idx" ON "booking_appointments" ("business_id","starts_at");--> statement-breakpoint
CREATE INDEX "booking_appointments_staff_time_idx" ON "booking_appointments" ("staff_id","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "booking_appointments_client_idx" ON "booking_appointments" ("business_id","client_id");--> statement-breakpoint
CREATE INDEX "booking_availability_blocks_lookup_idx" ON "booking_availability_blocks" ("business_id","staff_id","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "booking_availability_rules_lookup_idx" ON "booking_availability_rules" ("business_id","staff_id","weekday");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_business_hours_day_key" ON "booking_business_hours" ("business_id","weekday");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_business_members_business_user_key" ON "booking_business_members" ("business_id","user_id");--> statement-breakpoint
CREATE INDEX "booking_business_members_user_idx" ON "booking_business_members" ("user_id");--> statement-breakpoint
CREATE INDEX "booking_businesses_owner_idx" ON "booking_businesses" ("owner_user_id");--> statement-breakpoint
CREATE INDEX "booking_businesses_discovery_idx" ON "booking_businesses" ("status","published","category_id");--> statement-breakpoint
CREATE INDEX "booking_clients_business_idx" ON "booking_clients" ("business_id");--> statement-breakpoint
CREATE INDEX "booking_clients_identity_idx" ON "booking_clients" ("identity_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_favorites_user_business_key" ON "booking_favorites" ("identity_user_id","business_id");--> statement-breakpoint
CREATE INDEX "booking_notifications_dispatch_idx" ON "booking_notifications" ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "booking_notifications_business_idx" ON "booking_notifications" ("business_id");--> statement-breakpoint
CREATE INDEX "booking_payments_business_idx" ON "booking_payments" ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "booking_payments_provider_idx" ON "booking_payments" ("provider_payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_promotions_business_code_key" ON "booking_promotions" ("business_id","code");--> statement-breakpoint
CREATE INDEX "booking_reviews_business_idx" ON "booking_reviews" ("business_id","status");--> statement-breakpoint
CREATE INDEX "booking_services_business_idx" ON "booking_services" ("business_id","active");--> statement-breakpoint
CREATE INDEX "booking_staff_business_idx" ON "booking_staff" ("business_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_staff_services_key" ON "booking_staff_services" ("staff_id","service_id");--> statement-breakpoint
CREATE INDEX "booking_staff_services_business_idx" ON "booking_staff_services" ("business_id");--> statement-breakpoint
ALTER TABLE "booking_appointments" ADD CONSTRAINT "booking_appointments_business_id_booking_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "booking_businesses"("id");--> statement-breakpoint
ALTER TABLE "booking_appointments" ADD CONSTRAINT "booking_appointments_service_id_booking_services_id_fkey" FOREIGN KEY ("service_id") REFERENCES "booking_services"("id");--> statement-breakpoint
ALTER TABLE "booking_appointments" ADD CONSTRAINT "booking_appointments_staff_id_booking_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "booking_staff"("id");--> statement-breakpoint
ALTER TABLE "booking_appointments" ADD CONSTRAINT "booking_appointments_client_id_booking_clients_id_fkey" FOREIGN KEY ("client_id") REFERENCES "booking_clients"("id");--> statement-breakpoint
ALTER TABLE "booking_availability_blocks" ADD CONSTRAINT "booking_availability_blocks_S3Kxt06gR8Ws_fkey" FOREIGN KEY ("business_id") REFERENCES "booking_businesses"("id");--> statement-breakpoint
ALTER TABLE "booking_availability_blocks" ADD CONSTRAINT "booking_availability_blocks_staff_id_booking_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "booking_staff"("id");--> statement-breakpoint
ALTER TABLE "booking_availability_rules" ADD CONSTRAINT "booking_availability_rules_RXjsUB4eqDY5_fkey" FOREIGN KEY ("business_id") REFERENCES "booking_businesses"("id");--> statement-breakpoint
ALTER TABLE "booking_availability_rules" ADD CONSTRAINT "booking_availability_rules_staff_id_booking_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "booking_staff"("id");--> statement-breakpoint
ALTER TABLE "booking_business_hours" ADD CONSTRAINT "booking_business_hours_business_id_booking_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "booking_businesses"("id");--> statement-breakpoint
ALTER TABLE "booking_business_members" ADD CONSTRAINT "booking_business_members_business_id_booking_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "booking_businesses"("id");--> statement-breakpoint
ALTER TABLE "booking_business_members" ADD CONSTRAINT "booking_business_members_user_id_booking_platform_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "booking_platform_users"("id");--> statement-breakpoint
ALTER TABLE "booking_businesses" ADD CONSTRAINT "booking_businesses_owner_user_id_booking_platform_users_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "booking_platform_users"("id");--> statement-breakpoint
ALTER TABLE "booking_businesses" ADD CONSTRAINT "booking_businesses_category_id_booking_categories_id_fkey" FOREIGN KEY ("category_id") REFERENCES "booking_categories"("id");--> statement-breakpoint
ALTER TABLE "booking_clients" ADD CONSTRAINT "booking_clients_business_id_booking_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "booking_businesses"("id");--> statement-breakpoint
ALTER TABLE "booking_favorites" ADD CONSTRAINT "booking_favorites_business_id_booking_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "booking_businesses"("id");--> statement-breakpoint
ALTER TABLE "booking_notifications" ADD CONSTRAINT "booking_notifications_business_id_booking_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "booking_businesses"("id");--> statement-breakpoint
ALTER TABLE "booking_notifications" ADD CONSTRAINT "booking_notifications_wStOiACsRCF1_fkey" FOREIGN KEY ("appointment_id") REFERENCES "booking_appointments"("id");--> statement-breakpoint
ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_business_id_booking_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "booking_businesses"("id");--> statement-breakpoint
ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_appointment_id_booking_appointments_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "booking_appointments"("id");--> statement-breakpoint
ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_client_id_booking_clients_id_fkey" FOREIGN KEY ("client_id") REFERENCES "booking_clients"("id");--> statement-breakpoint
ALTER TABLE "booking_promotions" ADD CONSTRAINT "booking_promotions_business_id_booking_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "booking_businesses"("id");--> statement-breakpoint
ALTER TABLE "booking_reports" ADD CONSTRAINT "booking_reports_business_id_booking_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "booking_businesses"("id");--> statement-breakpoint
ALTER TABLE "booking_reviews" ADD CONSTRAINT "booking_reviews_business_id_booking_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "booking_businesses"("id");--> statement-breakpoint
ALTER TABLE "booking_reviews" ADD CONSTRAINT "booking_reviews_appointment_id_booking_appointments_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "booking_appointments"("id");--> statement-breakpoint
ALTER TABLE "booking_reviews" ADD CONSTRAINT "booking_reviews_client_id_booking_clients_id_fkey" FOREIGN KEY ("client_id") REFERENCES "booking_clients"("id");--> statement-breakpoint
ALTER TABLE "booking_services" ADD CONSTRAINT "booking_services_business_id_booking_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "booking_businesses"("id");--> statement-breakpoint
ALTER TABLE "booking_services" ADD CONSTRAINT "booking_services_category_id_booking_categories_id_fkey" FOREIGN KEY ("category_id") REFERENCES "booking_categories"("id");--> statement-breakpoint
ALTER TABLE "booking_staff" ADD CONSTRAINT "booking_staff_business_id_booking_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "booking_businesses"("id");--> statement-breakpoint
ALTER TABLE "booking_staff" ADD CONSTRAINT "booking_staff_user_id_booking_platform_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "booking_platform_users"("id");--> statement-breakpoint
ALTER TABLE "booking_staff_services" ADD CONSTRAINT "booking_staff_services_business_id_booking_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "booking_businesses"("id");--> statement-breakpoint
ALTER TABLE "booking_staff_services" ADD CONSTRAINT "booking_staff_services_staff_id_booking_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "booking_staff"("id");--> statement-breakpoint
ALTER TABLE "booking_staff_services" ADD CONSTRAINT "booking_staff_services_service_id_booking_services_id_fkey" FOREIGN KEY ("service_id") REFERENCES "booking_services"("id");--> statement-breakpoint
ALTER TABLE "booking_subscriptions" ADD CONSTRAINT "booking_subscriptions_business_id_booking_businesses_id_fkey" FOREIGN KEY ("business_id") REFERENCES "booking_businesses"("id");--> statement-breakpoint
ALTER TABLE "booking_subscriptions" ADD CONSTRAINT "booking_subscriptions_plan_id_booking_plans_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "booking_plans"("id");--> statement-breakpoint
ALTER TABLE "booking_services" ADD CONSTRAINT "booking_services_price_check" CHECK ("price_cents" >= 0 AND "duration_minutes" > 0);
--> statement-breakpoint
ALTER TABLE "booking_appointments" ADD CONSTRAINT "booking_appointments_time_check" CHECK ("ends_at" > "starts_at");
--> statement-breakpoint
ALTER TABLE "booking_availability_blocks" ADD CONSTRAINT "booking_availability_blocks_time_check" CHECK ("ends_at" > "starts_at");
--> statement-breakpoint
ALTER TABLE "booking_reviews" ADD CONSTRAINT "booking_reviews_rating_check" CHECK ("rating" BETWEEN 1 AND 5);
--> statement-breakpoint
INSERT INTO "booking_categories" ("slug", "name", "description", "icon", "sort_order") VALUES
('barbers', 'Barbers', 'Cuts, shaves, grooming, and barber services.', 'scissors', 10),
('hair-stylists', 'Hair Stylists', 'Hair styling, coloring, treatments, and extensions.', 'sparkles', 20),
('nails', 'Nail Technicians', 'Manicures, pedicures, nail art, and enhancements.', 'hand', 30),
('tattoo', 'Tattoo Artists', 'Custom tattoo consultations and sessions.', 'pen-tool', 40),
('massage', 'Massage Therapists', 'Massage, bodywork, and recovery services.', 'waves', 50),
('makeup', 'Makeup Artists', 'Event, bridal, editorial, and beauty makeup.', 'palette', 60),
('fitness', 'Personal Trainers', 'Personal training, coaching, and movement sessions.', 'activity', 70),
('photography', 'Photographers', 'Portrait, event, commercial, and creative sessions.', 'camera', 80),
('auto-detailing', 'Auto Detailers', 'Interior and exterior vehicle detailing.', 'car', 90),
('pet-grooming', 'Pet Groomers', 'Pet grooming, bathing, styling, and care.', 'paw-print', 100),
('cleaning', 'Cleaning Services', 'Home, office, and specialty cleaning.', 'home', 110),
('wellness', 'Wellness', 'Holistic care, coaching, and wellness services.', 'heart', 120),
('professional-services', 'Professional Services', 'Consulting and appointment-based professional work.', 'briefcase', 130)
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint
INSERT INTO "booking_plans" ("code", "name", "description", "price_cents", "features", "sort_order") VALUES
('free', 'Free', 'Start accepting appointments with one professional.', 0, '{"maxServices":5,"maxStaff":1,"maxBookings":100,"maxClients":250,"analytics":false,"customBranding":false,"payments":false,"promotions":false,"automatedReminders":false,"customDomain":false}'::jsonb, 10),
('pro', 'Pro', 'Automation and growth tools for independent professionals.', 2900, '{"maxServices":50,"maxStaff":5,"maxBookings":2000,"maxClients":10000,"analytics":true,"customBranding":true,"payments":true,"promotions":true,"automatedReminders":true,"customDomain":false}'::jsonb, 20),
('business', 'Business', 'Multi-staff operations with advanced controls.', 7900, '{"maxServices":500,"maxStaff":50,"maxBookings":100000,"maxClients":1000000,"analytics":true,"customBranding":true,"payments":true,"promotions":true,"automatedReminders":true,"customDomain":true}'::jsonb, 30)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "booking_platform_settings" ("key", "value", "updated_by") VALUES
('payments', '{"platformFeeBasisPoints":500,"currency":"usd"}'::jsonb, 'system'),
('marketplace', '{"providerApprovalRequired":false,"reviewsRequireCompletedBooking":true}'::jsonb, 'system')
ON CONFLICT ("key") DO NOTHING;
