// Creator Opportunities. Opportunities are rows people browse and filter, and
// applications are rows the person who posted reads, so both live in Postgres
// rather than in the blob stores that hold ROSTER media.
import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const opportunities = pgTable("opportunities", {
  id: serial().primaryKey(),
  slug: text().notNull().unique(),
  title: text().notNull(),
  headline: text().notNull().default(""),
  description: text().notNull().default(""),
  // Who is posting and who they need, kept as separate slugs so the board can
  // show "Artist looking for producer" and still filter on the role needed.
  posterRole: text("poster_role").notNull(),
  seekingRole: text("seeking_role").notNull(),
  // The lanes an applicant can choose, e.g. Female Rapper / Female R&B Singer.
  lanes: jsonb().$type<string[]>().notNull().default([]),
  genre: text().notNull().default(""),
  city: text().notNull().default(""),
  region: text().notNull().default(""),
  workMode: text("work_mode").notNull().default("either"),
  postedByKind: text("posted_by_kind").notNull().default("member"),
  postedByMemberId: text("posted_by_member_id"),
  postedByName: text("posted_by_name").notNull(),
  featured: boolean().notNull().default(false),
  status: text().notNull().default("open"),
  applicationCount: integer("application_count").notNull().default(0),
  viewCount: integer("view_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const opportunityApplications = pgTable("opportunity_applications", {
  id: serial().primaryKey(),
  opportunityId: integer("opportunity_id").notNull().references(() => opportunities.id),
  lane: text().notNull().default(""),
  name: text().notNull(),
  artistName: text("artist_name").notNull(),
  ageConfirmed: boolean("age_confirmed").notNull().default(false),
  city: text().notNull().default(""),
  region: text().notNull().default(""),
  contactEmail: text("contact_email").notNull().default(""),
  instagram: text().notNull().default(""),
  tiktok: text().notNull().default(""),
  streamingLinks: text("streaming_links").notNull().default(""),
  workSamples: text("work_samples").notNull().default(""),
  performanceVideo: text("performance_video").notNull().default(""),
  canPerform: text("can_perform").notNull().default(""),
  willTravel: text("will_travel").notNull().default(""),
  pitch: text().notNull().default(""),
  // Set when a signed-in member applies. Visitors can apply without an account.
  memberId: text("member_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ROSTER membership levels and Founder announcements. Who is an Early Member,
// who a Founder announcement was sent to and who has read it are all rows that
// get counted, filtered and joined, so they live in Postgres. The announcement
// text a member reads in their inbox is still an ordinary private message in
// the existing message store; these tables record the membership and the
// delivery, never a second copy of the conversation.
export const memberships = pgTable("memberships", {
  id: serial().primaryKey(),
  // Netlify Identity user id. One row per member account.
  memberId: text("member_id").notNull().unique(),
  displayName: text("display_name").notNull().default(""),
  // The member's current level. Early Member is recorded separately because it
  // is a permanent historical fact: an early member who is later made a
  // Founding Member keeps both badges.
  level: text().notNull().default("member"),
  earlyMember: boolean("early_member").notNull().default(false),
  joinedAt: timestamp("joined_at", { withTimezone: true }),
  levelUpdatedAt: timestamp("level_updated_at", { withTimezone: true }),
  levelUpdatedBy: text("level_updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// A single row, written once, the moment the Founder confirms the approval and
// invite system is live. Its presence is what makes Early Member badges public
// and what allows a Founder announcement to be sent at all.
export const membershipLaunch = pgTable("membership_launch", {
  id: text().primaryKey(),
  launchedAt: timestamp("launched_at", { withTimezone: true }).notNull().defaultNow(),
  launchedBy: text("launched_by").notNull(),
  earlyMemberCount: integer("early_member_count").notNull().default(0),
});

export const founderAnnouncements = pgTable("founder_announcements", {
  id: serial().primaryKey(),
  // Stable per-announcement key. The launch announcement uses a fixed slug so
  // running the launch twice can never publish it twice.
  slug: text().notNull().unique(),
  subject: text().notNull(),
  body: text().notNull(),
  authorId: text("author_id").notNull(),
  authorName: text("author_name").notNull().default("J.White Did It"),
  authorTitle: text("author_title").notNull().default("Founder of ROSTER"),
  // everyone | early_members | founding_members | approved_creators | levels | members
  audienceKind: text("audience_kind").notNull(),
  audienceLevels: jsonb("audience_levels").$type<string[]>().notNull().default([]),
  audienceMemberIds: jsonb("audience_member_ids").$type<string[]>().notNull().default([]),
  showAsMessage: boolean("show_as_message").notNull().default(true),
  showAsNotification: boolean("show_as_notification").notNull().default(true),
  showOnHomepage: boolean("show_on_homepage").notNull().default(false),
  recipientCount: integer("recipient_count").notNull().default(0),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per recipient, created when the announcement is sent. The unique
// pair is what makes a repeated deployment or a repeated send a no-op instead
// of a second copy in somebody's messages.
export const announcementDeliveries = pgTable("announcement_deliveries", {
  id: serial().primaryKey(),
  announcementId: integer("announcement_id").notNull().references(() => founderAnnouncements.id),
  memberId: text("member_id").notNull(),
  // The private message id once the announcement has been placed in the
  // member's ordinary ROSTER messages.
  messageId: text("message_id"),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("announcement_deliveries_announcement_member_key").on(table.announcementId, table.memberId)]);

// ROSTER is invite only. An invitation is a code J.White creates; a request is
// somebody asking to be let in. Both are rows that get listed, counted and
// decided on, and the access row is the single thing every server request
// checks before it will hand back anything from inside the community, so all
// three live in Postgres rather than in the blob stores that hold media.
export const rosterInvitations = pgTable("roster_invitations", {
  id: serial().primaryKey(),
  // Human-readable and case-insensitive: always stored upper case.
  code: text().notNull().unique(),
  note: text().notNull().default(""),
  createdBy: text("created_by").notNull(),
  maxUses: integer("max_uses").notNull().default(1),
  uses: integer().notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedBy: text("revoked_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// The waiting list. Somebody asking for an invite lands here and nothing else
// happens: no account, no membership and no access until J.White decides.
export const rosterInviteRequests = pgTable("roster_invite_requests", {
  id: serial().primaryKey(),
  // Stored lower case so one person cannot fill the list with casing variants.
  email: text().notNull(),
  name: text().notNull(),
  about: text().notNull().default(""),
  // Set when somebody who already made an account is the one asking.
  memberId: text("member_id"),
  // waiting | approved | declined
  status: text().notNull().default("waiting"),
  invitationId: integer("invitation_id").references(() => rosterInvitations.id),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("roster_invite_requests_email_key").on(table.email)]);

// One row per ordinary account, and the only thing that decides whether a
// signed-in non-owner can reach profiles, messages, the Chat Room or ROSTER
// LIVE. The verified site owner is the root authority and cannot be locked out
// of their own community by this database.
// pending is the default for every account created after invite only went
// live, so a new account on its own grants nothing at all.
export const rosterAccess = pgTable("roster_access", {
  id: serial().primaryKey(),
  memberId: text("member_id").notNull().unique(),
  // pending | approved | declined
  status: text().notNull().default("pending"),
  displayName: text("display_name").notNull().default(""),
  invitationId: integer("invitation_id").references(() => rosterInvitations.id),
  inviteCode: text("invite_code").notNull().default(""),
  // True for the members who were already here when invite only went live.
  grandfathered: boolean().notNull().default(false),
  accountCreatedAt: timestamp("account_created_at", { withTimezone: true }),
  requestedAt: timestamp("requested_at", { withTimezone: true }),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// The audited invite-only production cutover. Its timestamp is the line
// between "was already a member" and "is a new arrival", so existing members
// keep their access without anybody having to approve them again.
export const rosterAccessLaunch = pgTable("roster_access_launch", {
  id: text().primaryKey(),
  launchedAt: timestamp("launched_at", { withTimezone: true }).notNull().defaultNow(),
});

// ROSTER LIVE. Rooms, who is in them and in which role are all rows that get
// listed, counted and joined, so they are Postgres rows. The audio itself is
// never stored: it travels directly between the people in the room.
export const liveRooms = pgTable("live_rooms", {
  id: serial().primaryKey(),
  roomKey: text("room_key").notNull().unique(),
  title: text().notNull(),
  hostId: text("host_id").notNull(),
  hostName: text("host_name").notNull().default(""),
  // live | ended
  status: text().notNull().default("live"),
  // audio | video. An audio room is ROSTER LIVE Rooms: voice, hands and
  // speakers. A video room is a ROSTER LIVE broadcast: one host on camera and
  // everybody else watching. Both travel over the same direct connections.
  medium: text().notNull().default("audio"),
  // The host's optional line under the title. Empty is the normal case.
  description: text().notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  commentsEnabled: boolean("comments_enabled").notNull().default(true),
});

export const liveParticipants = pgTable("live_participants", {
  id: serial().primaryKey(),
  roomId: integer("room_id").notNull().references(() => liveRooms.id),
  memberId: text("member_id").notNull(),
  name: text().notNull().default(""),
  photoUrl: text("photo_url").notNull().default(""),
  // host | speaker | listener. Everybody arrives as a listener.
  role: text().notNull().default("listener"),
  handRaised: boolean("hand_raised").notNull().default(false),
  // A speaker's microphone is off until they turn it on themselves.
  muted: boolean().notNull().default(true),
  sessionId: text("session_id").notNull().default(""),
  // Set when a host removes somebody. The row stays so they cannot walk back in.
  removed: boolean().notNull().default(false),
  present: boolean().notNull().default(true),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("live_participants_room_member_key").on(table.roomId, table.memberId)]);

// Short-lived connection setup passed between two people in the same room and
// deleted the moment it is delivered. No conversation audio is ever a row.
export const liveSignals = pgTable("live_signals", {
  id: serial().primaryKey(),
  roomId: integer("room_id").notNull().references(() => liveRooms.id),
  fromId: text("from_id").notNull(),
  toId: text("to_id").notNull(),
  // offer | answer | ice | bye
  kind: text().notNull(),
  payload: jsonb().$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// What people type in a room while it is on. Kept so somebody who joins a
// broadcast late can read the last of the conversation, and cleared with the
// room. A host can remove a line; the row stays marked removed so it cannot
// come back on the next read.
export const liveMessages = pgTable("live_messages", {
  id: serial().primaryKey(),
  roomId: integer("room_id").notNull().references(() => liveRooms.id),
  memberId: text("member_id").notNull(),
  name: text().notNull().default(""),
  photoUrl: text("photo_url").notNull().default(""),
  body: text().notNull(),
  removed: boolean().notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("live_messages_room_idx").on(table.roomId, table.createdAt)]);

export const liveModerators = pgTable("live_moderators", {
  id: serial().primaryKey(),
  roomId: integer("room_id").notNull().references(() => liveRooms.id),
  memberId: text("member_id").notNull(),
  assignedBy: text("assigned_by").notNull(),
  active: boolean().notNull().default(true),
  createdAt: timestamp("created_at", {withTimezone:true}).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", {withTimezone:true}).notNull().defaultNow(),
}, table => [uniqueIndex("live_moderators_room_member_key").on(table.roomId, table.memberId)]);

export const liveModerationActions = pgTable("live_moderation_actions", {
  id: serial().primaryKey(),
  roomId: integer("room_id").notNull().references(() => liveRooms.id),
  actorId: text("actor_id").notNull(),
  targetMemberId: text("target_member_id"),
  messageId: integer("message_id"),
  action: text().notNull(),
  reason: text().notNull().default(""),
  reversedAt: timestamp("reversed_at", {withTimezone:true}),
  createdAt: timestamp("created_at", {withTimezone:true}).notNull().defaultNow(),
}, table => [index("live_moderation_actions_room_idx").on(table.roomId, table.createdAt)]);

// REVIEW ROOM is intentionally tenant-first. Every account can own a branded
// room, accept submissions into its own queues and publish reviews from a
// stable public link without sharing data with another room.
export const reviewWorkspaces = pgTable("review_workspaces", {
  id: serial().primaryKey(),
  ownerId: text("owner_id").notNull().unique(),
  slug: text().notNull().unique(),
  name: text().notNull(),
  bio: text().notNull().default(""),
  socialLinks: jsonb("social_links").$type<Record<string, string>>().notNull().default({}),
  currency: text().notNull().default("USD"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reviewReviewers = pgTable("review_reviewers", {
  id: serial().primaryKey(),
  workspaceId: integer("workspace_id").notNull().references(() => reviewWorkspaces.id),
  memberId: text("member_id").notNull(),
  displayName: text("display_name").notNull(),
  status: text().notNull().default("active"),
  isAdmin: boolean("is_admin").notNull().default(false),
  queueRules: jsonb("queue_rules").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("review_reviewers_workspace_member_key").on(table.workspaceId, table.memberId)]);

export const reviewPricingTiers = pgTable("review_pricing_tiers", {
  id: serial().primaryKey(),
  workspaceId: integer("workspace_id").notNull().references(() => reviewWorkspaces.id),
  code: text().notNull(),
  name: text().notNull(),
  description: text().notNull().default(""),
  priceCents: integer("price_cents").notNull().default(0),
  priorityWeight: integer("priority_weight").notNull().default(100),
  guaranteed: boolean().notNull().default(false),
  active: boolean().notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("review_pricing_workspace_code_key").on(table.workspaceId, table.code)]);

export const reviewSubmissions = pgTable("review_submissions", {
  id: serial().primaryKey(),
  publicId: text("public_id").notNull().unique(),
  workspaceId: integer("workspace_id").notNull().references(() => reviewWorkspaces.id),
  artistId: text("artist_id").notNull(),
  artistName: text("artist_name").notNull(),
  title: text().notNull(),
  sourceType: text("source_type").notNull(),
  sourceUrl: text("source_url").notNull().default(""),
  audioKey: text("audio_key").notNull().default(""),
  audioMime: text("audio_mime").notNull().default(""),
  genre: text().notNull().default(""),
  mood: text().notNull().default(""),
  tags: jsonb().$type<string[]>().notNull().default([]),
  songInfo: text("song_info").notNull().default(""),
  socialLinks: jsonb("social_links").$type<Record<string, string>>().notNull().default({}),
  tierCode: text("tier_code").notNull().default("free"),
  priceCents: integer("price_cents").notNull().default(0),
  paymentStatus: text("payment_status").notNull().default("not_required"),
  status: text().notNull().default("queued"),
  featured: boolean().notNull().default(false),
  assignedReviewerId: integer("assigned_reviewer_id").references(() => reviewReviewers.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
});

export const reviewQueueEntries = pgTable("review_queue_entries", {
  id: serial().primaryKey(),
  submissionId: integer("submission_id").notNull().unique().references(() => reviewSubmissions.id),
  workspaceId: integer("workspace_id").notNull().references(() => reviewWorkspaces.id),
  reviewerId: integer("reviewer_id").references(() => reviewReviewers.id),
  queueKey: text("queue_key").notNull().default("standard"),
  priorityScore: integer("priority_score").notNull().default(100),
  status: text().notNull().default("waiting"),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reviewReviews = pgTable("review_reviews", {
  id: serial().primaryKey(),
  submissionId: integer("submission_id").notNull().unique().references(() => reviewSubmissions.id),
  reviewerId: integer("reviewer_id").notNull().references(() => reviewReviewers.id),
  scores: jsonb().$type<Record<string, number>>().notNull().default({}),
  overallScore: integer("overall_score").notNull(),
  feedback: text().notNull(),
  visibility: text().notNull().default("public"),
  decision: text().notNull().default("approved"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
});

export const reviewTransactions = pgTable("review_transactions", {
  id: serial().primaryKey(),
  workspaceId: integer("workspace_id").notNull().references(() => reviewWorkspaces.id),
  submissionId: integer("submission_id").references(() => reviewSubmissions.id),
  artistId: text("artist_id").notNull(),
  kind: text().notNull().default("charge"),
  amountCents: integer("amount_cents").notNull().default(0),
  status: text().notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  settledAt: timestamp("settled_at", { withTimezone: true }),
});

// ROSTER Booking is a multi-tenant marketplace. Every private operational row
// carries business_id, and API handlers authorize that business before queries.
export const bookingPlatformUsers = pgTable("booking_platform_users", {
  id: serial().primaryKey(),
  identityUserId: text("identity_user_id").notNull().unique(),
  email: text().notNull().default(""),
  displayName: text("display_name").notNull().default(""),
  platformRole: text("platform_role").notNull().default("user"),
  status: text().notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bookingCategories = pgTable("booking_categories", {
  id: serial().primaryKey(),
  slug: text().notNull().unique(),
  name: text().notNull(),
  description: text().notNull().default(""),
  icon: text().notNull().default("briefcase"),
  active: boolean().notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bookingPlans = pgTable("booking_plans", {
  id: serial().primaryKey(),
  code: text().notNull().unique(),
  name: text().notNull(),
  description: text().notNull().default(""),
  priceCents: integer("price_cents").notNull().default(0),
  billingInterval: text("billing_interval").notNull().default("month"),
  features: jsonb().$type<Record<string, boolean | number | string>>().notNull().default({}),
  active: boolean().notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bookingBusinesses = pgTable("booking_businesses", {
  id: serial().primaryKey(),
  ownerUserId: integer("owner_user_id").notNull().references(() => bookingPlatformUsers.id),
  categoryId: integer("category_id").references(() => bookingCategories.id),
  slug: text().notNull().unique(),
  name: text().notNull(),
  description: text().notNull().default(""),
  logoUrl: text("logo_url").notNull().default(""),
  coverUrl: text("cover_url").notNull().default(""),
  phone: text().notNull().default(""),
  email: text().notNull().default(""),
  addressLine1: text("address_line_1").notNull().default(""),
  addressLine2: text("address_line_2").notNull().default(""),
  city: text().notNull().default(""),
  region: text().notNull().default(""),
  postalCode: text("postal_code").notNull().default(""),
  country: text().notNull().default("US"),
  timezone: text().notNull().default("America/New_York"),
  currency: text().notNull().default("usd"),
  status: text().notNull().default("active"),
  published: boolean().notNull().default(false),
  featured: boolean().notNull().default(false),
  averageRating: integer("average_rating").notNull().default(0),
  reviewCount: integer("review_count").notNull().default(0),
  theme: jsonb().$type<Record<string, string>>().notNull().default({}),
  socialLinks: jsonb("social_links").$type<Record<string, string>>().notNull().default({}),
  gallery: jsonb().$type<string[]>().notNull().default([]),
  bookingRules: jsonb("booking_rules").$type<Record<string, number | boolean | string>>().notNull().default({}),
  policies: jsonb().$type<Record<string, string>>().notNull().default({}),
  stripeAccountId: text("stripe_account_id").notNull().default(""),
  stripeChargesEnabled: boolean("stripe_charges_enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("booking_businesses_owner_idx").on(table.ownerUserId), index("booking_businesses_discovery_idx").on(table.status, table.published, table.categoryId)]);

export const bookingBusinessMembers = pgTable("booking_business_members", {
  id: serial().primaryKey(),
  businessId: integer("business_id").notNull().references(() => bookingBusinesses.id),
  userId: integer("user_id").notNull().references(() => bookingPlatformUsers.id),
  role: text().notNull().default("staff"),
  permissions: jsonb().$type<string[]>().notNull().default([]),
  status: text().notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("booking_business_members_business_user_key").on(table.businessId, table.userId), index("booking_business_members_user_idx").on(table.userId)]);

export const bookingBusinessHours = pgTable("booking_business_hours", {
  id: serial().primaryKey(),
  businessId: integer("business_id").notNull().references(() => bookingBusinesses.id),
  weekday: integer().notNull(),
  startMinute: integer("start_minute").notNull().default(540),
  endMinute: integer("end_minute").notNull().default(1020),
  closed: boolean().notNull().default(false),
}, table => [uniqueIndex("booking_business_hours_day_key").on(table.businessId, table.weekday)]);

export const bookingStaff = pgTable("booking_staff", {
  id: serial().primaryKey(),
  businessId: integer("business_id").notNull().references(() => bookingBusinesses.id),
  userId: integer("user_id").references(() => bookingPlatformUsers.id),
  name: text().notNull(),
  email: text().notNull().default(""),
  phone: text().notNull().default(""),
  photoUrl: text("photo_url").notNull().default(""),
  bio: text().notNull().default(""),
  role: text().notNull().default("professional"),
  color: text().notNull().default("#ad5d3b"),
  active: boolean().notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("booking_staff_business_idx").on(table.businessId, table.active)]);

export const bookingServices = pgTable("booking_services", {
  id: serial().primaryKey(),
  businessId: integer("business_id").notNull().references(() => bookingBusinesses.id),
  categoryId: integer("category_id").references(() => bookingCategories.id),
  name: text().notNull(),
  description: text().notNull().default(""),
  imageUrl: text("image_url").notNull().default(""),
  priceCents: integer("price_cents").notNull().default(0),
  durationMinutes: integer("duration_minutes").notNull().default(30),
  bufferBeforeMinutes: integer("buffer_before_minutes").notNull().default(0),
  bufferAfterMinutes: integer("buffer_after_minutes").notNull().default(0),
  depositType: text("deposit_type").notNull().default("none"),
  depositValue: integer("deposit_value").notNull().default(0),
  cancellationPolicy: text("cancellation_policy").notNull().default(""),
  onlineBookingEnabled: boolean("online_booking_enabled").notNull().default(true),
  active: boolean().notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("booking_services_business_idx").on(table.businessId, table.active)]);

export const bookingStaffServices = pgTable("booking_staff_services", {
  id: serial().primaryKey(),
  businessId: integer("business_id").notNull().references(() => bookingBusinesses.id),
  staffId: integer("staff_id").notNull().references(() => bookingStaff.id),
  serviceId: integer("service_id").notNull().references(() => bookingServices.id),
}, table => [uniqueIndex("booking_staff_services_key").on(table.staffId, table.serviceId), index("booking_staff_services_business_idx").on(table.businessId)]);

export const bookingAvailabilityRules = pgTable("booking_availability_rules", {
  id: serial().primaryKey(),
  businessId: integer("business_id").notNull().references(() => bookingBusinesses.id),
  staffId: integer("staff_id").references(() => bookingStaff.id),
  weekday: integer().notNull(),
  startMinute: integer("start_minute").notNull(),
  endMinute: integer("end_minute").notNull(),
  validFrom: text("valid_from").notNull().default(""),
  validUntil: text("valid_until").notNull().default(""),
  active: boolean().notNull().default(true),
}, table => [index("booking_availability_rules_lookup_idx").on(table.businessId, table.staffId, table.weekday)]);

export const bookingAvailabilityBlocks = pgTable("booking_availability_blocks", {
  id: serial().primaryKey(),
  businessId: integer("business_id").notNull().references(() => bookingBusinesses.id),
  staffId: integer("staff_id").references(() => bookingStaff.id),
  kind: text().notNull().default("blocked"),
  reason: text().notNull().default(""),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("booking_availability_blocks_lookup_idx").on(table.businessId, table.staffId, table.startsAt, table.endsAt)]);

export const bookingClients = pgTable("booking_clients", {
  id: serial().primaryKey(),
  businessId: integer("business_id").notNull().references(() => bookingBusinesses.id),
  identityUserId: text("identity_user_id"),
  name: text().notNull(),
  email: text().notNull().default(""),
  phone: text().notNull().default(""),
  birthday: text().notNull().default(""),
  notes: text().notNull().default(""),
  tags: jsonb().$type<string[]>().notNull().default([]),
  totalSpendCents: integer("total_spend_cents").notNull().default(0),
  appointmentCount: integer("appointment_count").notNull().default(0),
  noShowCount: integer("no_show_count").notNull().default(0),
  lastAppointmentAt: timestamp("last_appointment_at", { withTimezone: true }),
  nextAppointmentAt: timestamp("next_appointment_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("booking_clients_business_idx").on(table.businessId), index("booking_clients_identity_idx").on(table.identityUserId)]);

export const bookingAppointments = pgTable("booking_appointments", {
  id: serial().primaryKey(),
  publicId: text("public_id").notNull().unique(),
  confirmationCode: text("confirmation_code").notNull().unique(),
  businessId: integer("business_id").notNull().references(() => bookingBusinesses.id),
  serviceId: integer("service_id").notNull().references(() => bookingServices.id),
  staffId: integer("staff_id").notNull().references(() => bookingStaff.id),
  clientId: integer("client_id").notNull().references(() => bookingClients.id),
  status: text().notNull().default("confirmed"),
  source: text().notNull().default("online"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  priceCents: integer("price_cents").notNull().default(0),
  depositCents: integer("deposit_cents").notNull().default(0),
  notes: text().notNull().default(""),
  privateNotes: text("private_notes").notNull().default(""),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancellationReason: text("cancellation_reason").notNull().default(""),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("booking_appointments_business_time_idx").on(table.businessId, table.startsAt), index("booking_appointments_staff_time_idx").on(table.staffId, table.startsAt, table.endsAt), index("booking_appointments_client_idx").on(table.businessId, table.clientId)]);

export const bookingPayments = pgTable("booking_payments", {
  id: serial().primaryKey(),
  businessId: integer("business_id").notNull().references(() => bookingBusinesses.id),
  appointmentId: integer("appointment_id").references(() => bookingAppointments.id),
  clientId: integer("client_id").references(() => bookingClients.id),
  provider: text().notNull().default("stripe"),
  providerPaymentId: text("provider_payment_id").notNull().default(""),
  kind: text().notNull().default("charge"),
  status: text().notNull().default("pending"),
  amountCents: integer("amount_cents").notNull().default(0),
  tipCents: integer("tip_cents").notNull().default(0),
  platformFeeCents: integer("platform_fee_cents").notNull().default(0),
  providerNetCents: integer("provider_net_cents").notNull().default(0),
  currency: text().notNull().default("usd"),
  metadata: jsonb().$type<Record<string, string>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("booking_payments_business_idx").on(table.businessId, table.createdAt), index("booking_payments_provider_idx").on(table.providerPaymentId)]);

export const bookingReviews = pgTable("booking_reviews", {
  id: serial().primaryKey(),
  businessId: integer("business_id").notNull().references(() => bookingBusinesses.id),
  appointmentId: integer("appointment_id").notNull().unique().references(() => bookingAppointments.id),
  clientId: integer("client_id").notNull().references(() => bookingClients.id),
  rating: integer().notNull(),
  body: text().notNull().default(""),
  photos: jsonb().$type<string[]>().notNull().default([]),
  providerResponse: text("provider_response").notNull().default(""),
  status: text().notNull().default("published"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
}, table => [index("booking_reviews_business_idx").on(table.businessId, table.status)]);

export const bookingFavorites = pgTable("booking_favorites", {
  id: serial().primaryKey(),
  identityUserId: text("identity_user_id").notNull(),
  businessId: integer("business_id").notNull().references(() => bookingBusinesses.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("booking_favorites_user_business_key").on(table.identityUserId, table.businessId)]);

export const bookingSubscriptions = pgTable("booking_subscriptions", {
  id: serial().primaryKey(),
  businessId: integer("business_id").notNull().unique().references(() => bookingBusinesses.id),
  planId: integer("plan_id").notNull().references(() => bookingPlans.id),
  providerSubscriptionId: text("provider_subscription_id").notNull().default(""),
  status: text().notNull().default("active"),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bookingPromotions = pgTable("booking_promotions", {
  id: serial().primaryKey(),
  businessId: integer("business_id").notNull().references(() => bookingBusinesses.id),
  code: text().notNull(),
  name: text().notNull(),
  discountType: text("discount_type").notNull().default("percent"),
  discountValue: integer("discount_value").notNull().default(0),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  usageLimit: integer("usage_limit").notNull().default(0),
  usageCount: integer("usage_count").notNull().default(0),
  active: boolean().notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("booking_promotions_business_code_key").on(table.businessId, table.code)]);

export const bookingNotifications = pgTable("booking_notifications", {
  id: serial().primaryKey(),
  businessId: integer("business_id").references(() => bookingBusinesses.id),
  identityUserId: text("identity_user_id"),
  appointmentId: integer("appointment_id").references(() => bookingAppointments.id),
  channel: text().notNull().default("in_app"),
  template: text().notNull(),
  recipient: text().notNull().default(""),
  subject: text().notNull().default(""),
  body: text().notNull().default(""),
  data: jsonb().$type<Record<string, string | number | boolean>>().notNull().default({}),
  status: text().notNull().default("pending"),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  readAt: timestamp("read_at", { withTimezone: true }),
  attempts: integer().notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("booking_notifications_dispatch_idx").on(table.status, table.scheduledFor), index("booking_notifications_business_idx").on(table.businessId)]);

export const bookingPlatformSettings = pgTable("booking_platform_settings", {
  key: text().primaryKey(),
  value: jsonb().$type<Record<string, string | number | boolean>>().notNull().default({}),
  updatedBy: text("updated_by").notNull().default("system"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bookingReports = pgTable("booking_reports", {
  id: serial().primaryKey(),
  businessId: integer("business_id").references(() => bookingBusinesses.id),
  reporterUserId: text("reporter_user_id").notNull().default(""),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  reason: text().notNull(),
  details: text().notNull().default(""),
  status: text().notNull().default("open"),
  resolution: text().notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const socialPosts = pgTable("social_posts", {
  id: serial().primaryKey(),
  sourceClipId: text("source_clip_id").unique(),
  authorId: text("author_id").notNull(),
  authorName: text("author_name").notNull(),
  authorPhotoUrl: text("author_photo_url").notNull().default(""),
  authorKind: text("author_kind").notNull().default("member"),
  contentType: text("content_type").notNull().default("text_post"),
  body: text().notNull().default(""),
  visibility: text().notNull().default("public"),
  originalPostId: integer("original_post_id"),
  roomId: integer("room_id").references(() => liveRooms.id),
  bookingBusinessId: integer("booking_business_id").references(() => bookingBusinesses.id),
  bookingServiceId: integer("booking_service_id").references(() => bookingServices.id),
  bookingLabel: text("booking_label").notNull().default(""),
  metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  likeCount: integer("like_count").notNull().default(0),
  commentCount: integer("comment_count").notNull().default(0),
  repostCount: integer("repost_count").notNull().default(0),
  bookmarkCount: integer("bookmark_count").notNull().default(0),
  viewCount: integer("view_count").notNull().default(0),
  watchTimeMs: integer("watch_time_ms").notNull().default(0),
  featured: boolean().notNull().default(false),
  status: text().notNull().default("published"),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("social_posts_feed_idx").on(table.status, table.publishedAt),
  index("social_posts_author_idx").on(table.authorId, table.publishedAt),
  index("social_posts_type_idx").on(table.contentType, table.publishedAt),
]);

export const socialPostMedia = pgTable("social_post_media", {
  id: serial().primaryKey(),
  postId: integer("post_id").notNull().references(() => socialPosts.id),
  mediaType: text("media_type").notNull(),
  url: text().notNull(),
  thumbnailUrl: text("thumbnail_url").notNull().default(""),
  altText: text("alt_text").notNull().default(""),
  durationMs: integer("duration_ms").notNull().default(0),
  width: integer().notNull().default(0),
  height: integer().notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
  metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("social_post_media_post_idx").on(table.postId, table.sortOrder)]);

export const socialComments = pgTable("social_comments", {
  id: serial().primaryKey(),
  postId: integer("post_id").notNull().references(() => socialPosts.id),
  authorId: text("author_id").notNull(),
  authorName: text("author_name").notNull(),
  parentId: integer("parent_id"),
  body: text().notNull(),
  likeCount: integer("like_count").notNull().default(0),
  status: text().notNull().default("published"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("social_comments_post_idx").on(table.postId, table.createdAt)]);

export const socialLikes = pgTable("social_likes", {
  id: serial().primaryKey(),
  postId: integer("post_id").notNull().references(() => socialPosts.id),
  memberId: text("member_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("social_likes_post_member_key").on(table.postId, table.memberId)]);

export const socialReposts = pgTable("social_reposts", {
  id: serial().primaryKey(),
  postId: integer("post_id").notNull().references(() => socialPosts.id),
  memberId: text("member_id").notNull(),
  quotePostId: integer("quote_post_id").references(() => socialPosts.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("social_reposts_post_member_key").on(table.postId, table.memberId)]);

export const socialBookmarks = pgTable("social_bookmarks", {
  id: serial().primaryKey(),
  postId: integer("post_id").notNull().references(() => socialPosts.id),
  memberId: text("member_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("social_bookmarks_post_member_key").on(table.postId, table.memberId)]);

export const socialFollows = pgTable("social_follows", {
  id: serial().primaryKey(),
  followerId: text("follower_id").notNull(),
  followedId: text("followed_id").notNull(),
  favorite: boolean().notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("social_follows_pair_key").on(table.followerId, table.followedId), index("social_follows_followed_idx").on(table.followedId)]);

export const socialConnections = pgTable("social_connections", {
  id: serial().primaryKey(),
  requesterId: text("requester_id").notNull(),
  addresseeId: text("addressee_id").notNull(),
  status: text().notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
}, table => [uniqueIndex("social_connections_pair_key").on(table.requesterId, table.addresseeId), index("social_connections_addressee_idx").on(table.addresseeId, table.status)]);

export const socialBlocks = pgTable("social_blocks", {
  id: serial().primaryKey(),
  blockerId: text("blocker_id").notNull(),
  blockedId: text("blocked_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("social_blocks_pair_key").on(table.blockerId, table.blockedId)]);

export const socialMutes = pgTable("social_mutes", {
  id: serial().primaryKey(),
  memberId: text("member_id").notNull(),
  mutedMemberId: text("muted_member_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("social_mutes_pair_key").on(table.memberId, table.mutedMemberId)]);

export const socialFeedPreferences = pgTable("social_feed_preferences", {
  memberId: text("member_id").primaryKey(),
  primaryFilter: text("primary_filter").notNull().default("for_you"),
  connectionFilters: jsonb("connection_filters").$type<string[]>().notNull().default(["everyone"]),
  contentFilters: jsonb("content_filters").$type<string[]>().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const socialNotifications = pgTable("social_notifications", {
  id: serial().primaryKey(),
  memberId: text("member_id").notNull(),
  actorId: text("actor_id").notNull().default(""),
  type: text().notNull(),
  postId: integer("post_id").references(() => socialPosts.id),
  roomId: integer("room_id").references(() => liveRooms.id),
  data: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("social_notifications_member_idx").on(table.memberId, table.readAt, table.createdAt)]);

export const socialReports = pgTable("social_reports", {
  id: serial().primaryKey(),
  reporterId: text("reporter_id").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  reason: text().notNull(),
  details: text().notNull().default(""),
  status: text().notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, table => [index("social_reports_review_idx").on(table.status, table.createdAt)]);

// RCM keeps a member's music-business identity separate from flexible business
// records. The record table supports songs, people, documents, releases, shows,
// tasks and creative projects while preserving a shared relationship key.
export const rcmProfiles = pgTable("rcm_profiles", {
  memberId: text("member_id").primaryKey(),
  artistName: text("artist_name").notNull().default(""),
  realName: text("real_name").notNull().default(""),
  roles: jsonb().$type<string[]>().notNull().default([]),
  genre: text().notNull().default(""),
  location: text().notNull().default(""),
  proAffiliation: text("pro_affiliation").notNull().default(""),
  distributor: text().notNull().default(""),
  managementStatus: text("management_status").notNull().default("Independent"),
  publishingStatus: text("publishing_status").notNull().default("Needs review"),
  onboardingComplete: boolean("onboarding_complete").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rcmRecords = pgTable("rcm_records", {
  id: serial().primaryKey(),
  memberId: text("member_id").notNull(),
  kind: text().notNull(),
  title: text().notNull(),
  status: text().notNull().default("draft"),
  relationKey: text("relation_key").notNull().default(""),
  data: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  dueAt: timestamp("due_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("rcm_records_member_kind_idx").on(table.memberId, table.kind, table.updatedAt),
  index("rcm_records_relation_idx").on(table.memberId, table.relationKey),
]);

export const rcmAiMessages = pgTable("rcm_ai_messages", {
  id: serial().primaryKey(),
  memberId: text("member_id").notNull(),
  role: text().notNull(),
  content: text().notNull(),
  action: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("rcm_ai_messages_member_idx").on(table.memberId, table.createdAt)]);
