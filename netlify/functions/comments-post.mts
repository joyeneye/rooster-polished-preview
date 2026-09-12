import type { Config, Context } from "@netlify/functions";
import { commentStore, postComment, unavailable } from "./_shared/comment-wall.mts";
import { moderateComment } from "./_shared/comment-moderation.mts";
import { profileStore } from "./_shared/member-profiles.mts";
import { communityDirectory } from "./_shared/community-members.mts";
import { friendStore } from "./_shared/friends.mts";

export default async (req: Request, context: Context): Promise<Response> => {
  try {
    return await postComment(req, commentStore(context), moderateComment, {
      profiles: profileStore(context), directory: communityDirectory(context), friends: friendStore(context),
    });
  } catch {
    return unavailable();
  }
};

export const config: Config = {
  // Native rate limits target paths, so writes have a path separate from polling.
  path: "/api/comments/post",
  method: "POST",
  rateLimit: { windowLimit: 5, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
