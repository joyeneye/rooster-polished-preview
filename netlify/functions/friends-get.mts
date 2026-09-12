import { profileStore } from "./_shared/member-profiles.mts";
import type { Config, Context } from "@netlify/functions";
import { friendStore, getFriendCount } from "./_shared/friends.mts";
import { communityDirectory } from "./_shared/community-members.mts";
export default async (req: Request, context: Context) => getFriendCount(req, friendStore(context), profileStore(context), communityDirectory(context));
export const config: Config = { path: "/api/friends", method: "GET", rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] } };
