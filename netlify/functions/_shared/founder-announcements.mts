/** Founder announcements. One message the Founder writes once, delivered to a
 * chosen part of the membership as a ROOSTER message, a notification, a
 * homepage announcement, or all three. Only the Founder and an administrator
 * the Founder specifically authorizes can send one; ordinary members have no
 * path to a mass announcement at all. Delivery rows are unique per recipient,
 * so a deployment that runs twice, a retried send and two simultaneous logins
 * all leave exactly one copy in somebody's messages. */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../../../db/index.js";
import { announcementDeliveries, founderAnnouncements, memberships } from "../../../db/schema.js";
import { MEMBER_ID, MemberError, memberJSON, type Member } from "./member-auth.mts";
import { ANNOUNCEMENT_SLUG, deliverFounderAnnouncement, type MemberStores } from "./member-messages.mts";
import type { ProfileMember, ProfileStore } from "./member-profiles.mts";
import { MEMBERSHIP_LEVELS, isMembershipLevel, membershipLaunchRecord, type MembershipLevel } from "./roster-membership.mts";

export const FOUNDER_NAME = "J.White Did It";
export const FOUNDER_TITLE = "Founder of ROOSTER";
export const LAUNCH_SLUG = "jspace-early-member-launch-v1";

export const AUDIENCE_KINDS = [
  { value: "everyone", label: "Everyone" },
  { value: "early_members", label: "Early Members" },
  { value: "founding_members", label: "Founding Members" },
  { value: "approved_creators", label: "Approved Creators" },
  { value: "levels", label: "Specific membership levels" },
  { value: "members", label: "Selected individual members" },
] as const;

export type AudienceKind = (typeof AUDIENCE_KINDS)[number]["value"];
export type AnnouncementDraft = {
  slug: string; subject: string; body: string;
  audience: { kind: AudienceKind; levels: MembershipLevel[]; member_ids: string[] };
  surfaces: { message: boolean; notification: boolean; homepage: boolean };
};

// Tab, newline and carriage return are the only control characters an
// announcement may contain.
const BAD_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const MAX_INDIVIDUAL_RECIPIENTS = 200;
const MAX_AUDIENCE = 10000;

/** The message to current ROOSTER members, exactly as the Founder wrote it. It
 * describes inviting people as something coming later, because invitations are
 * not switched on for existing members at launch. */
export const LAUNCH_ANNOUNCEMENT = Object.freeze({
  slug: LAUNCH_SLUG,
  subject: "A message from J.White Did It, Founder of ROOSTER",
  body: [
    "Yo, I wanted to personally say thank you for being here early.",
    "ROOSTER is growing and I’m starting to see what this can really become.",
    "When I first opened it up, I wanted to create a place for people again. Somewhere we can actually connect, talk, share what we’re working on, discover people and build real relationships without everything feeling like an algorithm.",
    "Now we’re taking the next step.",
    "Going forward, ROOSTER is becoming an approval and invite based community.",
    "Not because I want to make it hard for people to get in. I just want us to protect what we’re building as it grows.",
    "And since you were already here before we made that change, you’re part of the early ROOSTER community.",
    "Your account isn’t going anywhere and you don’t have to apply again.",
    "You’ll see an Early Member badge added to your profile. Some early members will also become Founding Members as we continue building this out.",
    "Eventually you’ll also be able to invite certain people you feel should be in the room.",
    "I want ROOSTER to grow, but I want it to grow the right way.",
    "Real artists.\nReal producers.\nReal writers.\nEngineers.\nDJs.\nExecutives.\nCreatives.\nPeople building something.\nPeople looking for real relationships and opportunities.",
    "This isn’t about followers.",
    "It’s about who’s in the room.",
    "We’re still early.",
    "Let’s build this right.",
    "J.White Did It\nFounder of ROOSTER",
  ].join("\n\n"),
  audience: { kind: "early_members" as AudienceKind, levels: [] as MembershipLevel[], member_ids: [] as string[] },
  surfaces: { message: true, notification: true, homepage: true },
});

export function newAnnouncementSlug(): string {
  return `founder-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

/** Nothing here trusts a client: the sender identity comes from the owner
 * binding and the audience is rebuilt from membership rows on the server. */
export function readAnnouncementDraft(input: unknown): AnnouncementDraft {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new MemberError(400, "Please write your announcement first.");
  const record = input as Record<string, any>;
  const subject = typeof record.subject === "string" ? record.subject.trim().replace(/\s+/g, " ") : "";
  const body = typeof record.body === "string" ? record.body.replace(/\r\n/g, "\n").trim() : "";
  if (!subject || subject.length > 100 || BAD_TEXT.test(subject)) throw new MemberError(400, "Give your announcement a subject of 1 to 100 characters.");
  if (!body || body.length > 3000 || BAD_TEXT.test(body)) throw new MemberError(400, "Write an announcement of 1 to 3000 characters.");
  const audience = record.audience && typeof record.audience === "object" && !Array.isArray(record.audience) ? record.audience : {};
  const kind = AUDIENCE_KINDS.find(entry => entry.value === audience.kind)?.value;
  if (!kind) throw new MemberError(400, "Choose who this announcement goes to.");
  // The same choice twice is harmless, but an unknown level or member id is
  // rejected rather than quietly dropped from the audience.
  const rawLevels = [...new Set(Array.isArray(audience.levels) ? audience.levels : [])];
  const levels = rawLevels.filter(isMembershipLevel);
  if (kind === "levels" && (!levels.length || levels.length !== rawLevels.length)) throw new MemberError(400, "Choose at least one membership level.");
  const rawIds = [...new Set((Array.isArray(audience.member_ids) ? audience.member_ids : [])
    .map(value => typeof value === "string" ? value.toLowerCase() : value))];
  const memberIds = rawIds.filter((value): value is string => typeof value === "string" && MEMBER_ID.test(value));
  if (kind === "members" && (!memberIds.length || memberIds.length !== rawIds.length)) throw new MemberError(400, "Choose the members this announcement goes to.");
  if (memberIds.length > MAX_INDIVIDUAL_RECIPIENTS) throw new MemberError(400, `Choose up to ${MAX_INDIVIDUAL_RECIPIENTS} individual members, or send to a membership level instead.`);
  const surfaces = record.surfaces && typeof record.surfaces === "object" && !Array.isArray(record.surfaces) ? record.surfaces : {};
  const chosen = {
    message: surfaces.message === true, notification: surfaces.notification === true, homepage: surfaces.homepage === true,
  };
  if (!chosen.message && !chosen.notification && !chosen.homepage) throw new MemberError(400, "Choose where this announcement appears.");
  const slug = typeof record.slug === "string" && ANNOUNCEMENT_SLUG.test(record.slug) ? record.slug : newAnnouncementSlug();
  return {
    slug, subject, body,
    audience: { kind, levels: kind === "levels" ? levels : [], member_ids: kind === "members" ? memberIds : [] },
    surfaces: chosen,
  };
}

function audienceCondition(audience: AnnouncementDraft["audience"], founderId: string) {
  const notTheAuthor = sql`${memberships.memberId} <> ${founderId}`;
  switch (audience.kind) {
    case "everyone": return notTheAuthor;
    case "early_members": return and(eq(memberships.earlyMember, true), notTheAuthor);
    case "founding_members": return and(eq(memberships.level, "founding_member"), notTheAuthor);
    case "approved_creators": return and(eq(memberships.level, "approved_creator"), notTheAuthor);
    case "levels": return and(inArray(memberships.level, audience.levels), notTheAuthor);
    case "members": return and(inArray(memberships.memberId, audience.member_ids), notTheAuthor);
  }
}

export async function audienceMemberIds(audience: AnnouncementDraft["audience"], founderId: string): Promise<string[]> {
  const rows = await db.select({ memberId: memberships.memberId }).from(memberships)
    .where(audienceCondition(audience, founderId)).limit(MAX_AUDIENCE + 1);
  if (rows.length > MAX_AUDIENCE) throw new MemberError(503, "This audience is too large to send in one announcement right now.");
  return rows.map(row => row.memberId);
}

export function announcementAudienceLabel(audience: AnnouncementDraft["audience"]): string {
  if (audience.kind === "levels") {
    return audience.levels.map(level => MEMBERSHIP_LEVELS.find(entry => entry.value === level)?.label ?? level).join(", ");
  }
  if (audience.kind === "members") return `${audience.member_ids.length} selected member${audience.member_ids.length === 1 ? "" : "s"}`;
  return AUDIENCE_KINDS.find(entry => entry.value === audience.kind)?.label ?? "Everyone";
}

/** Who may send a mass announcement. The Founder is the bound site owner; an
 * administrator only gains this by the Founder granting it, and the grant is
 * re-read from storage on every request so a revoked one cannot be reused. */
export async function announcementAccess(
  member: ProfileMember, profiles: Pick<ProfileStore, "get">,
): Promise<{ founderId: string | null; isFounder: boolean; canSend: boolean; canManageTeam: boolean }> {
  const binding = await profiles.get("owner-binding", { type: "json" });
  if (binding !== null && (!binding || typeof binding.id !== "string" || !MEMBER_ID.test(binding.id))) throw new Error("Invalid owner binding");
  const founderId: string | null = binding?.id?.toLowerCase() ?? (member.isOwner ? member.id : null);
  const isFounder = member.isOwner && founderId === member.id;
  const grant = !isFounder && founderId && member.id !== founderId
    ? await profiles.get(`announcement-team/${member.id}`, { type: "json" })
    : null;
  const isAdministrator = Boolean(founderId) && grant?.id === member.id && grant?.can_announce === true;
  return { founderId, isFounder, canSend: isFounder || isAdministrator, canManageTeam: isFounder };
}

export function requireAnnouncer(access: { canSend: boolean; founderId: string | null }): string {
  if (!access.canSend || !access.founderId) {
    throw new MemberError(403, "Only J.White and an administrator he authorizes can send a ROOSTER announcement.");
  }
  return access.founderId;
}

export type AnnouncementPreview = {
  slug: string; subject: string; body: string; author_name: string; author_title: string;
  audience_kind: AudienceKind; audience_label: string; recipient_count: number;
  surfaces: AnnouncementDraft["surfaces"]; membership_live: boolean;
};

export async function previewAnnouncement(draft: AnnouncementDraft, founderId: string): Promise<AnnouncementPreview> {
  const [launch, recipients] = await Promise.all([membershipLaunchRecord(), audienceMemberIds(draft.audience, founderId)]);
  return {
    // The preview carries its announcement key back to the send, so pressing
    // SEND ANNOUNCEMENT twice publishes the same announcement once.
    slug: draft.slug, subject: draft.subject, body: draft.body, author_name: FOUNDER_NAME, author_title: FOUNDER_TITLE,
    audience_kind: draft.audience.kind, audience_label: announcementAudienceLabel(draft.audience),
    recipient_count: recipients.length, surfaces: draft.surfaces, membership_live: Boolean(launch),
  };
}

/** Publish the announcement and record who it is for. The membership system
 * has to be live first: that is what guarantees every existing member already
 * holds Early Member status before they are told about it. */
export async function sendAnnouncement(
  draft: AnnouncementDraft, founderId: string,
): Promise<{ status: "sent" | "already_sent"; announcement_id: number; recipient_count: number; audience_label: string }> {
  const launch = await membershipLaunchRecord();
  if (!launch) {
    throw new MemberError(409, "Turn the new membership system on first. Existing members need their Early Member status before an announcement goes out.");
  }
  const [created] = await db.insert(founderAnnouncements).values({
    slug: draft.slug, subject: draft.subject, body: draft.body,
    authorId: founderId, authorName: FOUNDER_NAME, authorTitle: FOUNDER_TITLE,
    audienceKind: draft.audience.kind, audienceLevels: draft.audience.levels, audienceMemberIds: draft.audience.member_ids,
    showAsMessage: draft.surfaces.message, showAsNotification: draft.surfaces.notification,
    showOnHomepage: draft.surfaces.homepage,
  }).onConflictDoNothing({ target: founderAnnouncements.slug }).returning({ id: founderAnnouncements.id });
  const [row] = created
    ? [created]
    : await db.select({ id: founderAnnouncements.id }).from(founderAnnouncements).where(eq(founderAnnouncements.slug, draft.slug)).limit(1);
  if (!row) throw new Error("The announcement could not be saved");
  const recipients = await audienceMemberIds(draft.audience, founderId);
  for (let offset = 0; offset < recipients.length; offset += 200) {
    await db.insert(announcementDeliveries)
      .values(recipients.slice(offset, offset + 200).map(memberId => ({ announcementId: row.id, memberId })))
      .onConflictDoNothing();
  }
  const [counted] = await db.select({ total: sql<number>`count(*)::int` })
    .from(announcementDeliveries).where(eq(announcementDeliveries.announcementId, row.id));
  const recipientCount = Number(counted?.total ?? recipients.length);
  await db.update(founderAnnouncements).set({ recipientCount }).where(eq(founderAnnouncements.id, row.id));
  return {
    status: created ? "sent" : "already_sent", announcement_id: row.id,
    recipient_count: recipientCount, audience_label: announcementAudienceLabel(draft.audience),
  };
}

export type MemberAnnouncement = {
  id: number; subject: string; body: string; author_name: string; author_title: string;
  sent_at: string; read: boolean; message_id: string | null;
  show_as_message: boolean; show_as_notification: boolean; show_on_homepage: boolean;
};

/** Put any announcement the member has not received yet into their ordinary
 * ROOSTER messages. Called on the member's own authenticated requests, so the
 * announcement is waiting the next time they log in without a mass send having
 * to finish inside one request. */
export async function deliverPendingAnnouncements(member: Member, stores: MemberStores): Promise<void> {
  if (!MEMBER_ID.test(member.id)) return;
  const pending = await db.select({
    deliveryId: announcementDeliveries.id,
    slug: founderAnnouncements.slug,
    subject: founderAnnouncements.subject,
    body: founderAnnouncements.body,
    authorId: founderAnnouncements.authorId,
    authorName: founderAnnouncements.authorName,
    showAsMessage: founderAnnouncements.showAsMessage,
  }).from(announcementDeliveries)
    .innerJoin(founderAnnouncements, eq(announcementDeliveries.announcementId, founderAnnouncements.id))
    .where(and(eq(announcementDeliveries.memberId, member.id.toLowerCase()), isNull(announcementDeliveries.deliveredAt)))
    .limit(10);
  for (const entry of pending) {
    try {
      let messageId: string | null = null;
      if (entry.showAsMessage) {
        const delivered = await deliverFounderAnnouncement(
          member, { id: entry.authorId, name: entry.authorName },
          { slug: entry.slug, subject: entry.subject, body: entry.body }, stores,
        );
        if (delivered.status === "author") continue;
        messageId = delivered.message_id ?? null;
      }
      await db.update(announcementDeliveries)
        .set({ deliveredAt: new Date(), ...(messageId ? { messageId } : {}) })
        .where(and(eq(announcementDeliveries.id, entry.deliveryId), isNull(announcementDeliveries.deliveredAt)));
    } catch {
      // The delivery row stays pending and the same immutable message is
      // retried on the member's next request. Never log announcement contents.
      console.warn("founder_announcement_delivery_pending");
    }
  }
}

export async function memberAnnouncements(member: Member): Promise<MemberAnnouncement[]> {
  if (!MEMBER_ID.test(member.id)) return [];
  const rows = await db.select({
    id: founderAnnouncements.id, subject: founderAnnouncements.subject, body: founderAnnouncements.body,
    authorName: founderAnnouncements.authorName, authorTitle: founderAnnouncements.authorTitle,
    sentAt: founderAnnouncements.sentAt, readAt: announcementDeliveries.readAt,
    messageId: announcementDeliveries.messageId,
    showAsMessage: founderAnnouncements.showAsMessage,
    showAsNotification: founderAnnouncements.showAsNotification,
    showOnHomepage: founderAnnouncements.showOnHomepage,
  }).from(announcementDeliveries)
    .innerJoin(founderAnnouncements, eq(announcementDeliveries.announcementId, founderAnnouncements.id))
    .where(eq(announcementDeliveries.memberId, member.id.toLowerCase()))
    .orderBy(sql`${founderAnnouncements.sentAt} desc`).limit(20);
  return rows.map(row => ({
    id: row.id, subject: row.subject, body: row.body,
    author_name: row.authorName, author_title: row.authorTitle,
    sent_at: new Date(row.sentAt).toISOString(), read: row.readAt !== null,
    message_id: row.messageId ?? null,
    show_as_message: row.showAsMessage, show_as_notification: row.showAsNotification,
    show_on_homepage: row.showOnHomepage,
  }));
}

/** A member marks their own copy read. The homepage announcement disappears
 * for them at that point and the notification stops. */
export async function markAnnouncementRead(member: Member, announcementId: unknown): Promise<{ id: number; read: true }> {
  if (!Number.isSafeInteger(announcementId) || Number(announcementId) < 1) throw new MemberError(400, "Choose a valid announcement.");
  const id = Number(announcementId);
  const [row] = await db.update(announcementDeliveries)
    .set({ readAt: new Date() })
    .where(and(
      eq(announcementDeliveries.announcementId, id),
      eq(announcementDeliveries.memberId, member.id.toLowerCase()),
      isNull(announcementDeliveries.readAt),
    )).returning({ id: announcementDeliveries.announcementId });
  if (row) return { id, read: true };
  const [existing] = await db.select({ id: announcementDeliveries.announcementId }).from(announcementDeliveries)
    .where(and(eq(announcementDeliveries.announcementId, id), eq(announcementDeliveries.memberId, member.id.toLowerCase()))).limit(1);
  if (!existing) throw new MemberError(404, "That announcement is not in your messages.");
  return { id, read: true };
}

export type AnnouncementHistoryRow = {
  id: number; slug: string; subject: string; audience_label: string; recipient_count: number;
  read_count: number; delivered_count: number; sent_at: string;
  surfaces: AnnouncementDraft["surfaces"];
};

export async function announcementHistory(limit = 20): Promise<AnnouncementHistoryRow[]> {
  const rows = await db.select({
    id: founderAnnouncements.id, slug: founderAnnouncements.slug, subject: founderAnnouncements.subject,
    audienceKind: founderAnnouncements.audienceKind, audienceLevels: founderAnnouncements.audienceLevels,
    audienceMemberIds: founderAnnouncements.audienceMemberIds, recipientCount: founderAnnouncements.recipientCount,
    sentAt: founderAnnouncements.sentAt, showAsMessage: founderAnnouncements.showAsMessage,
    showAsNotification: founderAnnouncements.showAsNotification, showOnHomepage: founderAnnouncements.showOnHomepage,
    readCount: sql<number>`count(${announcementDeliveries.readAt})::int`,
    deliveredCount: sql<number>`count(${announcementDeliveries.deliveredAt})::int`,
  }).from(founderAnnouncements)
    .leftJoin(announcementDeliveries, eq(announcementDeliveries.announcementId, founderAnnouncements.id))
    .groupBy(founderAnnouncements.id)
    .orderBy(sql`${founderAnnouncements.sentAt} desc`).limit(limit);
  return rows.map(row => ({
    id: row.id, slug: row.slug, subject: row.subject,
    audience_label: announcementAudienceLabel({
      kind: row.audienceKind as AudienceKind,
      levels: (row.audienceLevels ?? []) as MembershipLevel[],
      member_ids: (row.audienceMemberIds ?? []) as string[],
    }),
    recipient_count: row.recipientCount, read_count: Number(row.readCount ?? 0),
    delivered_count: Number(row.deliveredCount ?? 0), sent_at: new Date(row.sentAt).toISOString(),
    surfaces: { message: row.showAsMessage, notification: row.showAsNotification, homepage: row.showOnHomepage },
  }));
}

const MAX_BODY_BYTES = 24576;

/** Bounded JSON reader for the announcement endpoints. An announcement plus a
 * list of chosen members is larger than a chat update but still small. */
export async function readAnnouncementRequest(req: Request): Promise<Record<string, unknown>> {
  if ((req.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new MemberError(415, "This announcement format is not supported.");
  }
  if (Number(req.headers.get("content-length") || "0") > MAX_BODY_BYTES || !req.body) {
    throw new MemberError(413, "This announcement is too large.");
  }
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) { await reader.cancel(); throw new MemberError(413, "This announcement is too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value = JSON.parse(new TextDecoder().decode(buffer));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new MemberError(400, "This announcement could not be read.");
  }
}

export function announcementFailure(error: unknown): Response {
  return error instanceof MemberError
    ? memberJSON({ error: error.message }, error.status)
    : memberJSON({ error: "ROOSTER announcements could not load. Please try again in a moment." }, 503);
}
