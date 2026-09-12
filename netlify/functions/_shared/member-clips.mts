import { createHash, randomUUID } from "node:crypto";
import { getStore, getDeployStore } from "@netlify/blobs";
import type { Context } from "@netlify/functions";
import { assertSameOrigin, MEMBER_ID, MemberError, memberJSON } from "./member-auth.mts";
import { type ProfileMember, type ProfileStore } from "./member-profiles.mts";
import { validatePrivateMessageVideo, MAX_PRIVATE_VIDEO_BYTES } from "./private-message-videos.mts";
import { readVideoUpload, smallVideoJSON, VIDEO_UPLOAD_LIMIT, type VideoTransferStore } from "./video-transfers.mts";
import { moderateVideo, VIDEO_MODERATION_POLICY_VERSION } from "./video-moderation.mts";
import { withinUndoWindow } from "./media-undo.mts";
import { resolveCommunityProfileMember } from "./roster-access.mts";

export interface ClipsStore {
  syncFeed?: (id: string) => Promise<boolean>;
  list(options: { prefix: string; paginate: true }): AsyncIterable<{ blobs: { key: string }[] }>;
  get(key: string, options: { type: "json" | "arrayBuffer" }): Promise<any>;
  getWithMetadata(key: string, options: { type: "json" }): Promise<{ data: any; etag: string } | null>;
  setJSON(key: string, data: unknown, options?: { onlyIfNew?: boolean; onlyIfMatch?: string }): Promise<{ modified: boolean }>;
  set(key: string, data: ArrayBuffer, options?: { onlyIfNew?: boolean }): Promise<{ modified: boolean }>;
  delete(key: string): Promise<void>;
}
export type Clip = { id: string; member_id: string; name: string; caption: string; created_at: string; request_id: string; digest: string; mime: string; width: number; height: number; duration: number; size: number };
type VideoDecision = { status: "pending" | "approved" | "rejected"; policy_version: string; reason: string };
type Review = { id: string; status: "pending" | "approved" | "rejected"; checked_at: string; owner_id: string | null; source?: "automatic"; input_digest?: string; policy_version?: string; reason?: string };
type Options = { prepareVideo?: (bytes: ArrayBuffer) => Promise<ReturnType<typeof validatePrivateMessageVideo>>; transfers?: VideoTransferStore; resolveMember?: () => Promise<ProfileMember>; moderateVideo?: (input: { bytes: ArrayBuffer; mime: string; name: string; caption: string; duration: number }) => Promise<unknown> };
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SUFFIX = /^\d{13}-[a-f0-9]{64}$/;
const BAD_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const MAX_BODY = MAX_PRIVATE_VIDEO_BYTES + 65536;
const MAX_KEYS = 10000;
const MAX_PAGES = 100;
const MAX_PENDING = 3;
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const requestId = (member: string, request: string) => hash(`${member}:${request}`);
const suffix = (clip: Clip) => `${String(9999999999999 - Date.parse(clip.created_at)).padStart(13, "0")}-${clip.id}`;
const projection = (clip: Clip) => ({ id: clip.id, member_id: clip.member_id, name: clip.name, caption: clip.caption, created_at: clip.created_at, video_url: `/api/clip-video/${clip.id}`, width: clip.width, height: clip.height, duration: clip.duration });

export function clipsStore(context: Context): ClipsStore {
  const options = { name: "member-short-clips", consistency: "strong" as const };
  const store = context.deploy.context === "production" ? getStore(options) : getDeployStore({ ...options, deployID: context.deploy.id });
  return Object.assign(store, {syncFeed: async (id:string) => {
    const {queueClipFeedSync} = await import('./clip-feed.mts');
    return queueClipFeedSync(store,id);
  }});
}
export function clipsFailure(error?: unknown): Response {
  return error instanceof MemberError ? memberJSON({ error: error.message }, error.status)
    : memberJSON({ error: "Clips could not connect. Please try again in a moment." }, 503);
}
function readClip(value: any): Clip | null {
  if (!value || typeof value !== "object" || !HASH.test(value.id) || !MEMBER_ID.test(value.member_id) ||
      !UUID.test(value.request_id) || value.id !== requestId(value.member_id, value.request_id) ||
      typeof value.name !== "string" || !value.name.trim() || value.name.length > 60 || /[\u0000-\u001f\u007f@]/u.test(value.name) ||
      typeof value.caption !== "string" || value.caption.length > 300 || BAD_TEXT.test(value.caption) ||
      typeof value.created_at !== "string" || !Number.isFinite(Date.parse(value.created_at)) ||
      !HASH.test(value.digest) || !["video/mp4", "video/webm"].includes(value.mime) ||
      !Number.isInteger(value.width) || value.width < 1 || value.width > 1920 ||
      !Number.isInteger(value.height) || value.height < 1 || value.height > 1920 || value.width * value.height > 4000000 ||
      !Number.isFinite(value.duration) || value.duration <= 0 || value.duration > 30 ||
      !Number.isInteger(value.size) || value.size < 1 || value.size > VIDEO_UPLOAD_LIMIT) return null;
  return { id: value.id, member_id: value.member_id, request_id: value.request_id, name: value.name, caption: value.caption,
    created_at: value.created_at, digest: value.digest, mime: value.mime, width: value.width, height: value.height, duration: value.duration, size: value.size };
}
function readReview(value: any, id: string): Review | null {
  if (!value || value.id !== id || !["pending", "approved", "rejected"].includes(value.status) ||
      typeof value.checked_at !== "string" || !Number.isFinite(Date.parse(value.checked_at))) return null;
  if (value.source === "automatic") {
    if (value.owner_id !== null || !HASH.test(value.input_digest) || !validDecision(value)) return null;
    return { id, status: value.status, checked_at: value.checked_at, owner_id: null, source: "automatic", input_digest: value.input_digest, policy_version: value.policy_version, reason: value.reason };
  }
  if (value.source !== undefined || (value.status === "pending" ? value.owner_id !== null : !MEMBER_ID.test(value.owner_id))) return null;
  return { id, status: value.status, checked_at: value.checked_at, owner_id: value.owner_id };
}
function validDecision(value: any): value is VideoDecision {
  return !!value && ["pending", "approved", "rejected"].includes(value.status) &&
    value.policy_version === VIDEO_MODERATION_POLICY_VERSION && typeof value.reason === "string" &&
    value.reason.trim().length > 0 && value.reason.length <= 160 && !BAD_TEXT.test(value.reason);
}
function commitMatches(value: any, clip: Clip): boolean {
  return !!value && value.id === clip.id && value.digest === clip.digest;
}
async function committed(store: ClipsStore, clip: Clip): Promise<boolean> {
  return commitMatches(await store.get(`submitted/${suffix(clip)}`, { type: "json" }), clip);
}
async function isPublished(store: ClipsStore, clip: Clip): Promise<boolean> {
  const review = readReview(await store.get(`moderation/${clip.id}`, { type: "json" }), clip.id);
  return review?.status === "approved" && (review.source !== "automatic" || review.input_digest === clip.digest) && await committed(store, clip) &&
    commitMatches(await store.get(`published/${suffix(clip)}`, { type: "json" }), clip);
}
export async function isClipPublished(store: ClipsStore, id: string): Promise<boolean> {
  if (!HASH.test(id)) return false;
  const clip = readClip(await store.get(`clips/${id}`, { type: "json" }));
  return !!clip && clip.id === id && await isPublished(store, clip);
}
async function isOwner(member: ProfileMember, profiles: ProfileStore): Promise<boolean> {
  if (member.isOwner !== true) return false;
  const bound = await profiles.get("owner-binding", { type: "json" });
  // Review never creates or reassigns the owner. The profile editor establishes
  // this immutable binding using the server-verified owner email.
  return !!bound && typeof bound.id === "string" && MEMBER_ID.test(bound.id) && bound.id === member.id;
}
/** True only for the signed-in site owner bound to this site. */
export async function isSiteOwner(member: ProfileMember, profiles: ProfileStore): Promise<boolean> {
  return isOwner(member, profiles);
}
async function requireOwner(profiles: ProfileStore, options: Options): Promise<ProfileMember> {
  const member = await (options.resolveMember ?? resolveCommunityProfileMember)();
  if (!await isOwner(member, profiles)) throw new MemberError(403, "Only J.White Did It can review clips.");
  return member;
}
async function keys(store: ClipsStore, prefix: string): Promise<string[]> {
  const found = new Set<string>(); let pages = 0;
  for await (const page of store.list({ prefix, paginate: true })) {
    if (++pages > MAX_PAGES) throw new MemberError(503, "There are too many clips to load right now. Please try again shortly.");
    for (const blob of page.blobs) {
      if (typeof blob.key === "string" && blob.key.startsWith(prefix) && SUFFIX.test(blob.key.slice(prefix.length))) found.add(blob.key);
      if (found.size > MAX_KEYS) throw new MemberError(503, "There are too many clips to load right now. Please try again shortly.");
    }
  }
  return [...found].sort();
}
async function bodyBytes(req: Request, limit: number): Promise<Uint8Array> {
  if (Number(req.headers.get("content-length") || "0") > limit) throw new MemberError(413, "Choose a video up to 4 MB and 30 seconds.");
  if (!req.body) throw new MemberError(400, "Choose a video to share.");
  const reader = req.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.byteLength;
      if (length > limit) { await reader.cancel(); throw new MemberError(413, "Choose a video up to 4 MB and 30 seconds."); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
async function readSubmission(req: Request, memberId: string, transfers?: VideoTransferStore, prepareVideo?: Options["prepareVideo"]): Promise<{ request: string; caption: string; video: ReturnType<typeof validatePrivateMessageVideo> }> {
  let request: unknown, text: unknown, file: unknown;
  let uploadLimit = MAX_PRIVATE_VIDEO_BYTES;
  if ((req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() === 'application/json') {
    uploadLimit = VIDEO_UPLOAD_LIMIT;
    const input = await smallVideoJSON(req);
    request = input.request_id;
    text = input.caption ?? '';
    if (typeof request !== 'string' || !UUID.test(request) || typeof input.upload_id !== 'string' || !UUID.test(input.upload_id)) throw new MemberError(400, 'Refresh the video uploader and try again.');
    file = await readVideoUpload(transfers, memberId, input.upload_id, 'clip');
  } else {
    if (!(req.headers.get("content-type") || "").toLowerCase().startsWith("multipart/form-data;")) throw new MemberError(415, "Choose a video using the clip uploader.");
    const bytes = await bodyBytes(req, MAX_BODY);
    let form: FormData;
    try { form = await new Request(req.url, { method: "POST", headers: { "Content-Type": req.headers.get("content-type")! }, body: bytes }).formData(); }
    catch { throw new MemberError(400, "Your video upload could not be read. Please try again."); }
    if (form.getAll("video").length !== 1 || form.getAll("request_id").length !== 1 || form.getAll("caption").length > 1) throw new MemberError(400, "Please submit one clip at a time.");
    request = form.get("request_id"); text = form.get("caption") ?? ""; file = form.get("video");
  }
  if (typeof request !== "string" || !UUID.test(request)) throw new MemberError(400, "Please refresh the page before sharing your clip.");
  if (typeof text !== "string" || text.trim().length > 300 || BAD_TEXT.test(text)) throw new MemberError(400, "Your caption can have up to 300 characters.");
  if (!(file instanceof File) || file.size < 1) throw new MemberError(400, "Choose a video to share.");
  if (file.size > uploadLimit) throw new MemberError(413, uploadLimit === MAX_PRIVATE_VIDEO_BYTES ? "Refresh your video uploader to send source videos up to 100 MB. This older upload form only accepts 4 MB." : "Choose a video up to 100 MB and 30 seconds.");
  let video: ReturnType<typeof validatePrivateMessageVideo>;
  try { const bytes = await file.arrayBuffer(); video = prepareVideo ? await prepareVideo(bytes) : validatePrivateMessageVideo(bytes, file.type, { maxBytes: VIDEO_UPLOAD_LIMIT }); }
  catch (error) { throw new MemberError(415, error instanceof Error ? error.message : "Choose a valid MP4 or WebM video up to 30 seconds."); }
  return { request: request.toLowerCase(), caption: text.trim().replace(/\r\n?/g, "\n"), video };
}
async function validBytes(store: ClipsStore, clip: Clip): Promise<ArrayBuffer> {
  const bytes = await store.get(`videos/${clip.id}/${clip.digest}`, { type: "arrayBuffer" });
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== clip.size || hash(new Uint8Array(bytes)) !== clip.digest) throw new MemberError(404, "This clip is not available.");
  try {
    const video = validatePrivateMessageVideo(bytes, clip.mime, { maxBytes: VIDEO_UPLOAD_LIMIT });
    if (video.width !== clip.width || video.height !== clip.height || Math.abs(video.duration - clip.duration) > 0.001) throw new Error();
  } catch { throw new MemberError(404, "This clip is not available."); }
  return bytes;
}
async function reservePending(store: ClipsStore, clip: Clip): Promise<void> {
  const key = `pending-members/${clip.member_id}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const previous = await store.getWithMetadata(key, { type: "json" });
    const prior = previous?.data?.ids ?? [];
    if (!Array.isArray(prior) || prior.length > MAX_PENDING || !prior.every(id => typeof id === "string" && HASH.test(id))) throw new Error("Invalid pending quota");
    const active: string[] = [];
    for (const id of prior) {
      const review = readReview(await store.get(`moderation/${id}`, { type: "json" }), id);
      if (!review || review.status === "pending") active.push(id);
    }
    if (active.includes(clip.id)) return;
    if (active.length >= MAX_PENDING) throw new MemberError(429, "You have 3 clips waiting for review. Please wait before adding another.");
    const saved = await store.setJSON(key, { ids: [...active, clip.id] }, previous ? { onlyIfMatch: previous.etag } : { onlyIfNew: true });
    if (saved.modified) return;
  }
  throw new MemberError(409, "Another clip is uploading. Please try this upload again.");
}

/** One stored video, or null when it is not this site's own valid record. */
export async function findClipRecord(store: ClipsStore, id: string): Promise<Clip | null> {
  if (!HASH.test(id)) return null;
  const clip = readClip(await store.get(`clips/${id}`, { type: "json" }));
  return clip && clip.id === id ? clip : null;
}
type ClipTrash = { clip_id: string; member_id: string; digest: string; suffix: string; was_published: boolean; removed_at: string; removed_by: string };
function readClipTrash(value: any, id: string): ClipTrash | null {
  if (!value || value.kind !== "video" || value.clip_id !== id || !MEMBER_ID.test(value.member_id) || !HASH.test(value.digest) ||
      typeof value.suffix !== "string" || !SUFFIX.test(value.suffix) ||
      typeof value.removed_at !== "string" || !Number.isFinite(Date.parse(value.removed_at))) return null;
  return { clip_id: id, member_id: value.member_id, digest: value.digest, suffix: value.suffix,
    was_published: value.was_published === true, removed_at: value.removed_at, removed_by: typeof value.removed_by === "string" ? value.removed_by : "" };
}
/** A purged video must not keep holding one of the member's review places. */
async function dropPendingClip(store: ClipsStore, memberId: string, clipId: string): Promise<void> {
  const key = `pending-members/${memberId}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const previous = await store.getWithMetadata(key, { type: "json" });
    const prior = previous?.data?.ids;
    if (!previous || !Array.isArray(prior) || !prior.includes(clipId)) return;
    if ((await store.setJSON(key, { ids: prior.filter((value: unknown) => value !== clipId) }, { onlyIfMatch: previous.etag })).modified) return;
  }
}
/** Takes the video off every page at once and keeps the file for Undo.
 * Deleting the submission commit is what makes the video URL, the profile
 * video section and the review queue stop returning it, for everybody. */
export async function removeClip(store: ClipsStore, clip: Clip, removedBy: string) {
  const key = suffix(clip);
  const wasPublished = commitMatches(await store.get(`published/${key}`, { type: "json" }), clip);
  await store.setJSON(`trash/${clip.id}`, { kind: "video", clip_id: clip.id, member_id: clip.member_id, digest: clip.digest,
    suffix: key, was_published: wasPublished, removed_at: new Date().toISOString(), removed_by: removedBy });
  await store.delete(`published/${key}`);
  await store.delete(`submitted/${key}`);
  await store.syncFeed?.(clip.id);
  return { kind: "video" as const, id: clip.id, member_id: clip.member_id, label: clip.caption || clip.name };
}
/** Puts a removed video back exactly as it was, inside the undo window. */
export async function restoreClip(store: ClipsStore, id: string) {
  const record = readClipTrash(await store.get(`trash/${id}`, { type: "json" }), id);
  if (!record) throw new MemberError(404, "This video can no longer be brought back.");
  if (!withinUndoWindow(record.removed_at)) { await purgeClip(store, id, { force: true }); throw new MemberError(410, "The undo time has passed, so this video was removed for good."); }
  const clip = await findClipRecord(store, id);
  if (!clip || clip.digest !== record.digest) throw new MemberError(404, "This video can no longer be brought back.");
  if (!(await store.get(`videos/${id}/${clip.digest}`, { type: "arrayBuffer" }) instanceof ArrayBuffer)) throw new MemberError(404, "This video can no longer be brought back.");
  await store.setJSON(`submitted/${record.suffix}`, { id, digest: clip.digest });
  // Only a video that was already public becomes public again. A video that
  // was still waiting for review goes back to waiting.
  if (record.was_published) await store.setJSON(`published/${record.suffix}`, { id, digest: clip.digest });
  await store.delete(`trash/${id}`);
  await store.syncFeed?.(id);
  return { ...projection(clip), published: await isPublished(store, clip) };
}
/** Deletes the video file and its records once Undo is no longer offered. */
export async function purgeClip(store: ClipsStore, id: string, { force = false } = {}): Promise<boolean> {
  const record = readClipTrash(await store.get(`trash/${id}`, { type: "json" }), id);
  if (!record) return false;
  if (!force && withinUndoWindow(record.removed_at)) return false;
  const clip = await findClipRecord(store, id);
  // A video that was brought back keeps its file. Only the record goes.
  if (clip && await committed(store, clip)) { await store.delete(`trash/${id}`); return false; }
  for (const digest of new Set([record.digest, clip?.digest].filter(Boolean) as string[])) await store.delete(`videos/${id}/${digest}`);
  await store.delete(`published/${record.suffix}`);
  await store.delete(`submitted/${record.suffix}`);
  await store.delete(`moderation/${id}`);
  await store.delete(`automatic-checks/${id}`);
  await store.delete(`clips/${id}`);
  await dropPendingClip(store, record.member_id, id);
  await store.delete(`trash/${id}`);
  return true;
}
/** Every video removal record still waiting, for the scheduled cleanup. */
export async function listClipTrash(store: ClipsStore): Promise<{ clip_id: string }[]> {
  const found: { clip_id: string }[] = [];
  for await (const page of store.list({ prefix: "trash/", paginate: true })) {
    for (const blob of page.blobs) {
      const id = String(blob.key || "").slice(6);
      if (HASH.test(id)) found.push({ clip_id: id });
      if (found.length >= 1000) return found;
    }
  }
  return found;
}
/** The member's own videos, public ones and ones still waiting for review,
 * so Manage Media can remove either. */
export async function listMemberClips(store: ClipsStore, memberId: string, limit = 30) {
  const owned = memberId.toLowerCase(); const videos = [];
  for (const key of await keys(store, "submitted/")) {
    const id = key.slice(-64); const clip = await findClipRecord(store, id);
    if (!clip || clip.member_id.toLowerCase() !== owned || suffix(clip) !== key.slice(10)) continue;
    const review = readReview(await store.get(`moderation/${id}`, { type: "json" }), id);
    const published = await isPublished(store, clip);
    videos.push({ ...projection(clip), kind: "video" as const, published,
      status: published ? "approved" : review?.status === "rejected" ? "rejected" : "pending" });
    if (videos.length >= limit) break;
  }
  return videos;
}

export async function submitClip(req: Request, store: ClipsStore, options: Options = {}): Promise<Response> {
  if (req.method !== "POST") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req);
    const member = await (options.resolveMember ?? resolveCommunityProfileMember)();
    const input = await readSubmission(req, member.id, options.transfers, options.prepareVideo);
    const id = requestId(member.id, input.request);
    const candidate: Clip = { id, member_id: member.id, name: member.name, caption: input.caption, created_at: new Date().toISOString(), request_id: input.request,
      digest: hash(new Uint8Array(input.video.bytes)), mime: input.video.mime, width: input.video.width, height: input.video.height, duration: input.video.duration, size: input.video.bytes.byteLength };
    const write = await store.setJSON(`clips/${id}`, candidate, { onlyIfNew: true });
    const clip = write.modified ? candidate : readClip(await store.get(`clips/${id}`, { type: "json" }));
    if (!clip || clip.id !== id || clip.member_id !== member.id || clip.request_id !== input.request) throw new Error("Invalid saved clip");
    if (clip.digest !== candidate.digest || clip.caption !== candidate.caption || clip.mime !== candidate.mime) throw new MemberError(409, "This upload was already used. Please start a new clip.");
    const existingReview = readReview(await store.get(`moderation/${id}`, { type: "json" }), id);
    if (!existingReview || existingReview.status === "pending") await reservePending(store, clip);
    await store.set(`videos/${id}/${clip.digest}`, input.video.bytes, { onlyIfNew: true });
    await validBytes(store, clip);
    await store.setJSON(`moderation/${id}`, { id, status: "pending", checked_at: clip.created_at, owner_id: null }, { onlyIfNew: true });
    // Only a fully stored video gains a submission commit. Its caption and
    // identity are immutable; videos stay private until a trusted review.
    await store.setJSON(`submitted/${suffix(clip)}`, { id, digest: clip.digest }, { onlyIfNew: true });
    const review = readReview(await store.get(`moderation/${id}`, { type: "json" }), id);
    if (!review || !await committed(store, clip)) throw new Error("Invalid clip commit");
    const published = await isPublished(store, clip);
    if (published) await store.syncFeed?.(id);
    return memberJSON({ id, status: review.status, published }, review.status === "pending" ? 202 : 200);
  } catch (error) { return clipsFailure(error); }
}

/** Profile-scoped reads. Older unscoped clients default to the site owner,
 * never the community feed. Only public, approved clips are returned. */
export async function getClips(req: Request, store: ClipsStore, profiles?: Pick<ProfileStore, "get">): Promise<Response> {
  if (req.method !== "GET") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    const values = new URL(req.url).searchParams.getAll("member");
    if (values.length > 1) throw new MemberError(400, "Choose one video profile.");
    const requested = values.length ? values[0].toLowerCase() : "owner";
    if (requested !== "owner" && !MEMBER_ID.test(requested)) throw new MemberError(400, "Choose a valid video profile.");
    let memberId: string | null = requested;
    if (requested === "owner") {
      if (!profiles) throw new MemberError(503, "The owner video profile could not be loaded.");
      const binding = await profiles.get("owner-binding", { type: "json" });
      if (binding === null) memberId = null;
      else if (!binding || typeof binding.id !== "string" || !MEMBER_ID.test(binding.id)) {
        throw new MemberError(503, "The owner video profile could not be loaded.");
      } else memberId = binding.id.toLowerCase();
    }
    // An unconfigured owner must not fall back to another member's uploads.
    if (!memberId) return memberJSON({ clips: [], member_id: null, requires_review: true });
    const clips = [];
    for (const key of await keys(store, "published/")) {
      const id = key.slice(-64); const clip = readClip(await store.get(`clips/${id}`, { type: "json" }));
      // Filter before applying the page limit. Other members cannot crowd this
      // person's videos out of their own profile.
      if (!clip || clip.id !== id || clip.member_id.toLowerCase() !== memberId ||
          suffix(clip) !== key.slice(10) || !await isPublished(store, clip)) continue;
      clips.push(projection(clip)); if (clips.length === 20) break;
    }
    return memberJSON({ clips, member_id: memberId, requires_review: true });
  } catch (error) { return clipsFailure(error); }
}

export async function getClipReview(req: Request, store: ClipsStore, profiles: ProfileStore, options: Options = {}): Promise<Response> {
  if (req.method !== "GET") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req); await requireOwner(profiles, options);
    const before = new URL(req.url).searchParams.get("before");
    if (before && !SUFFIX.test(before)) throw new MemberError(400, "This review page could not be opened.");
    const all = (await keys(store, "submitted/")).filter(key => !before || key.slice(10) > before);
    const clips = []; let last = ""; let scanned = 0;
    for (const key of all) {
      last = key.slice(10); scanned++;
      const id = key.slice(-64); const clip = readClip(await store.get(`clips/${id}`, { type: "json" }));
      const review = readReview(await store.get(`moderation/${id}`, { type: "json" }), id);
      if (!clip || clip.id !== id || suffix(clip) !== last || review?.status !== "pending" || !await committed(store, clip)) continue;
      clips.push({ ...projection(clip), status: "pending" }); if (clips.length === 20) break;
    }
    return memberJSON({ clips, next: scanned < all.length ? last : null });
  } catch (error) { return clipsFailure(error); }
}

export async function reviewClip(req: Request, store: ClipsStore, profiles: ProfileStore, options: Options = {}): Promise<Response> {
  if (req.method !== "POST") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req); const owner = await requireOwner(profiles, options);
    if ((req.headers.get("content-type") || "").split(";", 1)[0].toLowerCase() !== "application/json") throw new MemberError(415, "This review format is not supported.");
    let input: any;
    try { input = JSON.parse(new TextDecoder().decode(await bodyBytes(req, 2048))); }
    catch (error) { if (error instanceof MemberError) throw error; throw new MemberError(400, "This review could not be read."); }
    if (!input || typeof input.id !== "string" || !HASH.test(input.id) || !["approve", "reject"].includes(input.action)) throw new MemberError(400, "Choose a clip and review action.");
    const clip = readClip(await store.get(`clips/${input.id}`, { type: "json" }));
    if (!clip || clip.id !== input.id || !await committed(store, clip)) throw new MemberError(404, "This clip is not available.");
    const previous = await store.getWithMetadata(`moderation/${clip.id}`, { type: "json" });
    const review = readReview(previous?.data, clip.id);
    if (!previous || !review) throw new MemberError(404, "This clip is not ready for review.");
    const status = input.action === "approve" ? "approved" : "rejected";
    if (status === "approved" && review.status === "rejected") throw new MemberError(409, "This clip was declined. Ask the member to share a new clip.");
    if (status === "approved") {
      await validBytes(store, clip);
      // Prepare the public index before the atomic review commit. A failed
      // index write leaves the pending clip in the owner's review queue, while
      // an index alone can never make an unapproved clip public.
      await store.setJSON(`published/${suffix(clip)}`, { id: clip.id, digest: clip.digest }, { onlyIfNew: true });
    }
    if (review.status !== status) {
      const saved = await store.setJSON(`moderation/${clip.id}`, { id: clip.id, status, checked_at: new Date().toISOString(), owner_id: owner.id }, { onlyIfMatch: previous.etag });
      if (!saved.modified) throw new MemberError(409, "This clip was reviewed in another window. Refresh the review list.");
    }
    if (status === "approved") {
      if (!await isPublished(store, clip)) throw new MemberError(409, "This clip's review changed. Refresh the review list.");
    }
    await store.syncFeed?.(clip.id);
    return memberJSON({ id: clip.id, status, published: status === "approved" });
  } catch (error) { return clipsFailure(error); }
}

function videoResponseBody(bytes: ArrayBuffer): BodyInit {
  if (bytes.byteLength <= MAX_PRIVATE_VIDEO_BYTES) return bytes;
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) { controller.close(); return; }
      const end = Math.min(offset + 65536, bytes.byteLength);
      controller.enqueue(new Uint8Array(bytes.slice(offset, end)));
      offset = end;
    }
  });
}

export async function getClipVideo(req: Request, store: ClipsStore, profiles: ProfileStore, options: Options = {}): Promise<Response> {
  if (req.method !== "GET") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req);
    const id = new URL(req.url).pathname.split("/").at(-1)!;
    if (!HASH.test(id)) throw new MemberError(404, "This clip is not available.");
    const clip = readClip(await store.get(`clips/${id}`, { type: "json" }));
    if (!clip || clip.id !== id || !await committed(store, clip)) throw new MemberError(404, "This clip is not available.");
    let privateAccess = false;
    if (!await isPublished(store, clip)) {
      try {
        const member = await (options.resolveMember ?? resolveCommunityProfileMember)();
        privateAccess = member.id === clip.member_id || await isOwner(member, profiles);
      } catch { /* Private clips have the same not-found response for visitors. */ }
      if (!privateAccess) throw new MemberError(404, "This clip is not available.");
    }
    const bytes = await validBytes(store, clip);
    // Recheck moderation immediately before returning bytes so a prior public
    // URL is no longer usable after the owner revokes publication.
    if (!privateAccess && !await isPublished(store, clip)) throw new MemberError(404, "This clip is not available.");
    const headers = {
      "Content-Type": clip.mime, "Cache-Control": "private, no-store", "Netlify-CDN-Cache-Control": "no-store",
      "Vary": "Cookie, Authorization", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Security-Policy": "default-src 'none'; sandbox", "Content-Disposition": `inline; filename="clip.${clip.mime === "video/mp4" ? "mp4" : "webm"}"`, "Accept-Ranges": "bytes",
    };
    const range = req.headers.get("range");
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${bytes.byteLength}` } });
      const start = match[1] ? Number(match[1]) : Math.max(0, bytes.byteLength - Number(match[2]));
      const end = match[1] && match[2] ? Math.min(Number(match[2]), bytes.byteLength - 1) : bytes.byteLength - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= bytes.byteLength) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${bytes.byteLength}` } });
      return new Response(videoResponseBody(bytes.slice(start, end + 1)), { status: 206, headers: { ...headers, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${bytes.byteLength}` } });
    }
    return new Response(videoResponseBody(bytes), { headers: { ...headers, "Content-Length": String(bytes.byteLength) } });
  } catch (error) { return clipsFailure(error); }
}

async function clipOutcome(store: ClipsStore, clip: Clip, checking = false): Promise<Response> {
  const review = readReview(await store.get(`moderation/${clip.id}`, { type: "json" }), clip.id);
  if (!review || (review.source === "automatic" && review.input_digest !== clip.digest)) throw new Error("Invalid clip decision");
  const published = await isPublished(store, clip);
  if (published || review.status === 'rejected') await store.syncFeed?.(clip.id);
  // An approval whose index did not commit must still be described as private.
  const status = review.status === "approved" && !published ? "pending" : review.status;
  const reviewUnavailable = status === 'pending' && ['moderation_unavailable', 'automatic_review_unavailable', 'moderation_timeout'].includes(review.reason || '');
  return memberJSON({ id: clip.id, status, published, ...(reviewUnavailable ? { review_unavailable: true } : {}), ...(checking && status === "pending" ? { checking: true } : {}) }, status === "pending" ? 202 : 200);
}
async function memberClip(id: string, store: ClipsStore, member: ProfileMember): Promise<Clip> {
  if (!HASH.test(id)) throw new MemberError(404, "This clip is not available.");
  const clip = readClip(await store.get(`clips/${id}`, { type: "json" }));
  if (!clip || clip.member_id !== member.id || !await committed(store, clip)) throw new MemberError(404, "This clip is not available.");
  return clip;
}

export async function getClipStatus(req: Request, store: ClipsStore, profiles: ProfileStore, options: Options = {}): Promise<Response> {
  if (req.method !== "GET") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req); const member = await (options.resolveMember ?? resolveCommunityProfileMember)();
    const id = new URL(req.url).pathname.split("/").at(-1)!;
    if (!HASH.test(id)) throw new MemberError(404, "This clip is not available.");
    const clip = readClip(await store.get(`clips/${id}`, { type: "json" }));
    if (!clip || !await committed(store, clip) || (clip.member_id !== member.id && !await isOwner(member, profiles))) throw new MemberError(404, "This clip is not available.");
    const lease = await store.get(`automatic-checks/${id}`, { type: "json" });
    const checking = lease?.id === id && lease?.digest === clip.digest && lease?.state === "running" &&
      lease?.policy_version === VIDEO_MODERATION_POLICY_VERSION && Date.parse(lease?.expires_at) > Date.now();
    return await clipOutcome(store, clip, checking);
  } catch (error) { return clipsFailure(error); }
}

export async function checkClip(req: Request, store: ClipsStore, options: Options = {}): Promise<Response> {
  if (req.method !== "POST") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req); const member = await (options.resolveMember ?? resolveCommunityProfileMember)();
    if ((req.headers.get("content-type") || "").split(";", 1)[0].toLowerCase() !== "application/json") throw new MemberError(415, "This clip check format is not supported.");
    let input: any;
    try { input = JSON.parse(new TextDecoder().decode(await bodyBytes(req, 2048))); }
    catch (error) { if (error instanceof MemberError) throw error; throw new MemberError(400, "This clip check could not be read."); }
    if (!input || typeof input.id !== "string" || !HASH.test(input.id)) throw new MemberError(400, "Choose a clip to check.");
    const clip = await memberClip(input.id, store, member);
    const reviewKey = `moderation/${clip.id}`;
    const previous = await store.getWithMetadata(reviewKey, { type: "json" });
    const review = readReview(previous?.data, clip.id);
    if (!previous || !review) throw new MemberError(404, "This clip is not ready to check.");
    if (review.status !== "pending" || review.source === "automatic") return await clipOutcome(store, clip);
    const key = `automatic-checks/${clip.id}`;
    const prior = await store.getWithMetadata(key, { type: "json" });
    const old = prior?.data;
    if (old && (old.id !== clip.id || old.digest !== clip.digest || old.policy_version !== VIDEO_MODERATION_POLICY_VERSION ||
        !["running", "complete"].includes(old.state) || !Number.isInteger(old.attempts) || old.attempts < 1 || old.attempts > 3)) throw new Error("Invalid automatic clip check");
    let decision: VideoDecision;
    if (old?.state === "complete") {
      if (!validDecision(old.decision)) throw new Error("Invalid saved automatic decision");
      decision = old.decision;
    } else {
      if (old?.state === "running" && Date.parse(old.expires_at) > Date.now()) return await clipOutcome(store, clip, true);
      if (old && !Number.isFinite(Date.parse(old.expires_at))) throw new Error("Invalid clip check lease");
      // A crashed request can retry an expired lease, but one clip can never
      // trigger unlimited paid checks. Remaining cases stay in owner review.
      if (old?.attempts >= 3) return await clipOutcome(store, clip);
      const candidate = { id: clip.id, digest: clip.digest, policy_version: VIDEO_MODERATION_POLICY_VERSION, state: "running", attempt_id: randomUUID(), attempts: (old?.attempts ?? 0) + 1, expires_at: new Date(Date.now() + 60000).toISOString() };
      const reserved = await store.setJSON(key, candidate, prior ? { onlyIfMatch: prior.etag } : { onlyIfNew: true });
      if (!reserved.modified) return await clipOutcome(store, clip, true);
      const lease = await store.getWithMetadata(key, { type: "json" });
      if (!lease || lease.data?.attempt_id !== candidate.attempt_id) return await clipOutcome(store, clip, true);
      const bytes = await validBytes(store, clip);
      const unavailable: VideoDecision = { status: "pending", policy_version: VIDEO_MODERATION_POLICY_VERSION, reason: "automatic_review_unavailable" };
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          (options.moderateVideo ?? moderateVideo)({ bytes, mime: clip.mime, name: clip.name, caption: clip.caption, duration: clip.duration }),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Clip check timeout")), 45000); }),
        ]);
        decision = validDecision(result) ? result : unavailable;
      } catch { decision = unavailable; }
      finally { clearTimeout(timer); }
      const saved = await store.setJSON(key, { ...candidate, state: "complete", decision, completed_at: new Date().toISOString() }, { onlyIfMatch: lease.etag });
      if (!saved.modified) return await clipOutcome(store, clip);
    }
    if (decision.status === "approved") {
      await validBytes(store, clip);
      // The candidate index is harmless until this request wins the moderation
      // CAS. In particular, a simultaneous owner rejection always stays final.
      await store.setJSON(`published/${suffix(clip)}`, { id: clip.id, digest: clip.digest }, { onlyIfNew: true });
    }
    await store.setJSON(reviewKey, {
      id: clip.id, status: decision.status, checked_at: new Date().toISOString(), owner_id: null,
      source: "automatic", input_digest: clip.digest, policy_version: decision.policy_version, reason: decision.reason,
    }, { onlyIfMatch: previous.etag });
    // Read the actual winning review, never the provider's proposed result.
    return await clipOutcome(store, clip);
  } catch (error) { return clipsFailure(error); }
}
