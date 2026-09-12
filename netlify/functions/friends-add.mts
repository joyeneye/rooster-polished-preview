import { profileStore } from "./_shared/member-profiles.mts";
import type { Config, Context } from "@netlify/functions";
import { friendStore, addFriend } from "./_shared/friends.mts";
import { communityDirectory } from "./_shared/community-members.mts";
export default async (req: Request, context: Context) => addFriend(req, friendStore(context), undefined, profileStore(context), communityDirectory(context));
export const config: Config = { path: "/api/friends/add", method: "POST", rateLimit: { windowLimit: 12, windowSize: 60, aggregateBy: ["ip", "domain"] } };
