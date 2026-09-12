import type { Context } from "@netlify/functions";
import type { Member } from "./member-auth.mts";
import { memberStores, type MemberStores } from "./member-messages.mts";
import { profileStore } from "./member-profiles.mts";
import { ensureMembership, type MembershipBadges } from "./roster-membership.mts";
import { deliverPendingAnnouncements } from "./founder-announcements.mts";

/** Run on ordinary authenticated requests: record the member's membership and
 * put any Founder announcement addressed to them into their ROOSTER messages,
 * so it is already waiting the next time they log in. Best effort — a database
 * hiccup must never stop somebody reading their inbox or their profile, and the
 * same announcement is retried on their next request. */
export async function catchUpMembership(
  member: Member, context: Context, stores?: MemberStores,
): Promise<MembershipBadges | null> {
  try {
    const badges = await ensureMembership(member, profileStore(context));
    await deliverPendingAnnouncements(member, stores ?? memberStores(context));
    return badges;
  } catch {
    // Never log announcement contents.
    console.warn("membership_catch_up_pending");
    return null;
  }
}
