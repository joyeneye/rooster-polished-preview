import type { Context } from "@netlify/functions";
import { profileStore } from "./member-profiles.mts";
import { communityDirectory } from "./community-members.mts";
import { friendStore } from "./friends.mts";
import { visitorStore, type ProfileLookup, type VisitorStore } from "./profile-visitors.mts";
import type { ProfileStore } from "./member-profiles.mts";

/** One place to bind every visitor endpoint to the same stores. */
export function visitorContext(context: Context): { visitors: VisitorStore; profiles: ProfileStore; lookup: ProfileLookup } {
  return {
    visitors: visitorStore(context),
    profiles: profileStore(context),
    lookup: { directory: communityDirectory(context), friends: friendStore(context) },
  };
}
