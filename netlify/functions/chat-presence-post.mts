import type { Config, Context } from "@netlify/functions";
import { postRoomPresence, roomPresenceStore } from "./_shared/chat-room-presence.mts";
import { profileStore } from "./_shared/member-profiles.mts";
export default (req: Request, ctx: Context) => postRoomPresence(req, roomPresenceStore(ctx), profileStore(ctx));
export const config: Config = { path: "/api/chat-room-presence", method: "POST", rateLimit: { windowLimit: 240, windowSize: 60, aggregateBy: ["ip", "domain"] } };
