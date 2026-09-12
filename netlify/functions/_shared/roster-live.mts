/** ROOSTER LIVE: live voice rooms.
 *
 * The audio itself never touches this server. Two people in a room describe
 * their connection to each other through the short-lived rows in live_signals,
 * their browsers then connect directly, and the row is deleted the moment it
 * is delivered. Nothing here records, stores or forwards a conversation.
 *
 * Three rules the rest of the file exists to keep:
 *
 *  1. Only an approved ROOSTER member can see a room, join one or open one.
 *     Every entry point takes its member from requireCommunityMember, which is
 *     the invite-only gate, so a link to a room is worth nothing on its own.
 *  2. Everybody arrives as a listener with the microphone off. A listener has
 *     no way to become a speaker except by a host approving them, and even an
 *     approved speaker stays muted until they turn their own microphone on.
 *  3. A host controls their own room and nobody else's.
 */
import { and, asc, desc, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { randomInt } from "node:crypto";
import { db } from "../../../db/index.js";
import { liveMessages, liveModerationActions, liveModerators, liveParticipants, liveRooms, liveSignals } from "../../../db/schema.js";
import { MEMBER_ID, MemberError, memberJSON } from "./member-auth.mts";
import type { ProfileMember, ProfileStore } from "./member-profiles.mts";

/* --------------------------------------------------------------- the shapes */

export const LIVE_ROLES = ["host", "speaker", "listener"] as const;
export type LiveRole = (typeof LIVE_ROLES)[number];

export const HOST_ACTIONS = ["approve_speaker", "mute_speaker", "step_down_speaker", "remove_member", "remove_message", "restore_message", "end_room", "assign_moderator", "remove_moderator", "comments_on", "comments_off"] as const;
export type HostAction = (typeof HOST_ACTIONS)[number];
export const SIGNAL_KINDS = ["offer", "answer", "ice", "bye"] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

export type LiveParticipantView = {
  member_id: string; name: string; photo_url: string | null;
  role: LiveRole; hand_raised: boolean; muted: boolean; is_host: boolean; is_you: boolean; is_moderator: boolean;
};
export type LiveRoomView = {
  key: string; title: string; description: string; medium: LiveMedium;
  host_id: string; host_name: string; host_photo_url: string | null;
  created_at: string; last_active_at: string;
  listener_count: number; speaker_count: number; participant_count: number;
  you_are_host: boolean;
  comments_enabled: boolean;
};
export type LiveMessageView = {
  id: number; member_id: string; name: string; photo_url: string | null;
  body: string; created_at: string; is_you: boolean;
};

/** An audio Room and a video broadcast are two different experiences that
 * happen to travel over the same direct connections, so which one a room is
 * gets recorded rather than guessed from what the host's browser sent. */
export const LIVE_MEDIUMS = ["audio", "video"] as const;
export type LiveMedium = (typeof LIVE_MEDIUMS)[number];

/** Somebody with a browser open is counted as here. Phones sleep and lifts
 * lose signal, so the window is generous enough to survive a hiccup and short
 * enough that a room never looks busier than it really is. */
export const PRESENT_WINDOW_MS = 45_000;
/** A room with nobody in it for five minutes closes itself. */
export const ROOM_IDLE_MS = 5 * 60_000;
/** Connection setup that was never collected is rubbish after a minute. */
export const SIGNAL_TTL_MS = 60_000;
export const ROOM_KEY_SHAPE = /^[a-z0-9]{12}$/;
const KEY_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
/** Control characters and angle brackets never belong in a room name or a
 * display name, whatever a browser sends. */
const UNSAFE_TEXT = /[\u0000-\u001f\u007f<>]/;
const SESSION_SHAPE = /^[A-Za-z0-9_-]{8,64}$/;
const PHOTO_HASH = /^[a-f0-9]{64}$/;
const SIGNAL_LIMIT = 8_000;
const ROOM_LIMIT = 40;
/** How much of a room's conversation somebody who joins late can read. */
export const MESSAGE_WINDOW = 60;
const MESSAGE_LIMIT = 400;

export function liveFailure(error: unknown): Response {
  return error instanceof MemberError ? memberJSON({ error: error.message }, error.status)
    : memberJSON({ error: "ROOSTER LIVE is unavailable right now. Please try again in a moment." }, 503);
}

/* ------------------------------------------------------------- the cleaning */

/** Anybody who has stopped checking in is no longer in the room, a room that
 * has been empty long enough is closed, and abandoned connection setup is
 * deleted. Called at the start of every read, so what a member sees is the
 * truth right now rather than a history of the day. */
export async function pruneLive(now = new Date()): Promise<void> {
  const stale = new Date(now.getTime() - PRESENT_WINDOW_MS);
  await db.update(liveParticipants).set({ present: false, handRaised: false, muted: true })
    .where(and(eq(liveParticipants.present, true), lt(liveParticipants.lastSeenAt, stale)));
  await db.delete(liveSignals).where(lt(liveSignals.createdAt, new Date(now.getTime() - SIGNAL_TTL_MS)));
  const idle = new Date(now.getTime() - ROOM_IDLE_MS);
  await db.update(liveRooms).set({ status: "ended", endedAt: now })
    .where(and(eq(liveRooms.status, "live"), lt(liveRooms.lastActiveAt, idle)));
}

/* -------------------------------------------------------------- the reading */

function roleOf(value: string): LiveRole {
  return (LIVE_ROLES as readonly string[]).includes(value) ? value as LiveRole : "listener";
}

export function normalizeRoomKey(value: unknown): string {
  const key = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!ROOM_KEY_SHAPE.test(key)) throw new MemberError(400, "That is not a ROOSTER LIVE room.");
  return key;
}

export function normalizeTitle(value: unknown): string {
  const title = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (title.length < 3) throw new MemberError(400, "Give your room a name of at least 3 characters.");
  if (title.length > 60) throw new MemberError(400, "Room names are 60 characters or fewer.");
  if (UNSAFE_TEXT.test(title)) throw new MemberError(400, "Room names cannot contain those characters.");
  return title;
}

/** A room is a video broadcast only because its host asked for one. Anything
 * else, including nothing at all, is an audio Room. */
export function normalizeMedium(value: unknown): LiveMedium {
  return value === "video" ? "video" : "audio";
}

/** The host's optional line under the title. Optional means optional: empty
 * is normal and is stored as empty rather than refused. */
export function normalizeDescription(value: unknown): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!text) return "";
  if (text.length > 140) throw new MemberError(400, "Keep the description to 140 characters or fewer.");
  if (UNSAFE_TEXT.test(text)) throw new MemberError(400, "The description cannot contain those characters.");
  return text;
}

/** A line somebody typed in a room. Kept as text, never as markup, and the
 * page that shows it writes it with textContent. */
export function normalizeMessage(value: unknown): string {
  const body = typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim() : "";
  if (!body) throw new MemberError(400, "Type something first.");
  if (body.length > MESSAGE_LIMIT) throw new MemberError(400, `Comments are ${MESSAGE_LIMIT} characters or fewer.`);
  return body;
}

export function normalizeSession(value: unknown): string {
  const session = typeof value === "string" ? value.trim() : "";
  if (!SESSION_SHAPE.test(session)) throw new MemberError(400, "That connection could not be identified. Reload the page and join again.");
  return session;
}

function newRoomKey(): string {
  let key = "";
  for (let index = 0; index < 12; index += 1) key += KEY_ALPHABET[randomInt(KEY_ALPHABET.length)];
  return key;
}

/** The name and picture a member appears as in a room. Read from their own
 * ROOSTER profile, so a room shows the same face as the rest of the site, and
 * never taken from whatever the browser sent. */
async function memberCard(member: ProfileMember, profiles?: ProfileStore): Promise<{ name: string; photoUrl: string }> {
  if (!profiles) return { name: member.name, photoUrl: member.isOwner ? "/profile.jpg" : "" };
  try {
    const record = await profiles.get(`profiles/${member.id.toLowerCase()}`, { type: "json" });
    const stored = typeof record?.name === "string" ? record.name.trim() : "";
    const name = member.isOwner || !stored || stored.length > 60 || UNSAFE_TEXT.test(stored) ? member.name : stored;
    const photoId = typeof record?.photo_id === "string" && PHOTO_HASH.test(record.photo_id) ? record.photo_id : "";
    return { name, photoUrl: photoId ? `/api/profile-photo/${photoId}` : member.isOwner ? "/profile.jpg" : "" };
  } catch {
    // A profile that cannot be read is no reason to keep somebody out of a
    // room; they simply appear under the name their account already carries.
    return { name: member.name, photoUrl: member.isOwner ? "/profile.jpg" : "" };
  }
}

async function liveRoomRow(key: string) {
  const [room] = await db.select().from(liveRooms)
    .where(and(eq(liveRooms.roomKey, key), eq(liveRooms.status, "live"))).limit(1);
  if (!room) throw new MemberError(404, "That room has ended.");
  return room;
}

type RoomRow = {
  roomKey: string; title: string; description?: string; medium?: string;
  hostId: string; hostName: string; createdAt: Date | string; lastActiveAt: Date | string;
  commentsEnabled?: boolean;
};

function roomView(
  room: RoomRow,
  counts: { listeners: number; speakers: number; hostPhotoUrl?: string },
  memberId: string,
): LiveRoomView {
  return {
    key: room.roomKey, title: room.title,
    description: room.description || "",
    medium: normalizeMedium(room.medium),
    host_id: room.hostId, host_name: room.hostName || "A ROOSTER member",
    host_photo_url: counts.hostPhotoUrl || null,
    created_at: new Date(room.createdAt).toISOString(), last_active_at: new Date(room.lastActiveAt).toISOString(),
    listener_count: counts.listeners, speaker_count: counts.speakers,
    participant_count: counts.listeners + counts.speakers,
    you_are_host: room.hostId === memberId,
    comments_enabled: (room as RoomRow & {commentsEnabled?:boolean}).commentsEnabled !== false,
  };
}

/** Every room that is on right now, newest activity first. */
export async function listRooms(member: ProfileMember): Promise<{ rooms: LiveRoomView[] }> {
  await pruneLive();
  const rows = await db.select().from(liveRooms)
    .where(eq(liveRooms.status, "live")).orderBy(desc(liveRooms.lastActiveAt)).limit(ROOM_LIMIT);
  if (!rows.length) return { rooms: [] };
  const counted = await db.select({
    roomId: liveParticipants.roomId,
    speakers: sql<number>`count(*) filter (where ${liveParticipants.role} in ('host', 'speaker'))`.mapWith(Number),
    listeners: sql<number>`count(*) filter (where ${liveParticipants.role} = 'listener')`.mapWith(Number),
  }).from(liveParticipants)
    .where(and(
      inArray(liveParticipants.roomId, rows.map(row => row.id)),
      eq(liveParticipants.present, true), eq(liveParticipants.removed, false),
    ))
    .groupBy(liveParticipants.roomId);
  const byRoom = new Map(counted.map(row => [row.roomId, row]));
  // The host's face, so a room in the list looks like the person running it.
  const hosts = await db.select({ roomId: liveParticipants.roomId, photoUrl: liveParticipants.photoUrl })
    .from(liveParticipants)
    .where(and(inArray(liveParticipants.roomId, rows.map(row => row.id)), eq(liveParticipants.role, "host")));
  const faces = new Map(hosts.map(row => [row.roomId, row.photoUrl]));
  return {
    rooms: rows.map(row => roomView(row, {
      listeners: byRoom.get(row.id)?.listeners ?? 0,
      speakers: byRoom.get(row.id)?.speakers ?? 0,
      hostPhotoUrl: faces.get(row.id) || "",
    }, member.id)),
  };
}

async function participantViews(roomId: number, hostId: string, memberId: string): Promise<LiveParticipantView[]> {
  const [rows, moderators] = await Promise.all([db.select().from(liveParticipants)
    .where(and(eq(liveParticipants.roomId, roomId), eq(liveParticipants.present, true), eq(liveParticipants.removed, false)))
    .orderBy(asc(liveParticipants.joinedAt)), db.select({memberId:liveModerators.memberId}).from(liveModerators).where(and(eq(liveModerators.roomId,roomId),eq(liveModerators.active,true)))]);
  const moderatorIds=new Set(moderators.map(row=>row.memberId));
  return rows.map(row => {
    const role: LiveRole = row.memberId === hostId ? "host" : roleOf(row.role);
    return {
      member_id: row.memberId,
      name: row.name || "A ROOSTER member",
      photo_url: row.photoUrl || null,
      role,
      hand_raised: row.handRaised,
      // A listener is always reported muted whatever their row says, so the
      // room never draws somebody as talking who has no permission to.
      muted: role === "listener" ? true : row.muted,
      is_host: role === "host", is_moderator: moderatorIds.has(row.memberId),
      is_you: row.memberId === memberId,
    };
  });
}

/* -------------------------------------------------------------- the opening */

/** Open a room. A host gets one at a time: opening a new one closes the last,
 * so the list never fills with rooms somebody walked away from. */
export async function createRoom(
  member: ProfileMember,
  title: unknown,
  profiles?: ProfileStore,
  options: { medium?: unknown; description?: unknown } = {},
): Promise<{ room: LiveRoomView }> {
  const name = normalizeTitle(title);
  const medium = normalizeMedium(options.medium);
  const description = normalizeDescription(options.description);
  await pruneLive();
  const card = await memberCard(member, profiles);
  const now = new Date();
  // A host runs one room at a time. Opening a new one closes the last, which
  // is also what stops a double tap on Go Live from leaving a room behind.
  await db.update(liveRooms).set({ status: "ended", endedAt: now })
    .where(and(eq(liveRooms.hostId, member.id), eq(liveRooms.status, "live")));
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const key = newRoomKey();
    const [room] = await db.insert(liveRooms)
      .values({ roomKey: key, title: name, description, medium, hostId: member.id, hostName: card.name, status: "live", createdAt: now, lastActiveAt: now })
      .onConflictDoNothing({ target: liveRooms.roomKey }).returning();
    if (!room) continue;
    await db.insert(liveParticipants)
      .values({
        roomId: room.id, memberId: member.id, name: card.name, photoUrl: card.photoUrl,
        role: "host", muted: true, present: true, removed: false, sessionId: "", joinedAt: now, lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: [liveParticipants.roomId, liveParticipants.memberId],
        set: { role: "host", present: true, removed: false, muted: true, handRaised: false, name: card.name, photoUrl: card.photoUrl, lastSeenAt: now },
      });
    return { room: roomView(room, { listeners: 0, speakers: 1, hostPhotoUrl: card.photoUrl }, member.id) };
  }
  throw new MemberError(503, "Your room could not be opened. Please try again.");
}

/* -------------------------------------------------------------- the joining */

export type LiveState = {
  room: LiveRoomView;
  you: LiveParticipantView;
  participants: LiveParticipantView[];
  messages: LiveMessageView[];
  signals: { from_id: string; kind: SignalKind; payload: Record<string, unknown> }[];
  moderation_queue?: {id:number;actor_id:string;target_member_id:string|null;message_id:number|null;action:string;reason:string;created_at:string}[];
};

/** The last of a room's conversation, oldest first, so somebody who joins a
 * broadcast late reads it the way it was said. */
async function messageViews(roomId: number, memberId: string): Promise<LiveMessageView[]> {
  const rows = await db.select().from(liveMessages)
    .where(and(eq(liveMessages.roomId, roomId), eq(liveMessages.removed, false)))
    .orderBy(desc(liveMessages.createdAt)).limit(MESSAGE_WINDOW);
  return rows.reverse().map(row => ({
    id: row.id,
    member_id: row.memberId,
    name: row.name || "A ROOSTER member",
    photo_url: row.photoUrl || null,
    body: row.body,
    created_at: new Date(row.createdAt).toISOString(),
    is_you: row.memberId === memberId,
  }));
}

async function stateFor(room: RoomRow & { id: number }, member: ProfileMember, options: { signals?: boolean } = {}): Promise<LiveState> {
  const participants = await participantViews(room.id, room.hostId, member.id);
  const you = participants.find(entry => entry.is_you) ?? {
    member_id: member.id, name: member.name, photo_url: null, role: "listener" as LiveRole,
    hand_raised: false, muted: true, is_host: room.hostId === member.id, is_you: true,
    is_moderator: false,
  };
  const speakers = participants.filter(entry => entry.role !== "listener").length;
  const messages = await messageViews(room.id, member.id);
  let signals: LiveState["signals"] = [];
  if (options.signals) {
    // Read and delete in one statement, so a piece of connection setup is
    // delivered exactly once even when the same member has two tabs polling.
    const delivered = await db.delete(liveSignals)
      .where(and(eq(liveSignals.roomId, room.id), eq(liveSignals.toId, member.id))).returning();
    signals = delivered
      .sort((left, right) => Number(left.id) - Number(right.id))
      .map(row => ({ from_id: row.fromId, kind: row.kind as SignalKind, payload: row.payload }));
  }
  const privileged=you.is_host||you.is_moderator;
  const actions=privileged?await db.select().from(liveModerationActions).where(eq(liveModerationActions.roomId,room.id)).orderBy(desc(liveModerationActions.createdAt)).limit(30):[];
  return {
    room: roomView(room, {
      listeners: participants.length - speakers, speakers,
      hostPhotoUrl: participants.find(entry => entry.is_host)?.photo_url || "",
    }, member.id),
    you, participants, messages, signals,
    ...(privileged?{moderation_queue:actions.map(row=>({id:row.id,actor_id:row.actorId,target_member_id:row.targetMemberId,message_id:row.messageId,action:row.action,reason:row.reason,created_at:new Date(row.createdAt).toISOString()}))}:{}),
  };
}

/** Come into a room as a listener with the microphone off. Somebody the host
 * removed cannot come back. */
export async function joinRoom(member: ProfileMember, key: unknown, session: unknown, profiles?: ProfileStore): Promise<LiveState> {
  const roomKey = normalizeRoomKey(key);
  const sessionId = normalizeSession(session);
  await pruneLive();
  const room = await liveRoomRow(roomKey);
  const card = await memberCard(member, profiles);
  const now = new Date();
  const host = room.hostId === member.id;
  const [existing] = await db.select().from(liveParticipants)
    .where(and(eq(liveParticipants.roomId, room.id), eq(liveParticipants.memberId, member.id))).limit(1);
  if (existing?.removed) throw new MemberError(403, "The host removed you from this room.");
  if (existing?.present && existing.sessionId && existing.sessionId !== sessionId) {
    throw new MemberError(409, "This account is already in this room on another phone or computer. Leave there first, or use a second ROOSTER account to test the sound.");
  }
  await db.insert(liveParticipants)
    .values({
      roomId: room.id, memberId: member.id, name: card.name, photoUrl: card.photoUrl,
      role: host ? "host" : "listener", muted: true, present: true, removed: false,
      sessionId, joinedAt: now, lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [liveParticipants.roomId, liveParticipants.memberId],
      set: {
        // Rejoining never promotes anybody: a listener stays a listener, and a
        // speaker's microphone goes back off until they turn it on again.
        role: host ? sql`'host'` : sql`case when ${liveParticipants.role} = 'speaker' then 'speaker' else 'listener' end`,
        present: true, muted: true, handRaised: false, sessionId,
        name: card.name, photoUrl: card.photoUrl, lastSeenAt: now,
      },
    });
  await db.update(liveRooms).set({ lastActiveAt: now }).where(eq(liveRooms.id, room.id));
  return await stateFor({ ...room, lastActiveAt: now }, member);
}

/** The heartbeat. Says this member is still here, then hands back who else is
 * in the room and any connection setup waiting for them. */
export async function syncRoom(member: ProfileMember, key: unknown, session: unknown): Promise<LiveState> {
  const roomKey = normalizeRoomKey(key);
  const sessionId = normalizeSession(session);
  await pruneLive();
  const room = await liveRoomRow(roomKey);
  const now = new Date();
  const updated = await db.update(liveParticipants)
    .set({ present: true, lastSeenAt: now })
    .where(and(
      eq(liveParticipants.roomId, room.id), eq(liveParticipants.memberId, member.id),
      eq(liveParticipants.sessionId, sessionId), eq(liveParticipants.removed, false),
    ))
    .returning({ id: liveParticipants.id });
  if (!updated.length) throw new MemberError(409, "You are not in this room any more. Join it again.");
  await db.update(liveRooms).set({ lastActiveAt: now }).where(eq(liveRooms.id, room.id));
  return await stateFor({ ...room, lastActiveAt: now }, member, { signals: true });
}

/** Leave. The row stays behind so a rejoin cannot smuggle in a promotion, but
 * the member is no longer present, counted or connected. */
export async function leaveRoom(member: ProfileMember, key: unknown, session: unknown): Promise<{ left: true }> {
  const roomKey = normalizeRoomKey(key);
  const sessionId = normalizeSession(session);
  const [room] = await db.select().from(liveRooms).where(eq(liveRooms.roomKey, roomKey)).limit(1);
  if (!room) return { left: true };
  await db.update(liveParticipants).set({ present: false, muted: true, handRaised: false })
    .where(and(
      eq(liveParticipants.roomId, room.id), eq(liveParticipants.memberId, member.id),
      eq(liveParticipants.sessionId, sessionId),
    ));
  await db.delete(liveSignals).where(and(eq(liveSignals.roomId, room.id), eq(liveSignals.fromId, member.id)));
  await db.delete(liveSignals).where(and(eq(liveSignals.roomId, room.id), eq(liveSignals.toId, member.id)));
  return { left: true };
}

/* --------------------------------------------------------------- the asking */

/** Raise or lower a hand. Raising a hand asks the host; it never grants. */
export async function raiseHand(member: ProfileMember, key: unknown, raised: unknown): Promise<LiveState> {
  const room = await liveRoomRow(normalizeRoomKey(key));
  const updated = await db.update(liveParticipants)
    .set({ handRaised: raised === true, lastSeenAt: new Date() })
    .where(and(
      eq(liveParticipants.roomId, room.id), eq(liveParticipants.memberId, member.id),
      eq(liveParticipants.present, true), eq(liveParticipants.removed, false),
    ))
    .returning({ id: liveParticipants.id });
  if (!updated.length) throw new MemberError(409, "Join the room before raising your hand.");
  return await stateFor(room, member);
}

/** Mute or unmute yourself. Only a host or an approved speaker can be
 * unmuted, so a listener who asks for this stays muted. */
export async function setMuted(member: ProfileMember, key: unknown, muted: unknown): Promise<LiveState> {
  const room = await liveRoomRow(normalizeRoomKey(key));
  const wantsOn = muted === false;
  const updated = await db.update(liveParticipants)
    .set({
      muted: wantsOn
        ? sql`case when ${liveParticipants.role} in ('host', 'speaker') then false else true end`
        : sql`true`,
      lastSeenAt: new Date(),
    })
    .where(and(
      eq(liveParticipants.roomId, room.id), eq(liveParticipants.memberId, member.id),
      eq(liveParticipants.present, true), eq(liveParticipants.removed, false),
    ))
    .returning({ id: liveParticipants.id });
  if (!updated.length) throw new MemberError(409, "Join the room before turning your microphone on.");
  return await stateFor(room, member);
}

/* ------------------------------------------------------------- the talking */

/** Say something in the room. Everybody who is present may type, including a
 * listener: typing is not talking, so it needs no permission from the host,
 * and the host can remove a line and remove the person who wrote it. */
export async function sayInRoom(member: ProfileMember, key: unknown, body: unknown, profiles?: ProfileStore): Promise<LiveState> {
  const roomKey = normalizeRoomKey(key);
  const text = normalizeMessage(body);
  const room = await liveRoomRow(roomKey);
  const [me] = await db.select().from(liveParticipants)
    .where(and(
      eq(liveParticipants.roomId, room.id), eq(liveParticipants.memberId, member.id),
      eq(liveParticipants.present, true), eq(liveParticipants.removed, false),
    )).limit(1);
  if (!me) throw new MemberError(409, "Join the room before you comment.");
  if (room.commentsEnabled === false) throw new MemberError(403,"Comments are paused by the host.");
  const recent = await db.select({createdAt:liveMessages.createdAt}).from(liveMessages).where(and(eq(liveMessages.roomId,room.id),eq(liveMessages.memberId,member.id))).orderBy(desc(liveMessages.createdAt)).limit(6);
  if (recent[0] && nowMs(recent[0].createdAt) > Date.now()-1500) throw new MemberError(429,"Slow down for a moment before commenting again.");
  if (recent.length >= 6 && nowMs(recent[5].createdAt) > Date.now()-60_000) throw new MemberError(429,"Commenting is paused briefly because messages were sent too quickly.");
  const card = me.name ? { name: me.name, photoUrl: me.photoUrl } : await memberCard(member, profiles);
  const now = new Date();
  await db.insert(liveMessages).values({
    roomId: room.id, memberId: member.id, name: card.name, photoUrl: card.photoUrl, body: text, createdAt: now,
  });
  await db.update(liveParticipants).set({ lastSeenAt: now })
    .where(and(eq(liveParticipants.roomId, room.id), eq(liveParticipants.memberId, member.id)));
  await db.update(liveRooms).set({ lastActiveAt: now }).where(eq(liveRooms.id, room.id));
  return await stateFor({ ...room, lastActiveAt: now }, member);
}

/* ---------------------------------------------------------- the host's desk */

/** What a host can do, and only in their own room. Approving a speaker gives
 * somebody permission to talk; it does not turn their microphone on, because
 * only they can do that, from their own phone or computer. */
export async function hostAction(
  member: ProfileMember, key: unknown, action: unknown, targetId: unknown,
  messageId?: unknown,
): Promise<LiveState | { ended: true }> {
  const roomKey = normalizeRoomKey(key);
  if (!(HOST_ACTIONS as readonly unknown[]).includes(action)) throw new MemberError(400, "That host control is not available.");
  const [room] = await db.select().from(liveRooms).where(eq(liveRooms.roomKey,roomKey)).limit(1);
  if (!room) throw new MemberError(404,"That room has ended.");
  const host=room.hostId===member.id;
  if (action === "end_room") {
    if (!host) throw new MemberError(403,"Only the host can end this broadcast.");
    if (room.status !== "live") return {ended:true};
  } else if (room.status !== "live") throw new MemberError(404,"That room has ended.");
  const [moderator] = host ? [] : await db.select({id:liveModerators.id}).from(liveModerators).where(and(eq(liveModerators.roomId,room.id),eq(liveModerators.memberId,member.id),eq(liveModerators.active,true))).limit(1);
  const isModerator=Boolean(moderator);
  if (!host && !(isModerator && ["remove_message","restore_message","remove_member"].includes(String(action)))) throw new MemberError(403,"Only this room's host can do that.");
  const now = new Date();
  if (action === "end_room") {
    await db.update(liveRooms).set({ status: "ended", endedAt: now })
      .where(and(eq(liveRooms.id, room.id), eq(liveRooms.hostId, member.id), eq(liveRooms.status, "live")));
    await db.update(liveParticipants).set({ present: false, muted: true, handRaised: false })
      .where(eq(liveParticipants.roomId, room.id));
    await db.delete(liveSignals).where(eq(liveSignals.roomId, room.id));
    // The room is over, so its conversation goes with it.
    await db.delete(liveMessages).where(eq(liveMessages.roomId, room.id));
    return { ended: true };
  }
  if (action === "comments_on" || action === "comments_off") {
    await db.update(liveRooms).set({commentsEnabled:action === "comments_on",lastActiveAt:now}).where(eq(liveRooms.id,room.id));
    return await stateFor({...room,commentsEnabled:action === "comments_on",lastActiveAt:now},member);
  }
  if (action === "remove_message") {
    const id = Number(messageId);
    if (!Number.isInteger(id) || id < 1) throw new MemberError(400, "Choose a comment to remove.");
    const removed = await db.update(liveMessages).set({ removed: true })
      .where(and(eq(liveMessages.id, id), eq(liveMessages.roomId, room.id)))
      .returning({ id: liveMessages.id });
    if (!removed.length) throw new MemberError(404, "That comment is not in your room.");
    await db.insert(liveModerationActions).values({roomId:room.id,actorId:member.id,messageId:id,action:"remove_message",reason:isModerator?"moderator action":"host action",createdAt:now});
    await db.update(liveRooms).set({ lastActiveAt: now }).where(eq(liveRooms.id, room.id));
    return await stateFor({ ...room, lastActiveAt: now }, member);
  }
  if (action === "restore_message") {
    const id=Number(messageId);if(!Number.isInteger(id)||id<1)throw new MemberError(400,"Choose a removed comment.");
    const restored=await db.update(liveMessages).set({removed:false}).where(and(eq(liveMessages.id,id),eq(liveMessages.roomId,room.id),eq(liveMessages.removed,true))).returning({id:liveMessages.id});
    if(!restored.length)throw new MemberError(404,"That comment cannot be restored.");
    await db.insert(liveModerationActions).values({roomId:room.id,actorId:member.id,messageId:id,action:"restore_message",reason:"confirmed undo",createdAt:now});
    return await stateFor({...room,lastActiveAt:now},member);
  }
  const target = typeof targetId === "string" ? targetId.trim().toLowerCase() : "";
  if (!MEMBER_ID.test(target)) throw new MemberError(400, "Choose somebody who is in the room.");
  if (target === member.id) throw new MemberError(400, "A host cannot use the host controls on themselves.");
  if (action === "assign_moderator" || action === "remove_moderator") {
    const [present]=await db.select({id:liveParticipants.id}).from(liveParticipants).where(and(eq(liveParticipants.roomId,room.id),eq(liveParticipants.memberId,target),eq(liveParticipants.present,true),eq(liveParticipants.removed,false))).limit(1);
    if (!present) throw new MemberError(404,"Choose somebody currently in this room.");
    await db.insert(liveModerators).values({roomId:room.id,memberId:target,assignedBy:member.id,active:action === "assign_moderator",updatedAt:now}).onConflictDoUpdate({target:[liveModerators.roomId,liveModerators.memberId],set:{active:action === "assign_moderator",assignedBy:member.id,updatedAt:now}});
    await db.insert(liveModerationActions).values({roomId:room.id,actorId:member.id,targetMemberId:target,action:String(action),reason:"host confirmation",createdAt:now});
    return await stateFor({...room,lastActiveAt:now},member);
  }
  const set = action === "approve_speaker" ? { role: "speaker", handRaised: false, muted: true }
    : action === "mute_speaker" ? { muted: true }
    : action === "step_down_speaker" ? { role: "listener", muted: true, handRaised: false }
    : { removed: true, present: false, muted: true, handRaised: false, role: "listener" };
  const updated = await db.update(liveParticipants).set(set)
    .where(and(
      eq(liveParticipants.roomId, room.id), eq(liveParticipants.memberId, target),
      ne(liveParticipants.memberId, room.hostId),
    ))
    .returning({ id: liveParticipants.id });
  if (!updated.length) throw new MemberError(404, "That person is not in your room.");
  if (action === "remove_member") {
    await db.delete(liveSignals).where(and(eq(liveSignals.roomId, room.id), eq(liveSignals.fromId, target)));
    await db.delete(liveSignals).where(and(eq(liveSignals.roomId, room.id), eq(liveSignals.toId, target)));
    // Removing somebody removes what they wrote, the same as a chat room.
    await db.update(liveMessages).set({ removed: true })
      .where(and(eq(liveMessages.roomId, room.id), eq(liveMessages.memberId, target)));
  }
  await db.insert(liveModerationActions).values({roomId:room.id,actorId:member.id,targetMemberId:target||null,messageId:Number.isInteger(Number(messageId))?Number(messageId):null,action:String(action),reason:isModerator?"moderator action":"host action",createdAt:now});
  await db.update(liveRooms).set({ lastActiveAt: now }).where(eq(liveRooms.id, room.id));
  return await stateFor({ ...room, lastActiveAt: now }, member);
}

function nowMs(value:Date|string):number { return new Date(value).getTime(); }

/* ---------------------------------------------------- the connection setup */

/** Hand pieces of connection setup to other people in the same room. The
 * payload is passed through untouched but bounded, and it only ever reaches
 * somebody who is actually present in that room. */
export async function sendSignals(member: ProfileMember, key: unknown, session: unknown, input: unknown): Promise<{ sent: number }> {
  const roomKey = normalizeRoomKey(key);
  const sessionId = normalizeSession(session);
  const list = Array.isArray(input) ? input : [input];
  if (!list.length || list.length > 20) throw new MemberError(400, "Send between one and twenty connection messages at a time.");
  const room = await liveRoomRow(roomKey);
  const [me] = await db.select().from(liveParticipants)
    .where(and(
      eq(liveParticipants.roomId, room.id), eq(liveParticipants.memberId, member.id),
      eq(liveParticipants.sessionId, sessionId), eq(liveParticipants.present, true), eq(liveParticipants.removed, false),
    )).limit(1);
  if (!me) throw new MemberError(409, "Join the room before connecting.");
  const present = new Set((await db.select({ memberId: liveParticipants.memberId }).from(liveParticipants)
    .where(and(eq(liveParticipants.roomId, room.id), eq(liveParticipants.present, true), eq(liveParticipants.removed, false))))
    .map(row => row.memberId));
  const values: { roomId: number; fromId: string; toId: string; kind: string; payload: Record<string, unknown> }[] = [];
  for (const entry of list) {
    const to = typeof (entry as { to_id?: unknown })?.to_id === "string" ? String((entry as { to_id: string }).to_id).trim().toLowerCase() : "";
    const kind = (entry as { kind?: unknown })?.kind;
    const payload = (entry as { payload?: unknown })?.payload;
    if (!MEMBER_ID.test(to) || to === member.id || !present.has(to)) throw new MemberError(409, "That person is not in the room.");
    if (!(SIGNAL_KINDS as readonly unknown[]).includes(kind)) throw new MemberError(400, "That connection message is not understood.");
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new MemberError(400, "That connection message is not understood.");
    if (JSON.stringify(payload).length > SIGNAL_LIMIT) throw new MemberError(413, "That connection message is too large.");
    values.push({ roomId: room.id, fromId: member.id, toId: to, kind: kind as string, payload: payload as Record<string, unknown> });
  }
  await db.insert(liveSignals).values(values);
  await db.update(liveRooms).set({ lastActiveAt: new Date() }).where(eq(liveRooms.id, room.id));
  return { sent: values.length };
}

/** The connection servers a browser may use. STUN on its own is enough for
 * most phones and computers on ordinary networks. A TURN relay is added only
 * when the site owner has configured one; its credential is read from the
 * environment and handed to an approved member's browser for that use alone,
 * and it is never written anywhere. */
export function iceServers(
  read: (key: string) => string | undefined = key => (globalThis as { Netlify?: { env?: { get?: (name: string) => string | undefined } } }).Netlify?.env?.get?.(key) ?? process.env[key],
): { urls: string | string[]; username?: string; credential?: string }[] {
  const servers: { urls: string | string[]; username?: string; credential?: string }[] = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ];
  const url = (read("ROSTER_LIVE_TURN_URL") || "").trim();
  const username = (read("ROSTER_LIVE_TURN_USERNAME") || "").trim();
  const credential = (read("ROSTER_LIVE_TURN_CREDENTIAL") || "").trim();
  if (url && username && credential && /^turns?:/.test(url)) servers.push({ urls: url, username, credential });
  return servers;
}

/** Read a ROOSTER LIVE request body. Connection setup is larger than the rest
 * of the site's JSON — a single offer can run to a few kilobytes — so the
 * limit is generous, but it is still a limit, counted in bytes as they
 * arrive rather than trusted from a header. */
const BODY_LIMIT = 192 * 1024;
export async function readLiveBody(req: Request): Promise<Record<string, unknown>> {
  const invalid = "That request could not be read.";
  if (req.method !== "POST") throw new MemberError(405, invalid);
  if (!(req.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase().startsWith("application/json")) {
    throw new MemberError(415, invalid);
  }
  if (Number(req.headers.get("content-length") || 0) > BODY_LIMIT || !req.body) throw new MemberError(400, invalid);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > BODY_LIMIT) { await reader.cancel(); throw new MemberError(413, invalid); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(await new Blob(chunks).arrayBuffer()) || "null");
  } catch { throw new MemberError(400, invalid); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new MemberError(400, invalid);
  return parsed as Record<string, unknown>;
}
