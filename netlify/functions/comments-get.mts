import type { Config, Context } from "@netlify/functions";
import { commentStore, getComments, unavailable } from "./_shared/comment-wall.mts";
import { profileStore } from "./_shared/member-profiles.mts";
import { communityDirectory } from "./_shared/community-members.mts";
import { friendStore } from "./_shared/friends.mts";

export default async (req: Request, context: Context): Promise<Response> => {
  try {
    return await getComments(req, commentStore(context), {
      profiles: profileStore(context), directory: communityDirectory(context), friends: friendStore(context),
    });
  } catch {
    return unavailable();
  }
};

export const config: Config = {
  path: "/api/comments",
  method: "GET",
  rateLimit: { windowLimit: 200, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
