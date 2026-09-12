import type { Context } from "@netlify/functions";
import { MEMBER_ID, type Member } from "./member-auth.mts";
import { registerMemberMessageParticipants, memberStores, type MemberStores } from "./member-messages.mts";
import { profileStore, type ProfileStore } from "./member-profiles.mts";
import { ensureAutomaticOwnerFriend, friendStore, type FriendStore } from "./friends.mts";
import { deliverOwnerWallWelcome, memberWallStore, type MemberWallStore } from "./member-wall.mts";

import { communityDirectory, registerPublicMember } from "./community-members.mts";

export type WelcomeResult = { status: "sent" | "already_sent" | "owner" | "pending" };
export type MemberWelcomeStores = MemberStores & { friends?: FriendStore; walls?: MemberWallStore };

/** No sender ID/name from a visitor is trusted. owner-binding is created only
 * by the existing verified site-owner profile flow. A missing binding leaves
 * delivery pending rather than inventing an owner or impersonating a member.
 */
export async function welcomeVerifiedMember(
  member: Member, profiles: Pick<ProfileStore, "get">, stores: MemberWelcomeStores,
): Promise<WelcomeResult> {
  try {
    if (!MEMBER_ID.test(member.id)) throw new Error("Invalid welcome recipient");
    const bound = await profiles.get("owner-binding", { type: "json" });
    if (!bound) return { status: "pending" };
    if (typeof bound.id !== "string" || !MEMBER_ID.test(bound.id)) throw new Error("Invalid welcome sender binding");
    const owner = { id: bound.id.toLowerCase(), name: "JWhite" };
    if (member.id.toLowerCase() === owner.id) return { status: "owner" };
    const outcomes = await Promise.allSettled([
      registerMemberMessageParticipants(member, owner, stores),
      stores.friends ? ensureAutomaticOwnerFriend(member, owner, stores.friends) : Promise.reject(new Error("Friend store unavailable")),
      stores.walls ? deliverOwnerWallWelcome(member, owner, stores.walls) : Promise.reject(new Error("Wall store unavailable")),
    ]);
    if (outcomes.some(result => result.status === "rejected")) throw new Error("Member welcome incomplete");
    const values = outcomes.map(result => (result as PromiseFulfilledResult<any>).value);
    const created = values.some(value => value?.status === "sent" || value?.status === "created");
    return { status: created ? "sent" : "already_sent" };
  } catch {
    // Do not break account/profile creation or log message contents. The next
    // authenticated request retries only directory, friend and wall setup.
    console.warn("member_welcome_delivery_pending");
    return { status: "pending" };
  }
}

export async function welcomeMember(member: Member, context: Context, stores?: MemberStores): Promise<WelcomeResult> {
  try {
    const profiles = profileStore(context);
    await registerPublicMember(member, profiles, communityDirectory(context));
    const base = stores ?? memberStores(context);
    const complete: MemberWelcomeStores = {
      ...base,
      friends: (stores as MemberWelcomeStores | undefined)?.friends ?? friendStore(context),
      walls: (stores as MemberWelcomeStores | undefined)?.walls ?? memberWallStore(context),
    };
    return await welcomeVerifiedMember(member, profiles, complete);
  } catch {
    console.warn("member_welcome_delivery_pending");
    return { status: "pending" };
  }
}
