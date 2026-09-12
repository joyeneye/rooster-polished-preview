/** ROOSTER membership levels. Everybody who already had an account when the
 * approval and invite system went live is an Early Member, permanently, and
 * some of them are later made Founding Members or Approved Creators by the
 * Founder. The membership_launch row is the switch: until the Founder confirms
 * the new system is live, no Early Member badge is shown publicly and no
 * Founder announcement can be sent, so ROOSTER never announces something that
 * is not actually turned on yet. */
import { eq, sql } from "drizzle-orm";
import { db } from "../../../db/index.js";
import { memberships, membershipLaunch } from "../../../db/schema.js";
import { MEMBER_ID, MemberError, type Member } from "./member-auth.mts";
import { publicMember, type CommunityReader } from "./community-members.mts";

export const LAUNCH_ID = "roster";

/** The levels a member can hold. Early Member is a separate historical fact,
 * not a level, because an Early Member who becomes a Founding Member keeps
 * both badges. */
export const MEMBERSHIP_LEVELS = [
  { value: "member", label: "Member" },
  { value: "early_member", label: "Early Member" },
  { value: "founding_member", label: "Founding Member" },
  { value: "approved_creator", label: "Approved Creator" },
] as const;

export type MembershipLevel = (typeof MEMBERSHIP_LEVELS)[number]["value"];
export type MembershipBadges = {
  level: MembershipLevel; level_label: string;
  early_member: boolean; founding_member: boolean; approved_creator: boolean;
  member_since: string | null; membership_live: boolean;
};
export type MembershipRoster = { id: string; name: string; joined_at: string | null };

export function isMembershipLevel(value: unknown): value is MembershipLevel {
  return typeof value === "string" && MEMBERSHIP_LEVELS.some(level => level.value === value);
}

function levelLabel(value: string): string {
  return MEMBERSHIP_LEVELS.find(level => level.value === value)?.label ?? "Member";
}

function noBadges(): MembershipBadges {
  return {
    level: "member", level_label: "Member", early_member: false,
    founding_member: false, approved_creator: false, member_since: null, membership_live: false,
  };
}

export async function membershipLaunchRecord(): Promise<{ launched_at: string; early_member_count: number } | null> {
  const [row] = await db.select().from(membershipLaunch).where(eq(membershipLaunch.id, LAUNCH_ID)).limit(1);
  return row ? { launched_at: new Date(row.launchedAt).toISOString(), early_member_count: row.earlyMemberCount } : null;
}

function joinedAtOf(record: unknown): Date | null {
  const value = (record as { joined_at?: unknown } | null)?.joined_at;
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

/** Record the member's membership on any authenticated request. An account
 * that existed before the launch keeps Early Member; one created afterwards
 * does not. Existing rows are never downgraded here — only the Founder
 * changes a level. */
export async function ensureMembership(
  member: Member, profiles?: Pick<CommunityReader, "get">,
): Promise<MembershipBadges> {
  if (!MEMBER_ID.test(member.id)) throw new MemberError(400, "Your member account could not be read.");
  const id = member.id.toLowerCase();
  const launch = await membershipLaunchRecord();
  const joinedAt = profiles ? joinedAtOf(await profiles.get(`public-members/${id}`, { type: "json" })) : null;
  const launchedAt = launch ? new Date(launch.launched_at) : null;
  // No launch yet means every account that exists right now predates it.
  const early = !launchedAt || (joinedAt ? joinedAt.getTime() <= launchedAt.getTime() : true);
  await db.insert(memberships).values({
    memberId: id,
    displayName: member.name.slice(0, 60),
    level: early ? "early_member" : "member",
    earlyMember: early,
    joinedAt: joinedAt ?? undefined,
  }).onConflictDoUpdate({
    target: memberships.memberId,
    set: { displayName: member.name.slice(0, 60), ...(joinedAt ? { joinedAt } : {}) },
  });
  return await membershipBadges(id);
}

async function membershipRow(memberId: string) {
  return await db.select().from(memberships).where(eq(memberships.memberId, memberId)).limit(1);
}

export async function membershipBadges(memberId: string): Promise<MembershipBadges> {
  if (!MEMBER_ID.test(memberId)) return noBadges();
  // Both queries are started through async calls so that a client failure on
  // one of them can never leave the other's rejection unhandled.
  const [launch, [row]] = await Promise.all([
    membershipLaunchRecord(),
    membershipRow(memberId.toLowerCase()),
  ]);
  if (!row) return noBadges();
  const live = Boolean(launch);
  return {
    level: (isMembershipLevel(row.level) ? row.level : "member"),
    level_label: levelLabel(row.level),
    // Badges become public only once the Founder confirms the new membership
    // system is live, so nobody sees a badge for a system that is still off.
    early_member: live && row.earlyMember,
    founding_member: live && row.level === "founding_member",
    approved_creator: live && row.level === "approved_creator",
    member_since: row.joinedAt ? new Date(row.joinedAt).toISOString() : null,
    membership_live: live,
  };
}

/** Never let a badge lookup break a profile page. */
export async function membershipBadgesOrNone(memberId: string): Promise<MembershipBadges> {
  try {
    return await membershipBadges(memberId);
  } catch {
    console.warn("membership_badges_unavailable");
    return noBadges();
  }
}

/** Every account that already exists, read from the durable member pages and
 * the member directory with hard bounds. A partial roster would silently make
 * somebody miss their Early Member status, so this fails instead. */
export async function membershipRoster(
  profiles?: CommunityReader, directory?: CommunityReader,
): Promise<MembershipRoster[]> {
  const found = new Map<string, MembershipRoster>();
  let pages = 0, keysSeen = 0;
  const scan = async (store: CommunityReader | undefined, prefix: string) => {
    if (!store?.list) return;
    for await (const page of store.list({ prefix, paginate: true })) {
      if (++pages > 100) throw new MemberError(503, "The member list is busy. Please try again.");
      const keys = page.blobs.map(blob => blob.key)
        .filter(key => typeof key === "string" && key.startsWith(prefix) && MEMBER_ID.test(key.slice(prefix.length)));
      if ((keysSeen += keys.length) > 10000) throw new MemberError(503, "The member list is busy. Please try again.");
      for (let offset = 0; offset < keys.length; offset += 12) {
        const values = await Promise.all(keys.slice(offset, offset + 12)
          .map(async key => ({ key, value: await store.get(key, { type: "json" }) })));
        for (const { key, value } of values) {
          const member = publicMember(value, key.slice(prefix.length));
          if (!member) continue;
          const joined = joinedAtOf(value);
          const existing = found.get(member.id);
          found.set(member.id, {
            id: member.id, name: member.name,
            joined_at: (joined?.toISOString() ?? existing?.joined_at) ?? null,
          });
        }
      }
    }
  };
  await scan(directory, "members/");
  await scan(profiles, "public-members/");
  return [...found.values()];
}

/** Turn the new membership system on. Every account that exists at this moment
 * is written as an Early Member before the launch row is created, so the badge
 * is real by the time any announcement about it can be sent. Running this again
 * keeps the original launch time and does not re-grant Early Member to
 * accounts created since. */
export async function recordMembershipLaunch(
  founderId: string, roster: MembershipRoster[],
): Promise<{ launched_at: string; early_member_count: number; existing_accounts: number; newly_marked: number }> {
  const existing = await membershipLaunchRecord();
  const launchedAt = existing ? new Date(existing.launched_at) : new Date();
  const eligible = roster.filter(entry => {
    if (!MEMBER_ID.test(entry.id)) return false;
    if (!existing) return true;
    const joined = entry.joined_at ? Date.parse(entry.joined_at) : NaN;
    // Accounts with no recorded join date are older than this feature.
    return !Number.isFinite(joined) || joined <= launchedAt.getTime();
  });
  let marked = 0;
  for (let offset = 0; offset < eligible.length; offset += 50) {
    const batch = eligible.slice(offset, offset + 50);
    const rows = await db.insert(memberships).values(batch.map(entry => ({
      memberId: entry.id,
      displayName: entry.name.slice(0, 60),
      level: "early_member" as const,
      earlyMember: true,
      joinedAt: entry.joined_at ? new Date(entry.joined_at) : undefined,
      levelUpdatedAt: new Date(),
      levelUpdatedBy: founderId,
    }))).onConflictDoUpdate({
      target: memberships.memberId,
      set: {
        displayName: sql`excluded.display_name`,
        earlyMember: true,
        level: sql`case when ${memberships.level} = 'member' then 'early_member' else ${memberships.level} end`,
      },
    }).returning({ memberId: memberships.memberId });
    marked += rows.length;
  }
  const earlyCount = await countEarlyMembers();
  await db.insert(membershipLaunch).values({
    id: LAUNCH_ID, launchedAt, launchedBy: founderId, earlyMemberCount: earlyCount,
  }).onConflictDoUpdate({ target: membershipLaunch.id, set: { earlyMemberCount: earlyCount } });
  return {
    launched_at: launchedAt.toISOString(), early_member_count: earlyCount,
    existing_accounts: roster.length, newly_marked: marked,
  };
}

export async function countEarlyMembers(): Promise<number> {
  const [row] = await db.select({ total: sql<number>`count(*)::int` })
    .from(memberships).where(eq(memberships.earlyMember, true));
  return Number(row?.total ?? 0);
}

/** Founder-only level change. Early Member is history and is never taken away
 * by a level change. */
export async function setMembershipLevel(
  memberId: string, level: MembershipLevel, founderId: string,
): Promise<{ id: string; name: string; level: MembershipLevel; early_member: boolean }> {
  if (!MEMBER_ID.test(memberId) || !isMembershipLevel(level)) throw new MemberError(400, "Choose a valid member and membership level.");
  const id = memberId.toLowerCase();
  const [row] = await db.update(memberships)
    .set({ level, levelUpdatedAt: new Date(), levelUpdatedBy: founderId })
    .where(eq(memberships.memberId, id))
    .returning({ memberId: memberships.memberId, displayName: memberships.displayName, level: memberships.level, earlyMember: memberships.earlyMember });
  if (!row) throw new MemberError(404, "That name on the roster has not opened ROOSTER since the new membership system went live.");
  return {
    id: row.memberId, name: row.displayName, early_member: row.earlyMember,
    level: isMembershipLevel(row.level) ? row.level : "member",
  };
}

export async function membershipRows(limit = 500): Promise<
  { id: string; name: string; level: MembershipLevel; level_label: string; early_member: boolean }[]
> {
  const rows = await db.select().from(memberships).orderBy(memberships.displayName).limit(limit);
  return rows.map(row => ({
    id: row.memberId, name: row.displayName || `Member ${row.memberId.slice(0, 8)}`,
    level: isMembershipLevel(row.level) ? row.level : "member",
    level_label: levelLabel(row.level), early_member: row.earlyMember,
  }));
}

/** Membership counts for the Founder dashboard, so a mass announcement always
 * shows how many people it is about to reach. */
export async function membershipCounts(): Promise<Record<string, number>> {
  const rows = await db.select({ level: memberships.level, total: sql<number>`count(*)::int` })
    .from(memberships).groupBy(memberships.level);
  const byLevel: Record<string, number> = {};
  let everyone = 0;
  for (const row of rows) { byLevel[row.level] = Number(row.total); everyone += Number(row.total); }
  return {
    everyone,
    early_members: await countEarlyMembers(),
    founding_members: byLevel.founding_member ?? 0,
    approved_creators: byLevel.approved_creator ?? 0,
    member: byLevel.member ?? 0,
    early_member: byLevel.early_member ?? 0,
  };
}
