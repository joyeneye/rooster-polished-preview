/** ROOSTER is invite only.
 *
 * Everything a member can reach — profiles, private messages, the Chat Room,
 * ROOSTER LIVE — goes through one of the resolvers in this file first. An
 * account on its own grants nothing: except for the verified site owner, the
 * server reads the account's row in roster_access and refuses the request
 * unless that row says `approved`. A
 * direct link, a second signup page or a hand-written fetch all end up at the
 * same check, so there is nothing to bypass.
 *
 * An account becomes approved in exactly two ways, and J.White controls both:
 *   1. It redeemed an invitation code that he created.
 *   2. He approved it himself from the invite-only admin panel.
 *
 * Asking for an invite only writes a waiting-list row. It never creates an
 * account, a membership or access of any kind.
 */
import { and, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getUser, type User } from "@netlify/identity";
import { db } from "../../../db/index.js";
import { rosterAccess, rosterAccessLaunch, rosterInvitations, rosterInviteRequests } from "../../../db/schema.js";
import { MEMBER_ID, MemberError, memberJSON, requireMember, type Member } from "./member-auth.mts";
import { ACCESS_LAUNCHED_AT, resolveCutoverAccessRepair } from "./roster-access-policy.mts";

export { ACCESS_LAUNCHED_AT };

export const ACCESS_LAUNCH_ID = "roster";
/** The line between "was already a member" and "is a new arrival". Accounts
 * that existed before invite only went live keep the access they already had,
 * so this update never locks an existing member out of their own page. The
 * value is a constant rather than "whenever the first request lands" so the
 * boundary cannot move, and every account it lets in is listed as
 * grandfathered in the admin panel where it can still be withdrawn. */
export const ACCESS_STATUSES = ["pending", "approved", "declined"] as const;
export type AccessStatus = (typeof ACCESS_STATUSES)[number];
export const REQUEST_STATUSES = ["waiting", "approved", "declined"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export type AccessState = {
  member_id: string;
  status: AccessStatus;
  approved: boolean;
  grandfathered: boolean;
  invite_code: string;
  requested_at: string | null;
  decided_at: string | null;
};
export type AccessMember = Member & { isOwner: boolean; access: AccessState };

/** Codes get read aloud and typed on phones, so the alphabet leaves out the
 * characters people confuse: O/0, I/1, S/5. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRTUVWXY2346789";
const CODE_SHAPE = /^ROSTER-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;
const UNSAFE_NAME = /[\u0000-\u001f\u007f<>@]/;

export function env(key: string): string | undefined {
  return (globalThis as any).Netlify?.env?.get?.(key) ?? process.env[key];
}

export function accessFailure(error: unknown): Response {
  if (!(error instanceof MemberError)) {
    console.error("roster_access_unavailable", { error_type: error instanceof Error ? error.name : "Unknown" });
  }
  return error instanceof MemberError
    ? memberJSON({ error: error.message }, error.status)
    : memberJSON({ error: "ROOSTER could not check your invitation. Please try again in a moment." }, 503);
}

/** The message every gated surface shows. It says what to do next instead of
 * looking like the feature is broken. */
export const PENDING_MESSAGE = "ROOSTER is invite only. An invitation and approval are required to join ROOSTER. Enter your invite code or request an invite, and you are in once J.White approves you.";
export const DECLINED_MESSAGE = "ROOSTER is invite only and this account has not been approved to join.";

function isOwnerEmail(user: User | null, ownerEmail = env("SITE_OWNER_EMAIL")): boolean {
  return !!ownerEmail && typeof user?.email === "string"
    && user.email.trim().toLowerCase() === ownerEmail.trim().toLowerCase();
}

function readStatus(value: unknown): AccessStatus {
  return ACCESS_STATUSES.includes(value as AccessStatus) ? (value as AccessStatus) : "pending";
}

function stateOf(row: {
  memberId: string; status: string; grandfathered: boolean; inviteCode: string;
  requestedAt: Date | null; decidedAt: Date | null;
}): AccessState {
  const status = readStatus(row.status);
  return {
    member_id: row.memberId,
    status,
    approved: status === "approved",
    grandfathered: row.grandfathered,
    invite_code: row.inviteCode,
    requested_at: row.requestedAt ? new Date(row.requestedAt).toISOString() : null,
    decided_at: row.decidedAt ? new Date(row.decidedAt).toISOString() : null,
  };
}

/** Keep the persisted cutover aligned with the audited production launch. */
export async function accessLaunchedAt(): Promise<Date> {
  const launchedAt = new Date(ACCESS_LAUNCHED_AT);
  // ACCESS_LAUNCHED_AT is the audited production cutover. Keep the singleton
  // aligned with it so an earlier placeholder timestamp cannot strand people
  // who joined before the invite-only deploy was actually published.
  await db.insert(rosterAccessLaunch).values({ id: ACCESS_LAUNCH_ID, launchedAt })
    .onConflictDoUpdate({ target: rosterAccessLaunch.id, set: { launchedAt } });
  const [row] = await db.select().from(rosterAccessLaunch).where(eq(rosterAccessLaunch.id, ACCESS_LAUNCH_ID)).limit(1);
  return row ? new Date(row.launchedAt) : launchedAt;
}

async function accessRow(memberId: string) {
  const [row] = await db.select().from(rosterAccess).where(eq(rosterAccess.memberId, memberId)).limit(1);
  return row ?? null;
}

function approvedOwnerState(memberId: string): AccessState {
  return {
    member_id: memberId,
    status: "approved",
    approved: true,
    grandfathered: false,
    invite_code: "",
    requested_at: null,
    decided_at: null,
  };
}

/** Read, and if necessary create, the access row for one account. A brand new
 * account is written as `pending`, which grants nothing at all. */
export async function ensureAccess(member: Member, user: User | null, isOwner: boolean): Promise<AccessState> {
  if (!MEMBER_ID.test(member.id)) throw new MemberError(400, "Your member account could not be read.");
  const id = member.id.toLowerCase();
  // The verified site-owner email is the root of authority for ROOSTER. Do not
  // make the owner depend on the invitation database merely to enter their own
  // community: a sleeping or temporarily unavailable database must not lock
  // J.White out of profiles, messages, or the access dashboard. Ordinary
  // accounts still fail closed through the access row below.
  if (isOwner) return approvedOwnerState(id);
  const existing = await accessRow(id);
  if (existing) {
    // The first release used midnight as the cutover even though invite-only
    // did not publish until 06:08 UTC. Repair only untouched pending rows from
    // that window; an explicit Founder decision has decidedAt and is preserved.
    const launchedAt = new Date(ACCESS_LAUNCHED_AT);
    const resolved = await resolveCutoverAccessRepair(existing, launchedAt, async () => {
      const [repaired] = await db.update(rosterAccess).set({
        status: "approved", grandfathered: true, decidedAt: new Date(), decidedBy: "grandfathered",
      }).where(and(
        eq(rosterAccess.memberId, id), eq(rosterAccess.status, "pending"),
        eq(rosterAccess.grandfathered, false), isNull(rosterAccess.decidedAt),
        lte(rosterAccess.accountCreatedAt, launchedAt),
      )).returning();
      return repaired ?? null;
    }, () => accessRow(id));
    if (!resolved) throw new MemberError(503, "ROOSTER could not check your invitation. Please try again in a moment.");
    return stateOf(resolved);
  }
  const launched = await accessLaunchedAt();
  const created = typeof user?.createdAt === "string" ? Date.parse(user.createdAt) : NaN;
  const existedBefore = Number.isFinite(created) && created <= launched.getTime();
  const grandfathered = existedBefore;
  await db.insert(rosterAccess).values({
    memberId: id,
    displayName: member.name.slice(0, 60),
    status: existedBefore ? "approved" : "pending",
    grandfathered,
    accountCreatedAt: Number.isFinite(created) ? new Date(created) : undefined,
    ...(existedBefore ? { decidedAt: new Date(), decidedBy: "grandfathered" } : {}),
  }).onConflictDoNothing();
  const row = await accessRow(id);
  if (!row) throw new MemberError(503, "ROOSTER could not check your invitation. Please try again in a moment.");
  return stateOf(row);
}

/** Identity plus the invitation check, without throwing when the account is
 * not approved yet. The invite-only screens use this so somebody who is
 * waiting can still see where they stand and type a code. */
export async function readAccessMember(loadUser: () => Promise<User | null> = getUser): Promise<AccessMember> {
  const user = await loadUser();
  const member = await requireMember(async () => user);
  const isOwner = isOwnerEmail(user);
  const access = await ensureAccess(member, user, isOwner);
  return { ...member, name: isOwner ? "J.White Did It" : member.name, isOwner, access };
}

function refuse(access: AccessState): never {
  throw new MemberError(403, access.status === "declined" ? DECLINED_MESSAGE : PENDING_MESSAGE);
}

/** The gate. Every community surface resolves its member through this, so an
 * account that has not been invited and approved gets a 403 from the server no
 * matter which page, link or hand-written request it came from. */
export async function requireCommunityMember(loadUser: () => Promise<User | null> = getUser): Promise<Member> {
  const member = await readAccessMember(loadUser);
  if (!member.access.approved) refuse(member.access);
  return { id: member.id, name: member.name };
}

/** The same gate for surfaces that also need to know whether this is J.White's
 * own account. Shaped like resolveProfileMember so it drops in wherever that
 * was the default. */
export async function resolveCommunityProfileMember(
  loadUser: () => Promise<User | null> = getUser,
): Promise<{ id: string; name: string; isOwner: boolean }> {
  const member = await readAccessMember(loadUser);
  if (!member.access.approved) refuse(member.access);
  return { id: member.id, name: member.name, isOwner: member.isOwner };
}

/** Owner-only, for the invite-only admin panel. */
export async function requireAccessAdmin(loadUser: () => Promise<User | null> = getUser): Promise<AccessMember> {
  const member = await readAccessMember(loadUser);
  if (!member.isOwner) throw new MemberError(403, "Only J.White can manage invitations and approvals.");
  return member;
}

export function normalizeCode(value: unknown): string {
  const raw = String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw.length !== 14 || !raw.startsWith("ROSTER")) return "";
  const code = `ROSTER-${raw.slice(6, 10)}-${raw.slice(10, 14)}`;
  return CODE_SHAPE.test(code) ? code : "";
}

function newCode(): string {
  let body = "";
  for (const byte of randomBytes(8)) body += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return `ROSTER-${body.slice(0, 4)}-${body.slice(4, 8)}`;
}

export function normalizeEmail(value: unknown): string {
  const email = String(value ?? "").trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : "";
}

export function normalizeName(value: unknown): string {
  const name = String(value ?? "").trim().replace(/\s+/g, " ");
  return name.length >= 2 && name.length <= 60 && !UNSAFE_NAME.test(name) ? name : "";
}

export type InvitationRow = {
  id: number; code: string; note: string; uses: number; max_uses: number;
  expires_at: string | null; revoked_at: string | null; created_at: string; usable: boolean;
};

function invitationRow(row: typeof rosterInvitations.$inferSelect, now = Date.now()): InvitationRow {
  const expired = row.expiresAt ? new Date(row.expiresAt).getTime() <= now : false;
  return {
    id: row.id, code: row.code, note: row.note, uses: row.uses, max_uses: row.maxUses,
    expires_at: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
    revoked_at: row.revokedAt ? new Date(row.revokedAt).toISOString() : null,
    created_at: new Date(row.createdAt).toISOString(),
    usable: !row.revokedAt && !expired && row.uses < row.maxUses,
  };
}

/** Create an invitation. Only ever reached for J.White's own account. */
export async function createInvitation(
  founderId: string, input: { note?: unknown; max_uses?: unknown; expires_in_days?: unknown } = {},
): Promise<InvitationRow> {
  const note = String(input.note ?? "").trim().slice(0, 120);
  const requested = Number(input.max_uses ?? 1);
  const maxUses = Number.isSafeInteger(requested) && requested >= 1 && requested <= 50 ? requested : 1;
  const days = Number(input.expires_in_days ?? 30);
  const expiresIn = Number.isSafeInteger(days) && days >= 1 && days <= 365 ? days : 30;
  const expiresAt = new Date(Date.now() + expiresIn * 86_400_000);
  // A collision is vanishingly unlikely, but a duplicate code must never
  // overwrite an invitation somebody is already holding, so retry instead.
  for (let attempt = 0; attempt < 5; attempt++) {
    const [row] = await db.insert(rosterInvitations)
      .values({ code: newCode(), note, createdBy: founderId, maxUses, expiresAt })
      .onConflictDoNothing().returning();
    if (row) return invitationRow(row);
  }
  throw new MemberError(503, "That invitation could not be created. Please try again.");
}

export async function revokeInvitation(founderId: string, id: unknown): Promise<InvitationRow> {
  const invitationId = Number(id);
  if (!Number.isSafeInteger(invitationId) || invitationId < 1) throw new MemberError(400, "Choose a valid invitation.");
  const [row] = await db.update(rosterInvitations)
    .set({ revokedAt: new Date(), revokedBy: founderId })
    .where(eq(rosterInvitations.id, invitationId)).returning();
  if (!row) throw new MemberError(404, "That invitation could not be found.");
  return invitationRow(row);
}

/** Redeem an invitation code for the signed-in account. The claim is a single
 * conditional UPDATE, so two people racing on a one-use code cannot both get
 * in, and a revoked, expired or spent code is refused. */
export async function redeemInvite(member: AccessMember, code: unknown): Promise<AccessState> {
  const normalized = normalizeCode(code);
  if (!normalized) throw new MemberError(400, "That invite code is not in the right shape. Codes look like ROSTER-ABCD-2345.");
  if (member.access.approved) return member.access;
  const now = new Date();
  const [claimed] = await db.update(rosterInvitations)
    .set({ uses: sql`${rosterInvitations.uses} + 1` })
    .where(and(
      eq(rosterInvitations.code, normalized),
      isNull(rosterInvitations.revokedAt),
      sql`${rosterInvitations.uses} < ${rosterInvitations.maxUses}`,
      or(isNull(rosterInvitations.expiresAt), gt(rosterInvitations.expiresAt, now)),
    ))
    .returning();
  if (!claimed) throw new MemberError(403, "That invite code is not valid. It may have been used already, expired, or been withdrawn.");
  const [row] = await db.update(rosterAccess).set({
    status: "approved", invitationId: claimed.id, inviteCode: claimed.code,
    decidedAt: now, decidedBy: claimed.createdBy, grandfathered: false,
  }).where(eq(rosterAccess.memberId, member.id)).returning();
  if (!row) throw new MemberError(503, "ROOSTER could not record your invitation. Please try again.");
  // Close out the waiting-list row this code was issued against.
  await db.update(rosterInviteRequests)
    .set({ status: "approved", memberId: member.id, decidedAt: now, decidedBy: claimed.createdBy })
    .where(and(eq(rosterInviteRequests.invitationId, claimed.id), eq(rosterInviteRequests.status, "waiting")));
  return stateOf(row);
}

export type RequestRow = {
  id: number; name: string; email: string; about: string; status: RequestStatus;
  member_id: string | null; invite_code: string | null; created_at: string; decided_at: string | null;
};

/** Join the waiting list. This is the only thing "Request an Invite" does: it
 * writes one row. No account, no membership, no access. */
export async function requestInvite(
  input: { name?: unknown; email?: unknown; about?: unknown }, memberId: string | null = null,
): Promise<{ status: RequestStatus; already_waiting: boolean }> {
  const name = normalizeName(input.name);
  const email = normalizeEmail(input.email);
  const about = String(input.about ?? "").trim().replace(/\s+/g, " ").slice(0, 500);
  if (!name) throw new MemberError(400, "Add the name you go by, between 2 and 60 characters.");
  if (!email) throw new MemberError(400, "Add an email address ROOSTER can reach you at.");
  const [inserted] = await db.insert(rosterInviteRequests)
    .values({ name, email, about, memberId, status: "waiting" })
    .onConflictDoNothing({ target: rosterInviteRequests.email }).returning();
  if (inserted) return { status: "waiting", already_waiting: false };
  const [existing] = await db.select().from(rosterInviteRequests)
    .where(eq(rosterInviteRequests.email, email)).limit(1);
  // Keep a decision that has already been made; only refresh what they told us.
  if (existing && existing.status === "waiting") {
    await db.update(rosterInviteRequests)
      .set({ name, about, ...(memberId ? { memberId } : {}) })
      .where(eq(rosterInviteRequests.id, existing.id));
  }
  const status = (REQUEST_STATUSES.includes(existing?.status as RequestStatus)
    ? existing!.status : "waiting") as RequestStatus;
  return { status, already_waiting: true };
}

async function requestRows(limit = 200): Promise<RequestRow[]> {
  const rows = await db.select({
    id: rosterInviteRequests.id, name: rosterInviteRequests.name, email: rosterInviteRequests.email,
    about: rosterInviteRequests.about, status: rosterInviteRequests.status, memberId: rosterInviteRequests.memberId,
    createdAt: rosterInviteRequests.createdAt, decidedAt: rosterInviteRequests.decidedAt,
    code: rosterInvitations.code,
  }).from(rosterInviteRequests)
    .leftJoin(rosterInvitations, eq(rosterInviteRequests.invitationId, rosterInvitations.id))
    .orderBy(sql`${rosterInviteRequests.createdAt} desc`).limit(limit);
  return rows.map(row => ({
    id: row.id, name: row.name, email: row.email, about: row.about,
    status: (REQUEST_STATUSES.includes(row.status as RequestStatus) ? row.status : "waiting") as RequestStatus,
    member_id: row.memberId, invite_code: row.code ?? null,
    created_at: new Date(row.createdAt).toISOString(),
    decided_at: row.decidedAt ? new Date(row.decidedAt).toISOString() : null,
  }));
}

/** Approve a waiting-list row: mint that person's invitation and hand the code
 * back so J.White can send it to them. */
export async function approveRequest(
  founderId: string, id: unknown,
): Promise<{ request: RequestRow; invitation: InvitationRow }> {
  const requestId = Number(id);
  if (!Number.isSafeInteger(requestId) || requestId < 1) throw new MemberError(400, "Choose a valid invite request.");
  const [existing] = await db.select().from(rosterInviteRequests).where(eq(rosterInviteRequests.id, requestId)).limit(1);
  if (!existing) throw new MemberError(404, "That invite request could not be found.");
  const invitation = await createInvitation(founderId, { note: `Invite for ${existing.name}`, max_uses: 1 });
  await db.update(rosterInviteRequests).set({
    status: "approved", invitationId: invitation.id, decidedAt: new Date(), decidedBy: founderId,
  }).where(eq(rosterInviteRequests.id, requestId));
  // If they already made an account while waiting, let that account in now.
  if (existing.memberId && MEMBER_ID.test(existing.memberId)) {
    await setMemberAccess(founderId, existing.memberId, "approved", invitation.id, invitation.code);
  }
  const rows = await requestRows();
  const request = rows.find(row => row.id === requestId);
  if (!request) throw new MemberError(503, "That approval could not be read back. Please refresh.");
  return { request, invitation };
}

export async function declineRequest(founderId: string, id: unknown): Promise<RequestRow> {
  const requestId = Number(id);
  if (!Number.isSafeInteger(requestId) || requestId < 1) throw new MemberError(400, "Choose a valid invite request.");
  const [row] = await db.update(rosterInviteRequests)
    .set({ status: "declined", decidedAt: new Date(), decidedBy: founderId })
    .where(eq(rosterInviteRequests.id, requestId)).returning();
  if (!row) throw new MemberError(404, "That invite request could not be found.");
  if (row.memberId && MEMBER_ID.test(row.memberId)) await setMemberAccess(founderId, row.memberId, "declined");
  const rows = await requestRows();
  const request = rows.find(entry => entry.id === requestId);
  if (!request) throw new MemberError(503, "That decision could not be read back. Please refresh.");
  return request;
}

export type AccessMemberRow = {
  member_id: string; name: string; status: AccessStatus; grandfathered: boolean;
  invite_code: string; created_at: string; decided_at: string | null;
};

function accessMemberRow(row: typeof rosterAccess.$inferSelect): AccessMemberRow {
  return {
    member_id: row.memberId, name: row.displayName || `Member ${row.memberId.slice(0, 8)}`,
    status: readStatus(row.status), grandfathered: row.grandfathered, invite_code: row.inviteCode,
    created_at: new Date(row.createdAt).toISOString(),
    decided_at: row.decidedAt ? new Date(row.decidedAt).toISOString() : null,
  };
}

/** Approve or withdraw one account's access directly. */
export async function setMemberAccess(
  founderId: string, memberId: unknown, status: unknown, invitationId?: number, inviteCode?: string,
): Promise<AccessMemberRow> {
  const id = String(memberId ?? "").toLowerCase();
  if (!MEMBER_ID.test(id)) throw new MemberError(400, "Choose a valid member.");
  if (!ACCESS_STATUSES.includes(status as AccessStatus)) throw new MemberError(400, "Choose approved, pending or declined.");
  const decided = { status: status as AccessStatus, decidedAt: new Date(), decidedBy: founderId };
  const invite = invitationId ? { invitationId, inviteCode: inviteCode ?? "" } : {};
  const [row] = await db.update(rosterAccess).set({ ...decided, ...invite })
    .where(eq(rosterAccess.memberId, id)).returning();
  if (row) return accessMemberRow(row);
  // The person holds an invitation but has not opened ROOSTER yet. Record the
  // decision now so it applies the moment they first sign in.
  const [created] = await db.insert(rosterAccess).values({ memberId: id, ...decided, ...invite })
    .onConflictDoUpdate({ target: rosterAccess.memberId, set: decided }).returning();
  if (!created) throw new MemberError(503, "That approval could not be saved. Please try again.");
  return accessMemberRow(created);
}

/** Everything the admin panel shows, in one read. */
export async function accessOverview(): Promise<{
  invitations: InvitationRow[]; requests: RequestRow[]; members: AccessMemberRow[];
  counts: Record<string, number>;
}> {
  const [invitations, requests, members] = await Promise.all([
    db.select().from(rosterInvitations).orderBy(sql`${rosterInvitations.createdAt} desc`).limit(200),
    requestRows(),
    db.select().from(rosterAccess).orderBy(sql`${rosterAccess.createdAt} desc`).limit(500),
  ]);
  const rows = members.map(accessMemberRow);
  return {
    invitations: invitations.map(row => invitationRow(row)),
    requests,
    members: rows,
    counts: {
      approved: rows.filter(row => row.status === "approved").length,
      pending: rows.filter(row => row.status === "pending").length,
      declined: rows.filter(row => row.status === "declined").length,
      waiting_requests: requests.filter(row => row.status === "waiting").length,
      usable_invitations: invitations.filter(row => invitationRow(row).usable).length,
    },
  };
}

const BODY_LIMIT = 8 * 1024;

/** Byte-limited JSON body reader, shared by the invite-only and ROOSTER LIVE
 * endpoints so a large or malformed body is refused before it is parsed. */
export async function readAccessBody(req: Request, label = "request"): Promise<Record<string, unknown>> {
  const invalid = `That ${label} could not be read.`;
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
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new MemberError(400, invalid); }
}

/** The public shape of the invite-only state, for a visitor who may not be
 * signed in at all. Anonymous is a first-class answer here: the landing page
 * and the signup screen ask for this before anybody has an account. */
export async function accessStateForVisitor(
  loadUser: () => Promise<User | null> = getUser,
): Promise<{
  invite_only: true; signed_in: boolean; approved: boolean; status: string;
  is_owner: boolean; member_id: string | null; name: string | null;
  grandfathered: boolean; message: string;
}> {
  let member: AccessMember | null = null;
  try {
    member = await readAccessMember(loadUser);
  } catch (error) {
    // Not signed in, or not confirmed yet. Either way there is no access.
    if (error instanceof MemberError && error.status !== 503) {
      return {
        invite_only: true, signed_in: false, approved: false, status: "anonymous",
        is_owner: false, member_id: null, name: null, grandfathered: false, message: PENDING_MESSAGE,
      };
    }
    throw error;
  }
  return {
    invite_only: true,
    signed_in: true,
    approved: member.access.approved,
    status: member.access.status,
    is_owner: member.isOwner,
    member_id: member.id,
    name: member.name,
    grandfathered: member.access.grandfathered,
    message: member.access.approved
      ? "You are approved. Welcome to ROOSTER."
      : member.access.status === "declined" ? DECLINED_MESSAGE : PENDING_MESSAGE,
  };
}
