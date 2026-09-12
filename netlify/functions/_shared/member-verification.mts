import { MEMBER_ID, MemberError, assertSameOrigin, memberJSON } from "./member-auth.mts";
import { profileFailure, type ProfileStore, type ProfileMember } from "./member-profiles.mts";
import type { MemberStore } from "./member-messages.mts";
import { verificationStatus } from "./verification-badges.mts";
import { resolveCommunityProfileMember } from "./roster-access.mts";
type Directory = Pick<MemberStore, "get" | "list">;
type Options = { resolveMember?: () => Promise<ProfileMember> };

async function permissions(member: ProfileMember, store: ProfileStore) {
  const binding = await store.get("owner-binding", { type: "json" });
  if (binding !== null && (!binding || typeof binding.id !== "string" || !MEMBER_ID.test(binding.id))) throw new Error("Invalid owner binding");
  const ownerId = binding?.id ?? (member.isOwner ? member.id : null);
  const isOwner = member.isOwner && ownerId === member.id;
  const role = !isOwner && member.id !== ownerId ? await store.get(`verification-team/${member.id}`, { type: "json" }) : null;
  const isTeam = !!ownerId && role?.id === member.id && role?.can_verify === true;
  if (!isOwner && !isTeam) throw new MemberError(403, "Only J.White and his approved team can manage verification.");
  return { ownerId, isOwner, isTeam, bound: !!binding };
}
async function directoryMember(directory: Directory, id: string) {
  const record: any = await directory.get(`members/${id}`, { type: "json" });
  if (!record || record.id !== id || typeof record.name !== "string" || !record.name.trim() || record.name.length > 60 || /[@\u0000-\u001f\u007f]/.test(record.name)) return null;
  return { id, name: record.name };
}
async function memberRow(directory: Directory, store: ProfileStore, id: string, ownerId: string | null) {
  const member = await directoryMember(directory, id);
  if (!member) return null;
  const [badge, role] = await Promise.all([
    verificationStatus(store, id, id === ownerId),
    store.get(`verification-team/${id}`, { type: "json" }),
  ]);
  return { ...member, verified: badge.verified, can_verify: id === ownerId || (role?.id === id && role?.can_verify === true) };
}
export async function getVerification(req: Request, store: ProfileStore, directory: Directory, options: Options = {}): Promise<Response> {
  if (req.method !== "GET") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req);
    const member = await (options.resolveMember ?? resolveCommunityProfileMember)();
    const access = await permissions(member, store);
    const ids = new Set<string>(); let pages = 0;
    for await (const page of directory.list({ prefix: "members/", paginate: true })) {
      if (++pages > 100) throw new MemberError(503, "The member list is too large to load right now.");
      for (const item of page.blobs) {
        if (typeof item.key !== "string" || !item.key.startsWith("members/")) continue;
        const id = item.key.slice(8);
        if (MEMBER_ID.test(id)) ids.add(id.toLowerCase());
        if (ids.size > 10000) throw new MemberError(503, "The member list is too large to load right now.");
      }
    }
    const sorted = [...ids].sort(); const members = [];
    for (let offset = 0; offset < sorted.length; offset += 12) {
      members.push(...(await Promise.all(sorted.slice(offset, offset + 12).map(id => memberRow(directory, store, id, access.ownerId)))).filter(Boolean));
    }
    return memberJSON({ members, can_manage_team: access.isOwner });
  } catch (error) { return profileFailure(error); }
}
async function body(req: Request): Promise<any> {
  if ((req.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new MemberError(415, "This verification format is not supported.");
  if (Number(req.headers.get("content-length") || 0) > 4096 || !req.body) throw new MemberError(413, "This verification request is too large.");
  const reader = req.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength; if (length > 4096) { await reader.cancel(); throw new MemberError(413, "This verification request is too large."); } chunks.push(part.value); }
  } finally { reader.releaseLock(); }
  const data = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  try { const parsed = JSON.parse(new TextDecoder().decode(data)); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(); return parsed; }
  catch { throw new MemberError(400, "This verification request could not be read."); }
}
export async function updateVerification(req: Request, store: ProfileStore, directory: Directory, options: Options = {}): Promise<Response> {
  if (req.method !== "POST") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req);
    const member = await (options.resolveMember ?? resolveCommunityProfileMember)();
    let access = await permissions(member, store);
    const input = await body(req);
    if (typeof input.member_id !== "string" || !MEMBER_ID.test(input.member_id) || !["verify", "unverify", "grant_team", "revoke_team"].includes(input.action)) throw new MemberError(400, "Choose a valid member and verification action.");
    const id = input.member_id.toLowerCase();
    if (id === access.ownerId) throw new MemberError(403, "J.White's gold verification is protected.");
    if (!access.isOwner && (input.action === "grant_team" || input.action === "revoke_team")) throw new MemberError(403, "Only J.White can change verification team access.");
    if (!access.isOwner && id === member.id) throw new MemberError(403, "Ask J.White or another approved team member to change your check.");
    if (!await directoryMember(directory, id)) throw new MemberError(404, "That member is not available yet.");
    if (access.isOwner && !access.bound) {
      await store.setJSON("owner-binding", { id: member.id }, { onlyIfNew: true });
    }
    // Reload private authority after request parsing and target lookups so a revoked
    // team role is never kept in a session or taken from user metadata.
    access = await permissions(member, store);
    const teamAction = input.action === "grant_team" || input.action === "revoke_team";
    if (teamAction && !access.isOwner) throw new MemberError(403, "Only J.White can change verification team access.");
    const key = teamAction ? `verification-team/${id}` : `verifications/${id}`;
    const record = teamAction ? { id, can_verify: input.action === "grant_team" } : { id, verified: input.action === "verify" };
    const result = await store.setJSON(key, { ...record, updated_at: new Date().toISOString(), updated_by: member.id });
    if (!result.modified) throw new Error("Verification was not saved");
    return memberJSON({ member: await memberRow(directory, store, id, access.ownerId), can_manage_team: access.isOwner });
  } catch (error) { return profileFailure(error); }
}
