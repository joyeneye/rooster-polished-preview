import type { Config, Context } from "@netlify/functions";
import { chatFailure, chatStore, ensureReleaseChatReset, getChatMessages } from "./_shared/member-chat.mts";

export default async (req: Request, context: Context): Promise<Response> => {
  try {
    const store = chatStore(context);
    await ensureReleaseChatReset(store);
    return await getChatMessages(req, store);
  }
  catch (error) { return chatFailure(error); }
};

export const config: Config = {
  path: "/api/member-chat", method: "GET",
  rateLimit: { windowLimit: 600, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
