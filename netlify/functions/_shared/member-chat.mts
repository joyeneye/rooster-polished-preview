import { createHash } from "node:crypto";
import { getStore, getDeployStore } from "@netlify/blobs";
import type { Context } from "@netlify/functions";
import {
  assertSameOrigin, MEMBER_ID, MemberError, memberJSON, requireMember, type MemberResolver,
} from "./member-auth.mts";
import { moderateComment, POLICY_VERSION, type ModerationDecision } from "./comment-moderation.mts";
import { requireCommunityMember } from "./roster-access.mts";

export const CHAT_ROOM = "The Listening Room";
export const CHAT_TTL_MS = 60_000;
export const CHAT_RESET_RELEASE = "restore-community-2026-09-06-v1";
export type ChatMessage = { id: string; member_id: string; name: string; body: string; created_at: string };
type StoredChatMessage = ChatMessage & { request_id: string; moderation: ModerationDecision };
type Moderator = (input: { name: string; message: string }) => Promise<ModerationDecision>;
export interface ChatStore {
  list(options: { prefix: string; paginate: true }): AsyncIterable<{ blobs: { key: string }[] }>;
  get(key: string, options: { type: "json" }): Promise<unknown>;
  setJSON(key: string, value: unknown, options?: { onlyIfNew?: true }): Promise<{ modified: boolean }>;
  delete?(key: string): Promise<void>;
}

export function chatStore(context: Context): ChatStore {
  const options = { name: "member-listening-room", consistency: "strong" as const };
  return context.deploy.context === "production"
    ? getStore(options)
    : getDeployStore({ ...options, deployID: context.deploy.id });
}

const MESSAGE_ID = /^[a-f0-9]{64}$/;
const REQUEST_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const INDEX_SUFFIX = /^\d{13}-[a-f0-9]{64}$/;
const BAD_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const MAX_LIST_KEYS = 10000;
const MAX_LIST_PAGES = 100;
const CHAT_RESET_KEY = `maintenance/chat-reset/${CHAT_RESET_RELEASE}`;

export function chatFailure(error?: unknown): Response {
  return error instanceof MemberError
    ? memberJSON({ error: error.message }, error.status)
    : memberJSON({ error: "The room could not connect. Please try again in a moment." }, 503);
}

function asRecord(value: unknown): StoredChatMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const moderation = record.moderation as Partial<ModerationDecision> | undefined;
  if (typeof record.id !== "string" || !MESSAGE_ID.test(record.id) ||
      typeof record.member_id !== "string" || !MEMBER_ID.test(record.member_id) ||
      typeof record.name !== "string" || !record.name.trim() || record.name.length > 60 || /[\u0000-\u001f\u007f@]/u.test(record.name) ||
      typeof record.body !== "string" || !record.body.trim() || record.body.length > 500 || BAD_TEXT.test(record.body) ||
      typeof record.request_id !== "string" || !REQUEST_ID.test(record.request_id) ||
      typeof record.created_at !== "string" || !Number.isFinite(Date.parse(record.created_at)) ||
      !validModeration(moderation)) return null;
  return {
    id: record.id, member_id: record.member_id.toLowerCase(), name: record.name, body: record.body,
    request_id: record.request_id.toLowerCase(), created_at: new Date(record.created_at).toISOString(),
    moderation: moderation as ModerationDecision,
  };
}

function publicMessage(record: StoredChatMessage): ChatMessage | null {
  if (record.moderation.status !== "approved") return null;
  // A room response never includes email, tokens or private moderation data.
  return { id: record.id, member_id: record.member_id, name: record.name, body: record.body, created_at: record.created_at };
}

function validModeration(value: Partial<ModerationDecision> | undefined): boolean {
  if (!value || value.policy_version !== POLICY_VERSION ||
      typeof value.checked_at !== "string" || !Number.isFinite(Date.parse(value.checked_at))) return false;
  if (value.status === "approved") return value.reason === "positive_or_respectful";
  if (value.status === "rejected") return ["negative_or_abusive", "spam_or_private_info"].includes(value.reason ?? "");
  return value.status === "pending" && typeof value.reason === "string" && value.reason.length > 0;
}

async function reviewMessage(input: { name: string; message: string }, moderator: Moderator): Promise<ModerationDecision> {
  try {
    const decision = await moderator(input);
    if (validModeration(decision)) return decision;
  } catch { /* A moderation outage must never publish a room message. */ }
  return { status: "pending", reason: "moderation_unavailable", policy_version: POLICY_VERSION, checked_at: new Date().toISOString() };
}

function indexSuffix(message: ChatMessage): string {
  return `${String(9999999999999 - Date.parse(message.created_at)).padStart(13, "0")}-${message.id}`;
}

async function roomKeys(store: ChatStore): Promise<string[]> {
  const keys = new Set<string>();
  let pages = 0;
  for await (const page of store.list({ prefix: "room/", paginate: true })) {
    if (++pages > MAX_LIST_PAGES) throw new MemberError(503, "The room is busy. Please try again shortly.");
    for (const blob of page.blobs) {
      if (typeof blob.key === "string" && blob.key.startsWith("room/") && INDEX_SUFFIX.test(blob.key.slice(5))) keys.add(blob.key);
      if (keys.size > MAX_LIST_KEYS) throw new MemberError(503, "The room is busy. Please try again shortly.");
    }
  }
  // Do not depend on a provider-specific listing order.
  return [...keys].sort();
}

async function deleteKeysBestEffort(store: ChatStore, keys: string[]): Promise<void> {
  if (!store.delete) return;
  // Expiry cleanup is bounded to validated Chat Room keys and must never make
  // an otherwise healthy room read fail.
  await Promise.allSettled(keys.map(key => store.delete!(key)));
}

function resetComplete(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const marker = value as Record<string, unknown>;
  return marker.state === "done" && marker.release === CHAT_RESET_RELEASE;
}

/**
 * Clear the pre-release room once without exposing a permanent reset route.
 * Chat GET and POST both call this before doing any other room work, so a
 * concurrent send cannot land halfway through the reset.
 */
export async function ensureReleaseChatReset(store: ChatStore): Promise<boolean> {
  if (resetComplete(await store.get(CHAT_RESET_KEY, { type: "json" }))) return false;
  if (!store.delete) throw new MemberError(503, "The room is getting ready. Please try again in a moment.");

  const claim = await store.setJSON(CHAT_RESET_KEY, {
    state: "running", release: CHAT_RESET_RELEASE, started_at: new Date().toISOString(),
  }, { onlyIfNew: true });
  if (!claim.modified) {
    if (resetComplete(await store.get(CHAT_RESET_KEY, { type: "json" }))) return false;
    throw new MemberError(503, "The room is getting ready. Please try again in a moment.");
  }

  try {
    const keys = new Set<string>();
    for (const prefix of ["room/", "messages/"]) {
      for await (const page of store.list({ prefix, paginate: true })) {
        for (const blob of page.blobs) {
          if (typeof blob.key === "string" && blob.key.startsWith(prefix)) keys.add(blob.key);
        }
      }
    }
    const selected = [...keys];
    for (let offset = 0; offset < selected.length; offset += 25) {
      await Promise.all(selected.slice(offset, offset + 25).map(key => store.delete!(key)));
    }
    await store.setJSON(CHAT_RESET_KEY, {
      state: "done", release: CHAT_RESET_RELEASE, completed_at: new Date().toISOString(),
    });
    return true;
  } catch (error) {
    // A failed claimant releases the marker so the next request can finish.
    await store.delete(CHAT_RESET_KEY).catch(() => undefined);
    throw error;
  }
}

export async function getChatMessages(req: Request, store: ChatStore, resolveMember: MemberResolver = requireCommunityMember): Promise<Response> {
  if (req.method !== "GET") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req);
    await resolveMember();
    const params = new URL(req.url).searchParams;
    const limit = params.get("limit") ?? "50";
    const before = params.get("before");
    if (!/^\d{1,2}$/.test(limit) || Number(limit) < 1 || Number(limit) > 50 || (before && !INDEX_SUFFIX.test(before))) {
      throw new MemberError(400, "This room page could not be opened.");
    }
    const keys = (await roomKeys(store)).filter(key => !before || key.slice(5) > before);
    const selected = keys.slice(0, Number(limit));
    const messages: ChatMessage[] = [];
    // A maximum of 50 durable records, with at most ten concurrent reads.
    for (let offset = 0; offset < selected.length; offset += 10) {
      const page = await Promise.all(selected.slice(offset, offset + 10).map(async key => {
        const id = key.slice(-64);
        const record = asRecord(await store.get(`messages/${id}`, { type: "json" }));
        if (!record || record.id !== id || indexSuffix(record) !== key.slice(5)) {
          await deleteKeysBestEffort(store, [key]);
          return null;
        }
        if (Date.now() - Date.parse(record.created_at) >= CHAT_TTL_MS) {
          await deleteKeysBestEffort(store, [key, `messages/${id}`]);
          return null;
        }
        const message = publicMessage(record);
        if (!message) await deleteKeysBestEffort(store, [key]);
        return message;
      }));
      messages.push(...page.filter((message): message is ChatMessage => message !== null));
    }
    return memberJSON({ room: CHAT_ROOM, messages, next: keys.length > selected.length ? selected.at(-1)!.slice(5) : null });
  } catch (error) {
    return chatFailure(error);
  }
}

async function readSubmission(req: Request): Promise<Record<string, unknown>> {
  if ((req.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new MemberError(415, "This message format is not supported.");
  }
  const limit = 4096;
  if (Number(req.headers.get("content-length") || "0") > limit) throw new MemberError(413, "Your message is too large.");
  if (!req.body) throw new MemberError(400, "Please enter a message.");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new MemberError(413, "Your message is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value = JSON.parse(new TextDecoder().decode(buffer));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new MemberError(400, "Your message could not be read. Please try again.");
  }
}

export async function postChatMessage(
  req: Request, store: ChatStore, resolveMember: MemberResolver = requireCommunityMember, moderator: Moderator = moderateComment,
): Promise<Response> {
  if (req.method !== "POST") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req);
    const member = await resolveMember();
    const input = await readSubmission(req);
    if (typeof input.body !== "string") throw new MemberError(400, "Please enter a message.");
    const body = input.body.trim().replace(/\r\n?/g, "\n");
    if (!body || body.length > 500 || BAD_TEXT.test(body)) throw new MemberError(400, "Your message needs 1 to 500 characters.");
    if (typeof input.request_id !== "string" || !REQUEST_ID.test(input.request_id)) {
      throw new MemberError(400, "Please refresh the page before sending your message.");
    }
    const requestId = input.request_id.toLowerCase();
    // Bind idempotency to the authenticated member, never a supplied ID or name.
    const id = createHash("sha256").update(`${member.id}:${requestId}`).digest("hex");
    const key = `messages/${id}`;
    const existing = await store.get(key, { type: "json" });
    let record = asRecord(existing);
    let created = false;
    if (existing && !record) throw new Error("Invalid stored room message");
    if (!record) {
      const moderation = await reviewMessage({ name: member.name, message: body }, moderator);
      const candidate: StoredChatMessage = {
        id, member_id: member.id, name: member.name, body, created_at: new Date().toISOString(), request_id: requestId, moderation,
      };
      const result = await store.setJSON(key, candidate, { onlyIfNew: true });
      created = result.modified;
      record = created ? candidate : asRecord(await store.get(key, { type: "json" }));
    }
    if (!record || record.id !== id || record.member_id !== member.id || record.request_id !== requestId) throw new Error("Invalid saved room message");
    if (record.body !== body) throw new MemberError(409, "This send was already used. Please start a new message.");
    const message = publicMessage(record);
    if (!message) return memberJSON({ status: record.moderation.status, published: false }, record.moderation.status === "rejected" ? 422 : 202);
    // This atomic index is the public commit. Failed or unfinished writes stay
    // invisible; an identical retry repairs the index without replacing text.
    await store.setJSON(`room/${indexSuffix(message)}`, { id: message.id }, { onlyIfNew: true });
    return memberJSON({ status: "approved", published: true, message }, created ? 201 : 200);
  } catch (error) {
    return chatFailure(error);
  }
}
