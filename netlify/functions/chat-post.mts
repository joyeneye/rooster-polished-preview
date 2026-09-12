import type { Config, Context } from "@netlify/functions";
import { chatFailure, chatStore, ensureReleaseChatReset, postChatMessage } from "./_shared/member-chat.mts";
import { profileStore, storedProfileDisplayName } from "./_shared/member-profiles.mts";
import { resolveCommunityProfileMember } from "./_shared/roster-access.mts";

export default async (req: Request, context: Context): Promise<Response> => {
  try {
    const room = chatStore(context);
    await ensureReleaseChatReset(room);
    const profiles = profileStore(context);
    const resolveMember = async () => {
      const member = await resolveCommunityProfileMember();
      return { id: member.id, name: await storedProfileDisplayName(profiles, member.id, member.name) };
    };
    return await postChatMessage(req, room, resolveMember);
  }
  catch (error) { return chatFailure(error); }
};

export const config: Config = {
  path: "/api/member-chat/send", method: "POST",
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
