import { createHash, randomUUID } from "node:crypto";
import { getUser, type User } from "@netlify/identity";
import { getStore, getDeployStore } from "@netlify/blobs";
import type { Context } from "@netlify/functions";
import { requireMember, assertSameOrigin, MEMBER_ID, MemberError, memberJSON } from "./member-auth.mts";
import { moderateComment, POLICY_VERSION, type ModerationDecision } from "./comment-moderation.mts";
import { verificationStatus } from "./verification-badges.mts";
import { membershipBadgesOrNone } from "./roster-membership.mts";
import { DEFAULT_TOP_EIGHT, readTopEightOrder } from "./top-eight-order.mts";
import { findRegisteredMember, registerPublicMember, type CommunityReader, type CommunityWriter } from "./community-members.mts";
import { resolveCommunityProfileMember } from "./roster-access.mts";

export type ProfileMember = { id: string; name: string; isOwner: boolean };
export interface ProfileStore {
  get(key: string, options: { type: "json" | "arrayBuffer" }): Promise<any>;
  list?(options: { prefix: string; paginate: true }): AsyncIterable<{ blobs: { key: string }[] }>;
  getWithMetadata(key: string, options: { type: "json" }): Promise<{ data: any; etag: string; metadata?: unknown } | null>;
  setJSON(key: string, data: unknown, options?: { onlyIfNew?: boolean; onlyIfMatch?: string }): Promise<{ modified: boolean }>;
  set(key: string, data: ArrayBuffer, options?: { onlyIfNew?: boolean; metadata?: Record<string, string> }): Promise<{ modified: boolean }>;
}
type Options = {
  resolveMember?: () => Promise<ProfileMember>;
  directory?: CommunityWriter;
  moderate?: (input: { name: string; message: string }) => Promise<ModerationDecision>;
};
const HASH = /^[a-f0-9]{64}$/;
const LIMIT = 3 * 1024 * 1024;
const BODY_LIMIT = 4.5 * 1024 * 1024;
export const PROFILE_PROFESSIONS = ["musician", "producer", "songwriter", "engineer", "a_and_r", "dj", "barber", "hairstylist", "beauty_products", "journalist", "podcaster", "photographer", "designer", "model", "creator", "business", "speaker", "ministry", "logistics", "other"] as const;
type ProfileProfession = typeof PROFILE_PROFESSIONS[number];
function profession(value: unknown): ProfileProfession | "" {
  return typeof value === "string" && (PROFILE_PROFESSIONS as readonly string[]).includes(value) ? value as ProfileProfession : "";
}
function profileLink(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 500) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}
function env(key: string): string | undefined {
  return (globalThis as any).Netlify?.env?.get?.(key) ?? process.env[key];
}
export async function resolveProfileMember(load: () => Promise<User | null> = getUser, ownerEmail = env("SITE_OWNER_EMAIL")): Promise<ProfileMember> {
  const user = await load();
  const member = await requireMember(async () => user);
  const isOwner = !!ownerEmail && typeof user?.email === "string" && user.email.trim().toLowerCase() === ownerEmail.trim().toLowerCase();
  return { ...member, name: isOwner ? "J.White Did It" : member.name, isOwner };
}
export function profileStore(context: Context): ProfileStore {
  const options = { name: "member-profiles", consistency: "strong" as const };
  return context.deploy.context === "production" ? getStore(options) : getDeployStore({ ...options, deployID: context.deploy.id });
}
export function profileFailure(error: unknown): Response {
  if (!(error instanceof MemberError)) {
    console.error("member_profile_unavailable", { error_type: error instanceof Error ? error.name : "Unknown" });
  }
  return error instanceof MemberError ? memberJSON({ error: error.message }, error.status)
    : memberJSON({ error: "Your profile could not be saved or loaded. Please try again." }, 503);
}
const OWNER_DEFAULTS = {
  about_me: "I'm J.White Did It. Grammy winner. Two times diamond. The producer behind records you know word for word. From Cardi B and Megan Thee Stallion to Doechii and Ari Lennox, I bring the bounce and build the hits. Welcome to my world. Turn it up. There’s always MORE!",
  profession: "producer", title_lines: "Producer.\nMusic executive.", credentials: "Grammy winner\n2X Diamond\nHitMob founder", location: "Leavenworth, Kansas\nUnited States",
};
function fallback(id: string, name: string, owner = false) {
  return { id, name, status: "MORE!", ...(owner ? { ...OWNER_DEFAULTS, top_eight_order: [...DEFAULT_TOP_EIGHT] } : { about_me: "", profession: "", website_url: "", title_lines: "", credentials: "", location: "" }), photo_url: owner ? "/profile.jpg" : null, updated_at: null, verified: owner, verified_owner: owner };
}
export function readProfile(value: any, id: string): any | null {
  if (!value || value.id !== id || !MEMBER_ID.test(value.id) ||
      typeof value.name !== "string" || !value.name || value.name.length > 60 || /[@\u0000-\u001f\u007f]/.test(value.name) ||
      typeof value.status !== "string" || !value.status || value.status.length > 160 ||
      (typeof value.about_me !== "undefined" && (typeof value.about_me !== "string" || value.about_me.length > 600 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.about_me))) ||
      (typeof value.profession !== "undefined" && profession(value.profession) !== value.profession) ||
      (typeof value.website_url !== "undefined" && value.website_url !== "" && profileLink(value.website_url) !== value.website_url) ||
      (typeof value.title_lines !== "undefined" && (typeof value.title_lines !== "string" || value.title_lines.length > 180 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.title_lines))) ||
      (typeof value.credentials !== "undefined" && (typeof value.credentials !== "string" || value.credentials.length > 240 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.credentials))) ||
      (typeof value.location !== "undefined" && (typeof value.location !== "string" || value.location.length > 140 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.location))) ||
      typeof value.updated_at !== "string" || !Number.isFinite(Date.parse(value.updated_at)) ||
      value.policy_version !== POLICY_VERSION || value.approved !== true ||
      (value.photo_id !== null && !HASH.test(value.photo_id))) return null;
  return { ...value, about_me: typeof value.about_me === "string" ? value.about_me : "", profession: profession(value.profession), website_url: profileLink(value.website_url), title_lines: typeof value.title_lines === "string" ? value.title_lines : "", credentials: typeof value.credentials === "string" ? value.credentials : "", location: typeof value.location === "string" ? value.location : "" };
}
export async function storedProfileDisplayName(store: ProfileStore, id: string, fallbackName: string): Promise<string> {
  if (!MEMBER_ID.test(id)) return fallbackName;
  const record = readProfile(await store.get(`profiles/${id.toLowerCase()}`, { type: "json" }), id.toLowerCase());
  return record?.name || fallbackName;
}
async function publicProfile(store: ProfileStore, record: any, owner = false, verifiedOwner = owner) {
  return { id: record.id, name: record.name, status: record.status,
    about_me: record.about_me || (owner ? OWNER_DEFAULTS.about_me : ""),
    profession: profession(record.profession) || (owner ? OWNER_DEFAULTS.profession : ""),
    website_url: profileLink(record.website_url),
    title_lines: record.title_lines || (owner ? OWNER_DEFAULTS.title_lines : ""),
    credentials: record.credentials || (owner ? OWNER_DEFAULTS.credentials : ""),
    location: record.location || (owner ? OWNER_DEFAULTS.location : ""),
    ...(owner ? { top_eight_order: readTopEightOrder(record.top_eight_order) ?? [...DEFAULT_TOP_EIGHT] } : {}),
    photo_url: record.photo_id ? `/api/profile-photo/${record.photo_id}` : owner ? "/profile.jpg" : null,
    updated_at: record.updated_at, ...await verificationStatus(store, record.id, verifiedOwner),
    // Early Member and the rest are read here so a member who opens the
    // announcement and clicks through really does see the badge.
    membership: await membershipBadgesOrNone(record.id) };
}
async function ownerBinding(store: ProfileStore): Promise<string | null> {
  const binding = await store.get("owner-binding", { type: "json" });
  if (binding === null) return null;
  if (!binding || typeof binding.id !== "string" || !MEMBER_ID.test(binding.id)) throw new Error("Invalid owner binding");
  return binding.id;
}
export async function getPublicProfile(req: Request, store: ProfileStore, options: { directory?: CommunityReader; friends?: CommunityReader } = {}): Promise<Response> {
  if (req.method !== "GET") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    const values = new URL(req.url).searchParams.getAll("id");
    if (values.length !== 1 || (values[0] !== "owner" && !MEMBER_ID.test(values[0]))) throw new MemberError(400, "Choose a valid profile.");
    const isOwner = values[0] === "owner";
    const bound = await ownerBinding(store);
    const id = isOwner ? bound : values[0].toLowerCase();
    const raw = id ? await store.get(`profiles/${id}`, { type: "json" }) : null;
    const record = id ? readProfile(raw, id) : null;
    if (!record && !isOwner && id !== bound) {
      // Do not revive an invalid or withdrawn published record as a new page.
      if (raw !== null) throw new MemberError(404, "This member's profile is unavailable.");
      const member = await findRegisteredMember(id!, store, options.directory, options.friends, bound);
      if (!member) throw new MemberError(404, "This member's profile is unavailable.");
      return memberJSON({ profile: { ...fallback(member.id, member.name), ...await verificationStatus(store, member.id, false), membership: await membershipBadgesOrNone(member.id), profile_pending: true } });
    }
    return memberJSON({ profile: record ? await publicProfile(store, record, isOwner || id === bound) : fallback("owner", "J.White Did It", true) });
  } catch (error) { return profileFailure(error); }
}
export async function getOwnProfile(req: Request, store: ProfileStore, options: Options = {}): Promise<Response> {
  if (req.method !== "GET") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req);
    const member = await (options.resolveMember ?? resolveCommunityProfileMember)();
    const bound = await ownerBinding(store);
    const canEditOwner = member.isOwner && (!bound || bound === member.id);
    await registerPublicMember(member, store, options.directory);
    const record = readProfile(await store.get(`profiles/${member.id}`, { type: "json" }), member.id);
    return memberJSON({ profile: record ? await publicProfile(store, record, bound === member.id || canEditOwner, canEditOwner) : { ...fallback(member.id, member.name, canEditOwner), ...await verificationStatus(store, member.id, canEditOwner), membership: await membershipBadgesOrNone(member.id) }, can_edit_owner: canEditOwner });
  } catch (error) { return profileFailure(error); }
}
async function multipart(req: Request): Promise<FormData> {
  if (!(req.headers.get("content-type") || "").toLowerCase().startsWith("multipart/form-data;")) throw new MemberError(415, "Please use the profile editor to upload your picture.");
  if (Number(req.headers.get("content-length") || 0) > BODY_LIMIT) throw new MemberError(413, "Your photo must be 3 MB or smaller.");
  if (!req.body) throw new MemberError(400, "Please enter your profile update.");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.byteLength;
      if (length > BODY_LIMIT) { await reader.cancel(); throw new MemberError(413, "Your photo must be 3 MB or smaller."); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
  try { return await new Request(req.url, { method: "POST", headers: { "Content-Type": req.headers.get("content-type")! }, body: bytes }).formData(); }
  catch { throw new MemberError(400, "Your profile upload could not be read."); }
}
async function photoFile(value: FormDataEntryValue | null): Promise<{ bytes: ArrayBuffer; mime: string } | null> {
  if (value === null || (value instanceof File && value.size === 0 && !value.name)) return null;
  if (!(value instanceof File) || !value.size || value.size > LIMIT) throw new MemberError(413, "Choose a JPG, PNG or WebP photo up to 3 MB.");
  const bytes = await value.arrayBuffer(); const data = new Uint8Array(bytes);
  const ascii = (start: number, end: number) => String.fromCharCode(...data.slice(start, end));
  let valid = false;
  if (value.type === "image/jpeg") valid = data.length >= 4 && data[0] === 255 && data[1] === 216 && data[2] === 255 && data.at(-2) === 255 && data.at(-1) === 217;
  if (value.type === "image/png") {
    const view = new DataView(bytes);
    valid = data.length >= 24 && [137,80,78,71,13,10,26,10].every((v, n) => data[n] === v) && ascii(12,16) === "IHDR" &&
      view.getUint32(16) > 0 && view.getUint32(16) <= 10000 && view.getUint32(20) > 0 && view.getUint32(20) <= 10000;
  }
  if (value.type === "image/webp") valid = data.length >= 16 && ascii(0,4) === "RIFF" && ascii(8,12) === "WEBP" && ["VP8 ","VP8L","VP8X"].includes(ascii(12,16));
  if (!valid) throw new MemberError(415, "That file is not a valid JPG, PNG or WebP photo.");
  return { bytes, mime: value.type };
}
async function moderateProfileText(name: string, fields: string[], moderate: NonNullable<Options["moderate"]>): Promise<ModerationDecision> {
  // The existing text moderator accepts 1000 characters. New owner fields
  // can exceed that together, so review complete fields in at most two groups.
  const groups: string[] = [];
  for (const field of fields) {
    const previous = groups.at(-1);
    if (previous && previous.length + field.length + 2 <= 1000) groups[groups.length - 1] += `\n\n${field}`;
    else groups.push(field);
  }
  const decisions = await Promise.all(groups.map(message => moderate({ name, message })));
  return decisions.find(value => value.status !== "approved" || value.policy_version !== POLICY_VERSION) ?? decisions[0];
}
export async function updateProfile(req: Request, store: ProfileStore, options: Options = {}): Promise<Response> {
  if (req.method !== "POST") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req);
    const member = await (options.resolveMember ?? resolveCommunityProfileMember)();
    const bound = await ownerBinding(store);
    if ((bound === member.id && !member.isOwner) || (member.isOwner && bound && bound !== member.id)) throw new MemberError(403, "This account cannot edit the site owner's profile.");
    const form = await multipart(req);
    if (form.getAll("display_name").length > 1 || form.getAll("status").length !== 1 || form.getAll("about_me").length > 1 || form.getAll("profession").length > 1 || form.getAll("website_url").length > 1 || form.getAll("title_lines").length > 1 || form.getAll("credentials").length > 1 || form.getAll("location").length > 1 || form.getAll("top_eight_order").length > 1 || form.getAll("photo").length > 1 || form.getAll("request_id").length > 1) throw new MemberError(400, "Please submit one profile update at a time.");
    const displayName = form.get("display_name");
    const status = form.get("status");
    const aboutMe = form.get("about_me");
    const professionValue = form.get("profession");
    const websiteValue = form.get("website_url");
    const titleLines = form.get("title_lines");
    const credentials = form.get("credentials");
    const location = form.get("location");
    const suppliedOrder = form.get("top_eight_order");
    let requestedOrder: string[] | null = null;
    if (suppliedOrder !== null) {
      if (!member.isOwner) throw new MemberError(403, "Only the owner can reorder this Top 8.");
      try { requestedOrder = typeof suppliedOrder === "string" && suppliedOrder.length < 512 ? readTopEightOrder(JSON.parse(suppliedOrder)) : null; } catch { /* Invalid input is rejected below. */ }
      if (!requestedOrder) throw new MemberError(400, "Keep all eight songs and move them into your preferred order.");
    }
    if (displayName !== null && (typeof displayName !== "string" || !displayName.trim() || displayName.trim().replace(/\s+/g, " ").length > 60 || /[@\u0000-\u001f\u007f]/.test(displayName))) throw new MemberError(400, "Your display name needs 1 to 60 characters and cannot include @.");
    if (typeof status !== "string" || !status.trim() || status.trim().length > 160 || /[\u0000-\u001f\u007f]/.test(status)) throw new MemberError(400, "Your status needs 1 to 160 characters.");
    if (aboutMe !== null && (typeof aboutMe !== "string" || aboutMe.trim().length > 600 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(aboutMe))) throw new MemberError(400, "Your About Me needs to be 600 characters or less.");
    if (professionValue !== null && (typeof professionValue !== "string" || profession(professionValue) !== professionValue)) throw new MemberError(400, "Choose a profession from the profile list.");
    if (websiteValue !== null && (typeof websiteValue !== "string" || (websiteValue.trim() && !profileLink(websiteValue.trim())))) throw new MemberError(400, "Use a full https link for your profile link.");
    if (titleLines !== null && (typeof titleLines !== "string" || titleLines.trim().length > (member.isOwner ? 180 : 100) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(titleLines))) throw new MemberError(400, `What you do needs to be ${member.isOwner ? 180 : 100} characters or less.`);
    if (credentials !== null && (typeof credentials !== "string" || credentials.trim().length > 240 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(credentials))) throw new MemberError(400, "Credits and highlights need to be 240 characters or less.");
    if (location !== null && (typeof location !== "string" || location.trim().length > 140 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(location))) throw new MemberError(400, "Location needs to be 140 characters or less.");
    const text = status.trim();
    const requestId = form.get("request_id") || randomUUID();
    if (typeof requestId !== "string" || !MEMBER_ID.test(requestId)) throw new MemberError(400, "Please refresh the profile editor and try again.");
    const photo = await photoFile(form.get("photo"));
    const hash = photo ? createHash("sha256").update(member.id).update(new Uint8Array(photo.bytes)).digest("hex") : null;
    const profileKey = `profiles/${member.id}`;
    const previous = await store.getWithMetadata(profileKey, { type: "json" });
    const current = readProfile(previous?.data, member.id);
    const displayText = typeof displayName === "string" ? displayName.trim().replace(/\s+/g, " ") : current?.name || member.name;
    // The compact owner editor and older clients omit About Me. Preserve the
    // approved bio unless this request explicitly supplies a replacement.
    const aboutText = typeof aboutMe === "string" ? aboutMe.trim().replace(/\r\n?/g, "\n") : current?.about_me || "";
    const professionText = typeof professionValue === "string" ? profession(professionValue) : profession(current?.profession);
    const websiteText = typeof websiteValue === "string" ? profileLink(websiteValue.trim()) : profileLink(current?.website_url);
    const titleText = typeof titleLines === "string" ? titleLines.trim().replace(/\r\n?/g, "\n") : current?.title_lines || "";
    const credentialsText = member.isOwner && typeof credentials === "string" ? credentials.trim().replace(/\r\n?/g, "\n") : current?.credentials || "";
    const locationText = typeof location === "string" ? location.trim().replace(/\r\n?/g, "\n") : current?.location || "";
    const topOrder = member.isOwner ? requestedOrder ?? readTopEightOrder(current?.top_eight_order) ?? [...DEFAULT_TOP_EIGHT] : null;
    const fields = [displayText, text, aboutText, professionText, websiteText, titleText, credentialsText, locationText, hash];
    const digest = createHash("sha256").update(JSON.stringify(member.isOwner ? [...fields, topOrder] : fields)).digest("hex");
    if (current?.request_id === requestId.toLowerCase()) {
      if (current.input_digest !== digest) throw new MemberError(409, "This update was already used. Please start a new update.");
      return memberJSON({ profile: await publicProfile(store, current, member.isOwner), can_edit_owner: member.isOwner });
    }
    let decision: ModerationDecision;
    try {
      // Reordering the fixed songs does not change previously approved text.
      decision = requestedOrder && current && !photo && displayText === current.name && text === current.status && aboutText === current.about_me && professionText === current.profession && websiteText === current.website_url && titleText === current.title_lines && credentialsText === current.credentials && locationText === current.location
        ? { status: "approved", reason: "positive_or_respectful", policy_version: POLICY_VERSION, checked_at: new Date().toISOString() }
        : await moderateProfileText(displayText, [`Display name: ${displayText}`, text, aboutText && `About Me: ${aboutText}`, titleText && `What I do: ${titleText}`, credentialsText && `Highlights: ${credentialsText}`, locationText && `Location: ${locationText}`].filter(Boolean), options.moderate ?? moderateComment);
    }
    catch { return memberJSON({ status: "pending", error: "Your status could not be reviewed yet. Your current profile is unchanged." }, 202); }
    if (decision.status !== "approved" || decision.policy_version !== POLICY_VERSION) {
      const rejected = decision.status === "rejected";
      return memberJSON({ status: rejected ? "rejected" : "pending", error: rejected ? "Keep your status positive and respectful. Your current profile is unchanged." : "Your status could not be reviewed yet. Your current profile is unchanged." }, rejected ? 422 : 202);
    }
    const opKey = `updates/${member.id}/${requestId.toLowerCase()}`;
    const operation = { id: member.id, input_digest: digest, base_etag: previous?.etag ?? null, photo_id: hash ?? current?.photo_id ?? null };
    const reserved = await store.setJSON(opKey, operation, { onlyIfNew: true });
    const savedOp = reserved.modified ? operation : await store.get(opKey, { type: "json" });
    if (!savedOp || savedOp.id !== member.id || savedOp.input_digest !== digest) throw new MemberError(409, "This update was already used. Please start a new update.");
    if (savedOp.base_etag !== (previous?.etag ?? null)) throw new MemberError(409, "Your profile changed in another window. Reload before saving again.");
    if (member.isOwner && !bound) {
      await store.setJSON("owner-binding", { id: member.id }, { onlyIfNew: true });
      if (await ownerBinding(store) !== member.id) throw new MemberError(403, "This account cannot edit the site owner's profile.");
    }
    if (photo && hash) {
      await store.set(`assets/${hash}`, photo.bytes, { onlyIfNew: true });
      await store.setJSON(`photo-public/${hash}`, { owner_id: member.id, mime: photo.mime }, { onlyIfNew: true });
    }
    const candidate = { id: member.id, name: displayText, status: text, about_me: aboutText, profession: professionText, website_url: websiteText, title_lines: titleText, credentials: credentialsText, location: locationText, ...(member.isOwner ? { top_eight_order: topOrder } : {}), photo_id: savedOp.photo_id,
      updated_at: new Date().toISOString(), approved: true, policy_version: POLICY_VERSION,
      request_id: requestId.toLowerCase(), input_digest: digest };
    const written = await store.setJSON(profileKey, candidate, previous ? { onlyIfMatch: previous.etag } : { onlyIfNew: true });
    if (!written.modified) {
      const winning = readProfile(await store.get(profileKey, { type: "json" }), member.id);
      if (winning?.request_id === requestId.toLowerCase() && winning.input_digest === digest) {
        return memberJSON({ profile: await publicProfile(store, winning, member.isOwner), can_edit_owner: member.isOwner });
      }
      throw new MemberError(409, "Your profile changed in another window. Reload before saving again.");
    }
    return memberJSON({ profile: await publicProfile(store, candidate, member.isOwner), can_edit_owner: member.isOwner });
  } catch (error) { return profileFailure(error); }
}
export async function getProfilePhoto(req: Request, store: ProfileStore): Promise<Response> {
  if (req.method !== "GET") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    const hash = new URL(req.url).pathname.split("/").at(-1)!;
    if (!HASH.test(hash)) throw new MemberError(404, "Photo not found.");
    const mapping = await store.get(`photo-public/${hash}`, { type: "json" });
    if (!mapping || !MEMBER_ID.test(mapping.owner_id) || !["image/jpeg", "image/png", "image/webp"].includes(mapping.mime)) throw new MemberError(404, "Photo not found.");
    const record = readProfile(await store.get(`profiles/${mapping.owner_id}`, { type: "json" }), mapping.owner_id);
    if (!record || record.photo_id !== hash) throw new MemberError(404, "Photo not found.");
    const bytes = await store.get(`assets/${hash}`, { type: "arrayBuffer" });
    if (!bytes) throw new MemberError(404, "Photo not found.");
    return new Response(bytes, { headers: { "Content-Type": mapping.mime, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", "Netlify-CDN-Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; sandbox" } });
  } catch (error) { return profileFailure(error); }
}
