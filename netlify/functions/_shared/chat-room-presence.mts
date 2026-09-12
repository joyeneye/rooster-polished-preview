import { getStore, getDeployStore } from "@netlify/blobs";
import type { Context } from "@netlify/functions";
import { assertSameOrigin, MEMBER_ID, MemberError, memberJSON } from "./member-auth.mts";
import { type ProfileMember, type ProfileStore } from "./member-profiles.mts";
import { CHAT_ROOM } from "./member-chat.mts";
import { resolveCommunityProfileMember } from "./roster-access.mts";

/** Presence is only ever written by the open Chat Room, never by a page view,
 * a profile visit or an ordinary signed in session. */
export const ROOM_TTL_MS = 45_000;
export const ROOM_HEARTBEAT_SECONDS = 15;
const ROOM = "listening";
const MAX_PAGES = 40;
const MAX_KEYS = 4_000;
const BODY_LIMIT = 256;
const KEY = /^rooms\/listening\/([a-f0-9-]{36})\/([a-f0-9-]{36})$/;

export interface RoomPresenceStore {
  get(key: string, options: { type: "json" }): Promise<any>;
  setJSON(key: string, value: unknown): Promise<any>;
  delete(key: string): Promise<any>;
  list(options: { prefix: string; paginate: true }): AsyncIterable<{ blobs: { key: string }[] }>;
}

export function roomPresenceStore(context: Context): RoomPresenceStore {
  const options = { name: "chat-room-presence", consistency: "strong" as const };
  return context.deploy.context === "production"
    ? getStore(options)
    : getDeployStore({ ...options, deployID: context.deploy.id });
}

const seatKey = (memberId: string, sessionId: string) => `rooms/${ROOM}/${memberId}/${sessionId}`;

function seatSeenAt(value: unknown, memberId: string): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.room !== ROOM || typeof record.member_id !== "string" || record.member_id.toLowerCase() !== memberId) return null;
  return Number.isFinite(record.seen_at) ? (record.seen_at as number) : null;
}

/**
 * The gold state is bound to the server's own record of the owner account.
 * SITE_OWNER_EMAIL matches the verified Identity email; owner-binding then
 * pins that one member id for every later read. A display name, username,
 * photo or any value posted by a browser can never reach this decision.
 */
async function ownerBinding(profiles: ProfileStore): Promise<string | null> {
  const binding = await profiles.get("owner-binding", { type: "json" });
  if (binding === null) return null;
  if (!binding || typeof binding.id !== "string" || !MEMBER_ID.test(binding.id)) throw new Error("Invalid owner binding");
  return binding.id.toLowerCase();
}

/** Mirrors every other owner-scoped writer: bind once, then refuse any account
 * that disagrees with the binding in either direction. */
async function bindOwner(profiles: ProfileStore, member: ProfileMember): Promise<void> {
  const bound = await ownerBinding(profiles);
  if ((bound === member.id && !member.isOwner) || (member.isOwner && bound && bound !== member.id)) {
    throw new MemberError(403, "This account cannot use the site owner's chat status.");
  }
  if (member.isOwner && !bound) {
    await profiles.setJSON("owner-binding", { id: member.id }, { onlyIfNew: true });
    if (await ownerBinding(profiles) !== member.id) {
      throw new MemberError(403, "This account cannot use the site owner's chat status.");
    }
  }
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  if (!(req.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase().startsWith("application/json")) {
    throw new MemberError(415, "Invalid chat room status.");
  }
  if (Number(req.headers.get("content-length") || 0) > BODY_LIMIT || !req.body) throw new MemberError(400, "Invalid chat room status.");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > BODY_LIMIT) { await reader.cancel(); throw new MemberError(413, "Invalid chat room status."); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new MemberError(400, "Invalid chat room status."); }
}

export function roomFailure(error: unknown): Response {
  return error instanceof MemberError
    ? memberJSON({ error: error.message }, error.status)
    : memberJSON({ error: "The chat room status could not load." }, 503);
}

/** One seat per (member, browser session). Several tabs from one member share
 * a seat because the count only ever counts distinct member ids. */
export async function postRoomPresence(req: Request, store: RoomPresenceStore, profiles: ProfileStore,
  resolve: () => Promise<ProfileMember> = resolveCommunityProfileMember, now = Date.now()): Promise<Response> {
  if (req.method !== "POST") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req);
    const member = await resolve();
    const body = await readBody(req);
    if (!MEMBER_ID.test(String(body.session_id ?? "")) || !["inside", "left"].includes(String(body.state ?? ""))) {
      throw new MemberError(400, "Invalid chat room status.");
    }
    await bindOwner(profiles, member);
    const key = seatKey(member.id, String(body.session_id).toLowerCase());
    if (body.state === "left") await store.delete(key);
    else await store.setJSON(key, { room: ROOM, member_id: member.id, seen_at: now });
    return memberJSON({ ok: true, state: body.state, heartbeat_seconds: ROOM_HEARTBEAT_SECONDS, expires_in_seconds: ROOM_TTL_MS / 1000 });
  } catch (error) { return roomFailure(error); }
}

export type RoomStatus = {
  room: string; inside: number; owner_inside: boolean; owner_identified: boolean;
  heartbeat_seconds: number; expires_in_seconds: number; measured_at: string;
};

/** Live seat holders, de-duplicated by member. Stale seats are dropped from the
 * count on the way past and swept by the scheduled cleanup. */
export async function readRoomPresence(store: RoomPresenceStore, profiles: ProfileStore, now = Date.now()): Promise<RoomStatus> {
  const owner = await ownerBinding(profiles).catch(() => null);
  const present = new Set<string>();
  let pages = 0, keys = 0;
  for await (const page of store.list({ prefix: `rooms/${ROOM}/`, paginate: true })) {
    if (++pages > MAX_PAGES) throw new MemberError(503, "The chat room status is busy. Please try again.");
    const candidates = page.blobs
      .map(blob => ({ key: blob.key, match: KEY.exec(typeof blob.key === "string" ? blob.key : "") }))
      .filter((entry): entry is { key: string; match: RegExpExecArray } => !!entry.match && MEMBER_ID.test(entry.match[1]));
    if ((keys += page.blobs.length) > MAX_KEYS) throw new MemberError(503, "The chat room status is busy. Please try again.");
    for (let offset = 0; offset < candidates.length; offset += 12) {
      const batch = candidates.slice(offset, offset + 12).filter(entry => !present.has(entry.match[1].toLowerCase()));
      const seen = await Promise.all(batch.map(async entry => {
        const memberId = entry.match[1].toLowerCase();
        const at = seatSeenAt(await store.get(entry.key, { type: "json" }), memberId);
        return at !== null && at <= now + 5_000 && at > now - ROOM_TTL_MS ? memberId : null;
      }));
      for (const memberId of seen) if (memberId) present.add(memberId);
    }
  }
  return {
    room: CHAT_ROOM,
    inside: present.size,
    // Never gold without a securely identified owner account.
    owner_inside: !!owner && present.has(owner),
    owner_identified: !!owner,
    heartbeat_seconds: ROOM_HEARTBEAT_SECONDS,
    expires_in_seconds: Math.ceil(ROOM_TTL_MS / 1000),
    measured_at: new Date(now).toISOString(),
  };
}

/** Public status: a count and two flags. No names, ids, messages or emails. */
export async function getRoomPresence(req: Request, store: RoomPresenceStore, profiles: ProfileStore, now = Date.now()): Promise<Response> {
  if (req.method !== "GET") return memberJSON({ error: "Method not allowed." }, 405);
  try { return memberJSON(await readRoomPresence(store, profiles, now)); }
  catch (error) { return roomFailure(error); }
}

/** Sweeps seats left behind by a closed page or a dropped connection. */
export async function cleanupRoomPresence(store: RoomPresenceStore, now = Date.now(), budgetMs = 20_000): Promise<number> {
  const began = Date.now();
  let removed = 0;
  for await (const page of store.list({ prefix: `rooms/${ROOM}/`, paginate: true })) {
    for (const blob of page.blobs) {
      if (Date.now() - began > budgetMs) return removed;
      const match = KEY.exec(typeof blob.key === "string" ? blob.key : "");
      if (!match) continue;
      const at = seatSeenAt(await store.get(blob.key, { type: "json" }), match[1].toLowerCase());
      if (at === null || at <= now - ROOM_TTL_MS) { await store.delete(blob.key); removed++; }
    }
  }
  return removed;
}
