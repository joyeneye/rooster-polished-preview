import { createHash } from "node:crypto";
import { getStore, getDeployStore } from "@netlify/blobs";
import type { Context } from "@netlify/functions";
import { MemberError, memberJSON, assertSameOrigin, MEMBER_ID } from "./member-auth.mts";
import { type ProfileMember } from "./member-profiles.mts";
import { isClipPublished, type ClipsStore } from "./member-clips.mts";
import { moderateComment, POLICY_VERSION, type ModerationDecision } from "./comment-moderation.mts";
import { resolveCommunityProfileMember } from "./roster-access.mts";

type Store = Pick<ClipsStore, "get" | "getWithMetadata" | "setJSON">;
type Options = { resolveMember?: () => Promise<ProfileMember>; moderate?: typeof moderateComment };
type Reaction = "apple" | "tomato" | null;
type ReactionRecord = { reaction: Reaction; request_id: string };
type Comment = { id: string; clip_id: string; member_id: string; request_id: string; name: string; body: string; created_at: string; moderation: ModerationDecision };
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const BAD_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const MAX_REACTORS = 5000, MAX_COMMENTS = 1000;
const idFor = (clip: string, member: string, request: string) => createHash("sha256").update(`${clip}:${member}:${request}`).digest("hex");
const publicComment = (value: Comment) => ({ id: value.id, name: value.name, body: value.body, created_at: value.created_at });
export function clipCommunityStore(context: Context): Store {
  const options = { name: "clip-community", consistency: "strong" as const };
  return context.deploy.context === "production" ? getStore(options) : getDeployStore({ ...options, deployID: context.deploy.id });
}
export function clipCommunityFailure(error?: unknown): Response {
  return error instanceof MemberError ? memberJSON({ error: error.message }, error.status)
    : memberJSON({ error: "Comments and reactions could not connect. Please try again." }, 503);
}
async function requirePublished(clips: ClipsStore, id: string): Promise<void> {
  if (!HASH.test(id) || !await isClipPublished(clips, id)) throw new MemberError(404, "This clip is not available.");
}
function reactions(value: any): Record<string, ReactionRecord> {
  if (value === null) return {};
  if (!value || typeof value !== "object" || !value.members || Array.isArray(value.members) || typeof value.members !== "object") throw new Error("Invalid reactions");
  const pairs = Object.entries(value.members);
  if (pairs.length > MAX_REACTORS) throw new Error("Too many reactions");
  const result: Record<string, ReactionRecord> = {};
  for (const [id, record] of pairs as [string, any][]) {
    if (!MEMBER_ID.test(id) || !record || !["apple", "tomato", null].includes(record.reaction) || !UUID.test(record.request_id)) throw new Error("Invalid member reaction");
    result[id] = { reaction: record.reaction, request_id: record.request_id };
  }
  return result;
}
function counts(values: Record<string, ReactionRecord>): { apple: number; tomato: number } {
  let apple = 0, tomato = 0;
  for (const value of Object.values(values)) { if (value.reaction === "apple") apple++; if (value.reaction === "tomato") tomato++; }
  return { apple, tomato };
}
function validModeration(value: any): value is ModerationDecision {
  return !!value && value.policy_version === POLICY_VERSION && typeof value.checked_at === "string" && Number.isFinite(Date.parse(value.checked_at)) &&
    (value.status === "approved" ? value.reason === "positive_or_respectful" : value.status === "rejected" ? ["negative_or_abusive", "spam_or_private_info"].includes(value.reason) : value.status === "pending" && typeof value.reason === "string" && value.reason.length > 0 && value.reason.length < 100);
}
function readComment(value: any, clip: string): Comment | null {
  if (!value || value.clip_id !== clip || !HASH.test(value.id) || !MEMBER_ID.test(value.member_id) || !UUID.test(value.request_id) ||
    value.id !== idFor(clip, value.member_id, value.request_id) || typeof value.name !== "string" || !value.name.trim() || value.name.length > 60 || /[\u0000-\u001f\u007f@]/u.test(value.name) ||
    typeof value.body !== "string" || !value.body.trim() || value.body.length > 500 || BAD_TEXT.test(value.body) || typeof value.created_at !== "string" || !Number.isFinite(Date.parse(value.created_at)) || !validModeration(value.moderation)) return null;
  return { id: value.id, clip_id: clip, member_id: value.member_id, request_id: value.request_id, name: value.name, body: value.body, created_at: value.created_at, moderation: value.moderation };
}
function comments(value: any, clip: string): Comment[] {
  if (value === null) return [];
  if (!value || !Array.isArray(value.comments) || value.comments.length > MAX_COMMENTS) throw new Error("Invalid comments");
  const unique = new Map<string, Comment>();
  for (const entry of value.comments) { const item = readComment(entry, clip); if (item?.moderation.status === "approved") unique.set(item.id, item); }
  return [...unique.values()];
}
async function inputJSON(req: Request): Promise<any> {
  if ((req.headers.get("content-type") || "").split(";", 1)[0].toLowerCase() !== "application/json") throw new MemberError(415, "This update format is not supported.");
  const LIMIT = 4096;
  if (Number(req.headers.get("content-length") || "0") > LIMIT || !req.body) throw new MemberError(413, "Your update is too large.");
  const reader = req.body.getReader(); const parts: Uint8Array[] = []; let size = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > LIMIT) { await reader.cancel(); throw new MemberError(413, "Your update is too large."); } parts.push(part.value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  try { const result = JSON.parse(new TextDecoder().decode(bytes)); if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error(); return result; }
  catch { throw new MemberError(400, "Your update could not be read."); }
}
function submission(input: any): { clip: string; request: string } {
  if (typeof input.clip_id !== "string" || !HASH.test(input.clip_id) || typeof input.request_id !== "string" || !UUID.test(input.request_id)) throw new MemberError(400, "Please refresh the clip and try again.");
  return { clip: input.clip_id, request: input.request_id.toLowerCase() };
}

export async function getClipCommunity(req: Request, store: Store, clips: ClipsStore, options: Options = {}): Promise<Response> {
  if (req.method !== "GET") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    const ids = new URL(req.url).searchParams.getAll("id");
    if (ids.length !== 1) throw new MemberError(400, "Choose a clip to open.");
    const id = ids[0]; await requirePublished(clips, id);
    let member: ProfileMember | null = null;
    try { member = await (options.resolveMember ?? resolveCommunityProfileMember)(); } catch { /* Approved clip discussions remain readable while logged out. */ }
    const values = reactions(await store.get(`reactions/${id}`, { type: "json" }));
    const allComments = comments(await store.get(`comment-feed/${id}`, { type: "json" }), id);
    allComments.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
    await requirePublished(clips, id);
    return memberJSON({ id, counts: counts(values), comments: allComments.slice(0, 50).map(publicComment), comment_count: allComments.length, my_reaction: member ? values[member.id]?.reaction ?? null : null, authenticated: member !== null, viewer_id: member?.id ?? null });
  } catch (error) { return clipCommunityFailure(error); }
}

export async function postClipReaction(req: Request, store: Store, clips: ClipsStore, options: Options = {}): Promise<Response> {
  if (req.method !== "POST") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req); const member = await (options.resolveMember ?? resolveCommunityProfileMember)();
    const input = await inputJSON(req); const { clip, request } = submission(input);
    if (!["apple", "tomato", null].includes(input.reaction)) throw new MemberError(400, "Choose an apple or tomato reaction.");
    const reaction: Reaction = input.reaction; await requirePublished(clips, clip);
    const key = `reactions/${clip}`;
    const initial = reactions(await store.get(key, { type: "json" }));
    const opKey = `reaction-updates/${idFor(clip, member.id, request)}`;
    const operation = { clip_id: clip, member_id: member.id, request_id: request, reaction, base_request: initial[member.id]?.request_id ?? null };
    const reserved = await store.setJSON(opKey, operation, { onlyIfNew: true });
    const saved = reserved.modified ? operation : await store.get(opKey, { type: "json" });
    if (!saved || saved.clip_id !== clip || saved.member_id !== member.id || saved.request_id !== request || saved.reaction !== reaction) throw new MemberError(409, "This reaction update was already used. Please try again.");
    for (let attempt = 0; attempt < 8; attempt++) {
      const previous = await store.getWithMetadata(key, { type: "json" }); const values = reactions(previous?.data ?? null);
      const current = values[member.id];
      if (current?.request_id === request) {
        if (current.reaction !== reaction) throw new Error("Invalid reaction retry");
        await requirePublished(clips, clip); return memberJSON({ id: clip, counts: counts(values), reaction });
      }
      if ((current?.request_id ?? null) !== saved.base_request) throw new MemberError(409, "Your reaction changed in another window. Refresh the clip and try again.");
      if (!current && Object.keys(values).length >= MAX_REACTORS) throw new MemberError(429, "This clip has reached its reaction limit.");
      values[member.id] = { reaction, request_id: request };
      await requirePublished(clips, clip);
      const written = await store.setJSON(key, { members: values }, previous ? { onlyIfMatch: previous.etag } : { onlyIfNew: true });
      if (!written.modified) continue;
      await requirePublished(clips, clip); return memberJSON({ id: clip, counts: counts(values), reaction });
    }
    throw new MemberError(409, "This clip is busy. Please try your reaction again.");
  } catch (error) { return clipCommunityFailure(error); }
}

export async function postClipComment(req: Request, store: Store, clips: ClipsStore, options: Options = {}): Promise<Response> {
  if (req.method !== "POST") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req); const member = await (options.resolveMember ?? resolveCommunityProfileMember)();
    const input = await inputJSON(req); const { clip, request } = submission(input);
    if (typeof input.body !== "string") throw new MemberError(400, "Write a comment first.");
    const body = input.body.trim().replace(/\r\n?/g, "\n");
    if (!body || body.length > 500 || BAD_TEXT.test(body)) throw new MemberError(400, "Your comment needs 1 to 500 characters.");
    await requirePublished(clips, clip);
    const id = idFor(clip, member.id, request); const key = `comments/${clip}/${id}`;
    const existing = await store.get(key, { type: "json" }); let record = readComment(existing, clip);
    if (existing && !record) throw new Error("Invalid saved comment");
    if (!record) {
      let moderation: ModerationDecision = { status: "pending", reason: "moderation_unavailable", policy_version: POLICY_VERSION, checked_at: new Date().toISOString() };
      try { const result = await (options.moderate ?? moderateComment)({ name: member.name, message: body }); if (validModeration(result)) moderation = result; } catch { /* A moderation outage never publishes text. */ }
      const candidate: Comment = { id, clip_id: clip, member_id: member.id, request_id: request, name: member.name, body, created_at: new Date().toISOString(), moderation };
      const written = await store.setJSON(key, candidate, { onlyIfNew: true });
      record = written.modified ? candidate : readComment(await store.get(key, { type: "json" }), clip);
    }
    if (!record || record.id !== id || record.member_id !== member.id || record.request_id !== request) throw new Error("Invalid comment operation");
    if (record.body !== body) throw new MemberError(409, "This comment upload was already used. Please start a new comment.");
    await requirePublished(clips, clip);
    if (record.moderation.status !== "approved") return memberJSON({ id: clip, status: record.moderation.status, published: false }, record.moderation.status === "rejected" ? 422 : 202);
    const feedKey = `comment-feed/${clip}`;
    for (let attempt = 0; attempt < 8; attempt++) {
      const previous = await store.getWithMetadata(feedKey, { type: "json" }); const entries = comments(previous?.data ?? null, clip);
      if (entries.some(entry => entry.id === id)) { await requirePublished(clips, clip); return memberJSON({ id: clip, status: "approved", published: true, comment: publicComment(record) }); }
      if (entries.length >= MAX_COMMENTS) throw new MemberError(429, "This clip has reached its comment limit.");
      await requirePublished(clips, clip);
      const written = await store.setJSON(feedKey, { comments: [...entries, record] }, previous ? { onlyIfMatch: previous.etag } : { onlyIfNew: true });
      if (!written.modified) continue;
      await requirePublished(clips, clip); return memberJSON({ id: clip, status: "approved", published: true, comment: publicComment(record) }, 201);
    }
    throw new MemberError(409, "This clip is busy. Please try your comment again.");
  } catch (error) { return clipCommunityFailure(error); }
}
