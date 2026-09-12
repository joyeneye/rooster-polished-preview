import { createHash } from "node:crypto";
import { getStore, getDeployStore } from "@netlify/blobs";
import type { Context } from "@netlify/functions";
import {
  assertSameOrigin, MEMBER_ID, MemberError, memberFailure, memberJSON,
  requireMember, type Member, type MemberResolver,
} from "./member-auth.mts";
import { normalizeMessagePhoto, type MessagePhoto, type PreparedPhoto } from "./private-message-photos.mts";
import { validatePrivateMessageVideo, MAX_PRIVATE_VIDEO_BYTES, MAX_PRIVATE_VIDEO_SECONDS } from "./private-message-videos.mts";
import { requireCommunityMember } from "./roster-access.mts";

export type MessageVideo = { url: string; mime: "video/mp4" | "video/webm"; width: number; height: number; duration: number };
type PreparedVideo = Omit<MessageVideo, "url"> & { bytes: ArrayBuffer; digest: string; sourceDigest: string };

export type MemberMessage = {
  id: string;
  sender_id: string;
  recipient_id: string;
  sender_name: string;
  recipient_name: string;
  subject: string;
  body: string;
  created_at: string;
  photo?: MessagePhoto;
  video?: MessageVideo;
};

type StoredMessage = MemberMessage & {
  request_id: string; photo_digest?: string; photo_source_digest?: string;
  video_digest?: string; video_source_digest?: string;
};
export interface MemberStore {
  list(options: { prefix: string; paginate: true }): AsyncIterable<{ blobs: { key: string }[] }>;
  get(key: string, options: { type: "json" }): Promise<unknown>;
  setJSON(key: string, value: unknown, options?: { onlyIfNew?: boolean }): Promise<{ modified: boolean }>;
  delete?(key: string): Promise<void>;
}
export interface MemberPhotoStore {
  get(key: string, options: { type: "arrayBuffer" }): Promise<ArrayBuffer | null>;
  set(key: string, bytes: ArrayBuffer, options: { onlyIfNew: true }): Promise<{ modified: boolean }>;
}
export type MemberStores = {
  directory: MemberStore; messages: MemberStore;
  photos?: MemberPhotoStore; videos?: MemberPhotoStore;
};

export function memberStores(context: Context): MemberStores {
  const store = (name: string) => context.deploy.context === "production"
    ? getStore({ name, consistency: "strong" })
    : getDeployStore({ name, consistency: "strong", deployID: context.deploy.id });
  return {
    directory: store("member-directory"), messages: store("member-private-messages"),
    photos: store("member-private-message-photos"),
    videos: store("member-private-message-videos"),
  };
}

const MESSAGE_ID = /^[a-f0-9]{64}$/;
const INDEX_SUFFIX = /^\d{13}-[a-f0-9]{64}$/;
const BAD_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const MAX_LIST_KEYS = 10000;
const MAX_LIST_PAGES = 100;

type UnreadMarker = { id: string; recipient_id: string; created_at: string };
type ReadReceipt = { id: string; recipient_id: string; read_at: string };

function asMember(value: unknown): Member | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || !MEMBER_ID.test(record.id) ||
      typeof record.name !== "string" || !record.name.trim() || record.name.length > 60 ||
      /[\u0000-\u001f\u007f@]/.test(record.name)) return null;
  return { id: record.id.toLowerCase(), name: record.name };
}

function isRetiredWelcome(record: Record<string, unknown>): boolean {
  return record.request_id === "member-welcome:v1" &&
    typeof record.recipient_id === "string" && MEMBER_ID.test(record.recipient_id) &&
    record.id === createHash("sha256")
      .update(`jwhite:member-welcome:v1:${record.recipient_id.toLowerCase()}`).digest("hex");
}

function asMessage(value: unknown, includeRetired = false): MemberMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || !MESSAGE_ID.test(record.id) ||
      typeof record.sender_id !== "string" || !MEMBER_ID.test(record.sender_id) ||
      typeof record.recipient_id !== "string" || !MEMBER_ID.test(record.recipient_id) ||
      typeof record.sender_name !== "string" || !record.sender_name || record.sender_name.length > 60 ||
      typeof record.recipient_name !== "string" || !record.recipient_name || record.recipient_name.length > 60 ||
      typeof record.subject !== "string" || !record.subject || record.subject.length > 100 ||
      typeof record.body !== "string" || record.body.length > 3000 ||
      typeof record.created_at !== "string" || !Number.isFinite(Date.parse(record.created_at))) return null;
  // Retire only the server-generated welcome, including older brand wording.
  // Member-written messages may quote the same text and must remain visible.
  if (!includeRetired && isRetiredWelcome(record)) return null;
  let photo: MessagePhoto | undefined;
  let video: MessageVideo | undefined;
  if (record.photo !== undefined && record.video !== undefined) return null;
  if (record.photo !== undefined) {
    if (!record.photo || typeof record.photo !== "object" || Array.isArray(record.photo)) return null;
    const attachment = record.photo as Record<string, unknown>;
    if (attachment.url !== `/api/member-message-photo/${record.id}` ||
        attachment.mime !== "image/jpeg" ||
        !Number.isInteger(attachment.width) || Number(attachment.width) < 1 || Number(attachment.width) > 4096 ||
        !Number.isInteger(attachment.height) || Number(attachment.height) < 1 || Number(attachment.height) > 4096 ||
        Number(attachment.width) * Number(attachment.height) > 16000000) return null;
    photo = { url: attachment.url as string, mime: "image/jpeg", width: Number(attachment.width), height: Number(attachment.height) };
  }
  if (record.video !== undefined) {
    if (!record.video || typeof record.video !== "object" || Array.isArray(record.video)) return null;
    const attachment = record.video as Record<string, unknown>;
    if (attachment.url !== `/api/member-message-video/${record.id}` ||
        (attachment.mime !== "video/mp4" && attachment.mime !== "video/webm") ||
        !Number.isInteger(attachment.width) || Number(attachment.width) < 1 || Number(attachment.width) > 1920 ||
        !Number.isInteger(attachment.height) || Number(attachment.height) < 1 || Number(attachment.height) > 1920 ||
        Number(attachment.width) * Number(attachment.height) > 4000000 ||
        typeof attachment.duration !== "number" || !Number.isFinite(attachment.duration) ||
        attachment.duration <= 0 || attachment.duration > MAX_PRIVATE_VIDEO_SECONDS) return null;
    video = {
      url: attachment.url as string, mime: attachment.mime,
      width: Number(attachment.width), height: Number(attachment.height), duration: attachment.duration,
    };
  }
  if (!record.body && !photo && !video) return null;
  return {
    id: record.id, sender_id: record.sender_id, recipient_id: record.recipient_id,
    sender_name: record.sender_name, recipient_name: record.recipient_name,
    subject: record.subject, body: record.body, created_at: record.created_at,
    ...(photo ? { photo } : {}),
    ...(video ? { video } : {}),
  };
}

function asUnreadMarker(value: unknown): UnreadMarker | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || !MESSAGE_ID.test(record.id) ||
      typeof record.recipient_id !== "string" || !MEMBER_ID.test(record.recipient_id) ||
      typeof record.created_at !== "string" || !Number.isFinite(Date.parse(record.created_at))) return null;
  return { id: record.id, recipient_id: record.recipient_id.toLowerCase(), created_at: record.created_at };
}

function asReadReceipt(value: unknown): ReadReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || !MESSAGE_ID.test(record.id) ||
      typeof record.recipient_id !== "string" || !MEMBER_ID.test(record.recipient_id) ||
      typeof record.read_at !== "string" || !Number.isFinite(Date.parse(record.read_at))) return null;
  return { id: record.id, recipient_id: record.recipient_id.toLowerCase(), read_at: record.read_at };
}

async function syncMember(member: Member, store: MemberStore): Promise<void> {
  const key = `members/${member.id}`;
  const current = asMember(await store.get(key, { type: "json" }));
  if (!current || current.name !== member.name) await store.setJSON(key, member);
}

async function listKeys(store: MemberStore, prefix: string): Promise<string[]> {
  const keys = new Set<string>();
  let pages = 0;
  for await (const page of store.list({ prefix, paginate: true })) {
    if (++pages > MAX_LIST_PAGES) throw new MemberError(503, "Your message list is too large to load right now.");
    for (const blob of page.blobs) {
      // A storage result can never choose a different user's namespace.
      if (typeof blob.key === "string" && blob.key.startsWith(prefix)) keys.add(blob.key);
      if (keys.size > MAX_LIST_KEYS) throw new MemberError(503, "Your message list is too large to load right now.");
    }
  }
  return [...keys].sort();
}

async function readBounded<T>(items: string[], read: (key: string) => Promise<T>): Promise<T[]> {
  const results: T[] = [];
  for (let offset = 0; offset < items.length; offset += 12) {
    results.push(...await Promise.all(items.slice(offset, offset + 12).map(read)));
  }
  return results;
}

type MessageJSONReader = (key: string) => Promise<unknown>;

async function unreadMessageIds(
  store: MemberStore, member: Member, read: MessageJSONReader = key => store.get(key, { type: "json" }),
): Promise<Set<string>> {
  const prefix = `unread/${member.id}/`;
  const keys = (await listKeys(store, prefix)).filter(key => MESSAGE_ID.test(key.slice(prefix.length)));
  const ids = await readBounded(keys, async key => {
    const id = key.slice(prefix.length);
    const [rawMarker, rawMessage, delivered, rawReceipt] = await Promise.all([
      read(key),
      read(`messages/${id}`),
      read(`delivered/${id}`),
      read(`read/${member.id}/${id}`),
    ]);
    const marker = asUnreadMarker(rawMarker);
    const message = asMessage(rawMessage);
    const receipt = asReadReceipt(rawReceipt);
    if (!marker || marker.id !== id || marker.recipient_id !== member.id ||
        !message || message.id !== id || message.recipient_id !== member.id ||
        !delivered || typeof delivered !== "object" || (delivered as { id?: unknown }).id !== id) return null;
    if (receipt && receipt.id === id && receipt.recipient_id === member.id) return null;
    return id;
  });
  return new Set(ids.filter((id): id is string => id !== null));
}

function indexSuffix(message: MemberMessage): string {
  // Stable sort works without relying on the object store's listing order.
  return `${String(9999999999999 - Date.parse(message.created_at)).padStart(13, "0")}-${message.id}`;
}

async function messagePage(
  store: MemberStore, member: Member, folder: "inbox" | "sent", limit: number, before: string | null,
  read: MessageJSONReader = key => store.get(key, { type: "json" }),
): Promise<{ messages: MemberMessage[]; retired: string[]; next: string | null }> {
  if (before && !INDEX_SUFFIX.test(before)) throw new MemberError(400, "This message page could not be opened.");
  const prefix = `${folder}/${member.id}/`;
  const keys = (await listKeys(store, prefix)).filter(key => {
    const suffix = key.slice(prefix.length);
    return INDEX_SUFFIX.test(suffix) && (!before || suffix > before);
  });
  const records: MemberMessage[] = [];
  const retired: string[] = [];
  let offset = 0;
  // Older welcomes remain archived, but must not occupy visible inbox/sent
  // pages. Read through them and keep one visible lookahead for pagination.
  while (offset < keys.length && records.length <= limit) {
    const selected = keys.slice(offset, offset + Math.max(12, limit + 1 - records.length));
    offset += selected.length;
    const batch = await readBounded(selected, async key => {
      const id = key.slice(-64);
      const [rawMessage, committed] = await Promise.all([
        read(`messages/${id}`),
        read(`delivered/${id}`),
      ]);
      if (!committed || typeof committed !== "object" || (committed as Record<string, unknown>).id !== id) return null;
      const message = asMessage(rawMessage, true);
      if (!message || message.id !== id || indexSuffix(message) !== key.slice(prefix.length)) return null;
      // Recheck the participant on every record, even behind a per-user index.
      if (folder === "inbox" ? message.recipient_id !== member.id : message.sender_id !== member.id) return null;
      // An omitted record alone cannot clear a chat already open in a browser.
      // Only return retirement IDs after verifying this user's committed index
      // and both of the original system identifiers. Never return private text.
      if (isRetiredWelcome(rawMessage as Record<string, unknown>)) {
        retired.push(message.id);
        return null;
      }
      return message;
    });
    records.push(...batch.filter((record): record is MemberMessage => record !== null));
  }
  const messages = records.slice(0, limit);
  return {
    messages, retired,
    next: records.length > limit ? indexSuffix(messages.at(-1)!) : null,
  };
}

async function memberPage(store: MemberStore, member: Member, after: string | null) {
  if (after && !MEMBER_ID.test(after)) throw new MemberError(400, "This member page could not be opened.");
  const prefix = "members/";
  const keys = (await listKeys(store, prefix)).filter(key => {
    const id = key.slice(prefix.length);
    return MEMBER_ID.test(id) && id !== member.id && (!after || id > after.toLowerCase());
  });
  const selected = keys.slice(0, 100);
  const members = await readBounded(selected, async key => {
    const record = asMember(await store.get(key, { type: "json" }));
    return record?.id === key.slice(prefix.length) ? record : null;
  });
  return {
    members: members.filter((record): record is Member => record !== null).sort((a, b) => a.name.localeCompare(b.name)),
    next: keys.length > 100 ? selected.at(-1)!.slice(prefix.length) : null,
  };
}

export async function getMemberMessages(
  req: Request, stores: MemberStores, resolveMember: MemberResolver = requireCommunityMember,
): Promise<Response> {
  if (req.method !== "GET") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req);
    const member = await resolveMember();
    const params = new URL(req.url).searchParams;
    const rawLimit = params.get("limit") ?? "50";
    if (!/^\d{1,3}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100) {
      throw new MemberError(400, "Choose a message page size from 1 to 100.");
    }
    const directoryOption = params.get("directory") ?? "1";
    if (params.getAll("directory").length > 1 || !["0", "1"].includes(directoryOption)) {
      throw new MemberError(400, "This message view could not be opened.");
    }
    if (params.get("members_after") && !MEMBER_ID.test(params.get("members_after")!)) {
      throw new MemberError(400, "This member page could not be opened.");
    }
    // Inbox records and unread counts share message/commit reads only inside
    // this authenticated request. No private result is cached across requests.
    const reads = new Map<string, Promise<unknown>>();
    const read: MessageJSONReader = key => {
      let pending = reads.get(key);
      if (!pending) { pending = stores.messages.get(key, { type: "json" }); reads.set(key, pending); }
      return pending;
    };
    const [inbox, sent, directory, unreadIds] = await Promise.all([
      messagePage(stores.messages, member, "inbox", Number(rawLimit), params.get("inbox_before"), read),
      messagePage(stores.messages, member, "sent", Number(rawLimit), params.get("sent_before"), read),
      // A conversation already knows its recipient and needs no directory.
      directoryOption === "0" ? { members: [], next: null } : memberPage(stores.directory, member, params.get("members_after")),
      unreadMessageIds(stores.messages, member, read),
      syncMember(member, stores.directory),
    ]);
    return memberJSON({
      inbox: inbox.messages, sent: sent.messages, members: directory.members, user: member,
      retired_message_ids: [...new Set([...inbox.retired, ...sent.retired])].sort(),
      unread_count: unreadIds.size,
      unread_ids: inbox.messages.filter(message => unreadIds.has(message.id)).map(message => message.id),
      next: { inbox_before: inbox.next, sent_before: sent.next, members_after: directory.next },
    });
  } catch (error) {
    return memberFailure(error);
  }
}

export async function getMemberUnreadMessages(
  req: Request, stores: MemberStores, resolveMember: MemberResolver = requireCommunityMember,
): Promise<Response> {
  if (req.method !== "GET") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req);
    const member = await resolveMember();
    const unreadIds = await unreadMessageIds(stores.messages, member);
    return memberJSON({ unread_count: unreadIds.size, user: member });
  } catch (error) {
    return memberFailure(error);
  }
}

async function readSmallJSON(req: Request): Promise<Record<string, unknown>> {
  if ((req.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new MemberError(415, "This message update format is not supported.");
  }
  const limit = 4096;
  if (Number(req.headers.get("content-length") || "0") > limit || !req.body) {
    throw new MemberError(413, "This message update is too large.");
  }
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
        throw new MemberError(413, "This message update is too large.");
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
    return value as Record<string, unknown>;
  } catch {
    throw new MemberError(400, "This message could not be marked as read.");
  }
}

export async function markMemberMessageRead(
  req: Request, stores: MemberStores, resolveMember: MemberResolver = requireCommunityMember,
): Promise<Response> {
  if (req.method !== "POST") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req);
    const member = await resolveMember();
    const input = await readSmallJSON(req);
    if (Object.keys(input).length !== 1 || typeof input.message_id !== "string" || !MESSAGE_ID.test(input.message_id)) {
      throw new MemberError(400, "Choose a valid message to open.");
    }
    const id = input.message_id;
    const [rawMessage, delivered] = await Promise.all([
      stores.messages.get(`messages/${id}`, { type: "json" }),
      stores.messages.get(`delivered/${id}`, { type: "json" }),
    ]);
    const message = asMessage(rawMessage);
    if (!message || message.id !== id || message.recipient_id !== member.id ||
        !delivered || typeof delivered !== "object" || (delivered as { id?: unknown }).id !== id) {
      throw new MemberError(404, "Message not found.");
    }
    const receiptKey = `read/${member.id}/${id}`;
    const receipt: ReadReceipt = { id, recipient_id: member.id, read_at: new Date().toISOString() };
    await stores.messages.setJSON(receiptKey, receipt, { onlyIfNew: true });
    const saved = asReadReceipt(await stores.messages.get(receiptKey, { type: "json" }));
    if (!saved || saved.id !== id || saved.recipient_id !== member.id) throw new Error("Message read receipt could not be verified");
    try { await stores.messages.delete?.(`unread/${member.id}/${id}`); } catch { /* The receipt remains authoritative. */ }
    const unreadIds = await unreadMessageIds(stores.messages, member);
    return memberJSON({ message_id: id, read: true, unread_count: unreadIds.size });
  } catch (error) {
    return memberFailure(error);
  }
}

async function prepareMessageVideo(value: FormDataEntryValue): Promise<PreparedVideo> {
  if (!(value instanceof File)) throw new MemberError(415, "Choose a valid MP4 or WebM video.");
  if (!value.size || value.size > MAX_PRIVATE_VIDEO_BYTES) throw new MemberError(413, "Choose a video up to 4 MB.");
  const source = await value.arrayBuffer();
  try {
    const video = validatePrivateMessageVideo(source, value.type);
    return {
      ...video,
      digest: createHash("sha256").update(new Uint8Array(video.bytes)).digest("hex"),
      sourceDigest: createHash("sha256").update(new Uint8Array(source)).digest("hex"),
    };
  } catch (error) {
    throw new MemberError(415, error instanceof Error ? error.message : "Choose a valid MP4 or WebM video up to 30 seconds.");
  }
}

async function readSubmission(req: Request): Promise<{ input: Record<string, unknown>; photo: PreparedPhoto | null; video: PreparedVideo | null }> {
  const contentType = req.headers.get("content-type") || "";
  const format = contentType.split(";", 1)[0].trim().toLowerCase();
  if (format !== "application/json" && format !== "multipart/form-data") {
    throw new MemberError(415, "This message format is not supported.");
  }
  const limit = format === "multipart/form-data" ? 4.25 * 1024 * 1024 : 20000;
  if (Number(req.headers.get("content-length") || "0") > limit) throw new MemberError(413, "Your message is too large.");
  if (!req.body) throw new MemberError(400, "Please enter your message.");
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
  if (format === "multipart/form-data") {
    let form: FormData;
    try { form = await new Response(buffer, { headers: { "Content-Type": contentType } }).formData(); }
    catch { throw new MemberError(400, "Your message could not be read. Please try again."); }
    const input: Record<string, unknown> = {};
    for (const name of ["recipient_id", "request_id", "subject", "body"]) {
      const entries = form.getAll(name);
      if (entries.length > 1 || entries.some(value => typeof value !== "string")) {
        throw new MemberError(400, "Please submit one message at a time.");
      }
      input[name] = entries[0] ?? "";
    }
    const photos = form.getAll("photo");
    const videos = form.getAll("video");
    if (photos.length + videos.length > 1) throw new MemberError(400, "Choose one photo or video for each message.");
    const photo = photos.length ? await normalizeMessagePhoto(photos[0]) : null;
    const video = videos.length ? await prepareMessageVideo(videos[0]) : null;
    return { input, photo, video };
  }
  try {
    const value = JSON.parse(new TextDecoder().decode(buffer));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return { input: value, photo: null, video: null };
  } catch {
    throw new MemberError(400, "Your message could not be read. Please try again.");
  }
}

async function ensureIndexes(store: MemberStore, message: MemberMessage): Promise<void> {
  const suffix = indexSuffix(message);
  const sentKey = `sent/${message.sender_id}/${suffix}`;
  const inboxKey = `inbox/${message.recipient_id}/${suffix}`;
  const deliveredKey = `delivered/${message.id}`;
  const unreadKey = `unread/${message.recipient_id}/${message.id}`;
  const priorDelivery = await store.get(deliveredKey, { type: "json" });
  const alreadyDelivered = Boolean(priorDelivery && typeof priorDelivery === "object" &&
    (priorDelivery as { id?: unknown }).id === message.id);
  if (priorDelivery && !alreadyDelivered) throw new Error("Invalid message delivery commit");
  await Promise.all([
    store.setJSON(sentKey, { id: message.id }, { onlyIfNew: true }),
    store.setJSON(inboxKey, { id: message.id }, { onlyIfNew: true }),
    // These three independent writes all finish before the visibility commit.
    // Existing delivered messages stay read when an old send is retried.
    ...(!alreadyDelivered ? [store.setJSON(unreadKey, {
      id: message.id, recipient_id: message.recipient_id, created_at: message.created_at,
    } satisfies UnreadMarker, { onlyIfNew: true })] : []),
  ]);
  // Partial index writes stay invisible in both folders until this last atomic
  // commit. Retrying an interrupted send repairs indexes and then commits it.
  await store.setJSON(deliveredKey, { id: message.id }, { onlyIfNew: true });
  const [sent, inbox, delivered, unread] = await Promise.all([
    store.get(sentKey, { type: "json" }),
    store.get(inboxKey, { type: "json" }),
    store.get(deliveredKey, { type: "json" }),
    store.get(unreadKey, { type: "json" }),
  ]) as { id?: string }[];
  if (sent?.id !== message.id || inbox?.id !== message.id || delivered?.id !== message.id) {
    throw new Error("Message delivery indexes could not be verified");
  }
  if (!alreadyDelivered) {
    const marker = asUnreadMarker(unread);
    if (!marker || marker.id !== message.id || marker.recipient_id !== message.recipient_id) {
      throw new Error("Message unread marker could not be verified");
    }
  }
}

/** Keep the ordinary message path available after verified onboarding without
 * creating an automatic private welcome or a notification. The site owner
 * still comes from the protected profile binding, never client input.
 */
export async function registerMemberMessageParticipants(
  recipient: Member, owner: Member, stores: MemberStores,
): Promise<void> {
  const to = asMember(recipient), from = asMember(owner);
  if (!to || !from) throw new Error("Invalid welcome participants");
  await Promise.all([syncMember(from, stores.directory), syncMember(to, stores.directory)]);
}

export async function sendMemberMessage(
  req: Request, stores: MemberStores, resolveMember: MemberResolver = requireCommunityMember,
): Promise<Response> {
  if (req.method !== "POST") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req);
    const sender = await resolveMember();
    const { input, photo, video } = await readSubmission(req);
    if (typeof input.recipient_id !== "string" || !MEMBER_ID.test(input.recipient_id)) {
      throw new MemberError(400, "Choose a member to send your message to.");
    }
    if (typeof input.request_id !== "string" || !MEMBER_ID.test(input.request_id)) {
      throw new MemberError(400, "Please refresh the page before sending your message.");
    }
    if (typeof input.subject !== "string" || typeof input.body !== "string") {
      throw new MemberError(400, "Please enter a subject and a message.");
    }
    const subject = input.subject.trim().replace(/\s+/g, " ") || (photo ? "Photo" : video ? "Video" : "");
    const body = input.body.trim().replace(/\r\n?/g, "\n");
    if (!subject || subject.length > 100 || BAD_TEXT.test(subject)) throw new MemberError(400, "Your subject needs 1 to 100 characters.");
    if ((!body && !photo && !video) || body.length > 3000 || BAD_TEXT.test(body)) throw new MemberError(400, "Add a message, photo or video. Messages can have up to 3,000 characters.");
    if (photo && !stores.photos) throw new Error("Private photo store is unavailable");
    if (video && !stores.videos) throw new Error("Private video store is unavailable");
    const recipientId = input.recipient_id.toLowerCase();
    if (recipientId === sender.id) throw new MemberError(400, "Choose another member to send your message to.");
    const [rawRecipient, rawSender] = await Promise.all([
      stores.directory.get(`members/${recipientId}`, { type: "json" }),
      stores.directory.get(`members/${sender.id}`, { type: "json" }),
    ]);
    const recipient = asMember(rawRecipient);
    if (!recipient || recipient.id !== recipientId) throw new MemberError(404, "That member is not available for messages yet.");
    const currentSender = asMember(rawSender);
    if (!currentSender || currentSender.name !== sender.name) await stores.directory.setJSON(`members/${sender.id}`, sender);
    const requestId = input.request_id.toLowerCase();
    const id = createHash("sha256").update(`${sender.id}:${requestId}`).digest("hex");
    const key = `messages/${id}`;
    const candidate: StoredMessage = {
      id, sender_id: sender.id, recipient_id: recipient.id,
      sender_name: sender.name, recipient_name: recipient.name,
      subject, body, created_at: new Date().toISOString(), request_id: requestId,
      ...(photo ? {
        photo: { url: `/api/member-message-photo/${id}`, mime: photo.mime, width: photo.width, height: photo.height },
        photo_digest: photo.digest, photo_source_digest: photo.sourceDigest,
      } : {}),
      ...(video ? {
        video: { url: `/api/member-message-video/${id}`, mime: video.mime, width: video.width, height: video.height, duration: video.duration },
        video_digest: video.digest, video_source_digest: video.sourceDigest,
      } : {}),
    };
    const write = await stores.messages.setJSON(key, candidate, { onlyIfNew: true });
    let message: MemberMessage | null = candidate;
    if (!write.modified) {
      const existing = await stores.messages.get(key, { type: "json" }) as StoredMessage | null;
      message = asMessage(existing);
      if (!message || message.id !== id || message.sender_id !== sender.id) throw new Error("Invalid saved message");
      if (message.recipient_id !== recipientId || message.subject !== subject || message.body !== body ||
          existing?.photo_digest !== photo?.digest || existing?.photo_source_digest !== photo?.sourceDigest ||
          existing?.video_digest !== video?.digest || existing?.video_source_digest !== video?.sourceDigest) {
        throw new MemberError(409, "This send was already used for another message. Please start a new message.");
      }
    }
    if (photo) {
      // The immutable message record wins before any attachment is written.
      // A different retry cannot replace this message's bytes or its metadata.
      const photoKey = `photos/${id}/${photo.digest}`;
      const photoWrite = await stores.photos!.set(photoKey, photo.bytes, { onlyIfNew: true });
      if (!photoWrite.modified) {
        const existingBytes = await stores.photos!.get(photoKey, { type: "arrayBuffer" });
        if (!existingBytes || createHash("sha256").update(new Uint8Array(existingBytes)).digest("hex") !== photo.digest) {
          throw new Error("Private photo could not be verified");
        }
      }
    }
    if (video) {
      const videoKey = `videos/${id}/${video.digest}`;
      const videoWrite = await stores.videos!.set(videoKey, video.bytes, { onlyIfNew: true });
      if (!videoWrite.modified) {
        const existingBytes = await stores.videos!.get(videoKey, { type: "arrayBuffer" });
        if (!existingBytes || createHash("sha256").update(new Uint8Array(existingBytes)).digest("hex") !== video.digest) {
          throw new Error("Private video could not be verified");
        }
      }
    }
    // A send is acknowledged only after both durable per-user indexes exist.
    // A retry repairs either missing index without duplicating or replacing text.
    await ensureIndexes(stores.messages, message);
    return memberJSON({ message: asMessage(message) }, write.modified ? 201 : 200);
  } catch (error) {
    return memberFailure(error);
  }
}

export function protectPrivateMessageMedia(response: Response): Response {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Netlify-CDN-Cache-Control", "no-store");
  response.headers.set("CDN-Cache-Control", "no-store");
  response.headers.set("Vary", "Cookie, Authorization");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  response.headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

function videoResponse(req: Request, bytes: ArrayBuffer, mime: MessageVideo["mime"]): Response {
  const length = bytes.byteLength;
  const headers = new Headers({
    "Content-Type": mime,
    "Content-Disposition": `inline; filename="private-video.${mime === "video/mp4" ? "mp4" : "webm"}"`,
    "Accept-Ranges": "bytes", "Content-Length": String(length),
  });
  const range = req.headers.get("range");
  if (!range) return new Response(bytes, { headers });
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  let start = 0, end = length - 1, valid = Boolean(match && (match[1] || match[2]));
  if (valid && match) {
    if (!match[1]) {
      const suffix = Number(match[2]);
      valid = Number.isSafeInteger(suffix) && suffix > 0;
      start = Math.max(0, length - suffix);
    } else {
      start = Number(match[1]);
      const requestedEnd = match[2] ? Number(match[2]) : end;
      valid = Number.isSafeInteger(start) && Number.isSafeInteger(requestedEnd) &&
        start >= 0 && start < length && requestedEnd >= start;
      end = Math.min(requestedEnd, end);
    }
  }
  if (!valid) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${length}`, "Accept-Ranges": "bytes" } });
  }
  headers.set("Content-Range", `bytes ${start}-${end}/${length}`);
  headers.set("Content-Length", String(end - start + 1));
  return new Response(bytes.slice(start, end + 1), { status: 206, headers });
}

async function getMemberMessageMedia(
  kind: "photo" | "video", req: Request, stores: MemberStores, resolveMember: MemberResolver,
): Promise<Response> {
  const notFound = `${kind === "photo" ? "Photo" : "Video"} not found.`;
  if (req.method !== "GET") return protectPrivateMessageMedia(memberJSON({ error: "Method not allowed." }, 405));
  try {
    assertSameOrigin(req);
    const member = await resolveMember();
    const id = new URL(req.url).pathname.split("/").at(-1) ?? "";
    if (!MESSAGE_ID.test(id)) throw new MemberError(404, notFound);
    const [raw, delivered] = await Promise.all([
      stores.messages.get(`messages/${id}`, { type: "json" }),
      stores.messages.get(`delivered/${id}`, { type: "json" }),
    ]);
    const message = asMessage(raw);
    const record = raw as StoredMessage | null;
    const attachment = message?.[kind];
    const digest = record?.[`${kind}_digest`];
    if (!message || message.id !== id || !attachment ||
        (message.sender_id !== member.id && message.recipient_id !== member.id) ||
        !delivered || typeof delivered !== "object" || (delivered as { id?: unknown }).id !== id ||
        !digest || !MESSAGE_ID.test(digest)) {
      throw new MemberError(404, notFound);
    }
    // Authorization and the delivery commit are rechecked for every request,
    // including byte ranges. The browser never receives a storage URL or key.
    const store = kind === "photo" ? stores.photos : stores.videos;
    const bytes = await store?.get(`${kind}s/${id}/${digest}`, { type: "arrayBuffer" });
    const maxBytes = kind === "photo" ? 3 * 1024 * 1024 : MAX_PRIVATE_VIDEO_BYTES;
    if (!bytes || !bytes.byteLength || bytes.byteLength > maxBytes ||
        createHash("sha256").update(new Uint8Array(bytes)).digest("hex") !== digest) {
      throw new MemberError(404, notFound);
    }
    if (kind === "video") {
      return protectPrivateMessageMedia(videoResponse(req, bytes, attachment.mime as MessageVideo["mime"]));
    }
    return protectPrivateMessageMedia(new Response(bytes, {
      headers: { "Content-Type": attachment.mime, "Content-Disposition": 'inline; filename="private-photo.jpg"' },
    }));
  } catch (error) {
    // A private URL gives no existence signal to unauthenticated visitors or
    // people outside its conversation. Authentication failures read no stores.
    if (error instanceof MemberError && (error.status === 401 || error.status === 403 || error.status === 404)) {
      return protectPrivateMessageMedia(memberJSON({ error: notFound }, 404));
    }
    return protectPrivateMessageMedia(memberFailure(error));
  }
}

export async function getMemberMessagePhoto(
  req: Request, stores: MemberStores, resolveMember: MemberResolver = requireCommunityMember,
): Promise<Response> {
  return getMemberMessageMedia("photo", req, stores, resolveMember);
}

export async function getMemberMessageVideo(
  req: Request, stores: MemberStores, resolveMember: MemberResolver = requireCommunityMember,
): Promise<Response> {
  return getMemberMessageMedia("video", req, stores, resolveMember);
}

export const ANNOUNCEMENT_SLUG = /^[a-z0-9][a-z0-9-]{2,80}$/;

/** The deterministic private-message id a Founder announcement takes in one
 * member's inbox. Deriving it from the announcement key and the recipient is
 * what makes a repeated deployment, a retried send or two simultaneous logins
 * land exactly one copy. */
export function founderAnnouncementMessageId(slug: string, recipientId: string): string {
  return createHash("sha256").update(`jspace:founder-announcement:v1:${slug}:${recipientId.toLowerCase()}`).digest("hex");
}

/** Server-only Founder announcement delivery into the member's ordinary
 * messages, so they can go back and read it later. The text comes from the
 * Founder dashboard and the sender from the protected owner binding, never
 * from a member's request. */
export async function deliverFounderAnnouncement(
  recipient: Member, sender: Member,
  announcement: { slug: string; subject: string; body: string },
  stores: MemberStores,
): Promise<{ status: "sent" | "already_sent" | "author"; message_id?: string }> {
  const to = asMember(recipient), from = asMember(sender);
  if (!to || !from) throw new Error("Invalid announcement participants");
  if (typeof announcement.slug !== "string" || !ANNOUNCEMENT_SLUG.test(announcement.slug)) throw new Error("Invalid announcement key");
  if (typeof announcement.subject !== "string" || !announcement.subject.trim() || announcement.subject.length > 100 ||
      typeof announcement.body !== "string" || !announcement.body.trim() || announcement.body.length > 3000 ||
      BAD_TEXT.test(announcement.subject) || BAD_TEXT.test(announcement.body)) throw new Error("Invalid announcement text");
  if (to.id === from.id) return { status: "author" };
  const id = founderAnnouncementMessageId(announcement.slug, to.id);
  const key = `messages/${id}`;
  const requestId = `founder-announcement:${announcement.slug}`;
  const candidate: StoredMessage = {
    id, sender_id: from.id, recipient_id: to.id,
    sender_name: from.name, recipient_name: to.name,
    subject: announcement.subject, body: announcement.body,
    created_at: new Date().toISOString(), request_id: requestId,
  };
  const existing = await stores.messages.get(key, { type: "json" }) as StoredMessage | null;
  let message: MemberMessage | null = asMessage(existing);
  if (existing && (!message || existing.request_id !== requestId ||
      message.sender_id !== from.id || message.recipient_id !== to.id || message.id !== id)) {
    throw new Error("Invalid saved announcement");
  }
  // Register both sides so a member can reply to the Founder normally.
  await Promise.all([syncMember(from, stores.directory), syncMember(to, stores.directory)]);
  let created = false;
  if (!message) {
    created = (await stores.messages.setJSON(key, candidate, { onlyIfNew: true })).modified;
    const saved = await stores.messages.get(key, { type: "json" }) as StoredMessage | null;
    message = asMessage(saved);
    if (!message || saved?.request_id !== requestId || message.id !== id ||
        message.sender_id !== from.id || message.recipient_id !== to.id) throw new Error("Announcement could not be verified");
  }
  await ensureIndexes(stores.messages, message);
  return { status: created ? "sent" : "already_sent", message_id: id };
}
