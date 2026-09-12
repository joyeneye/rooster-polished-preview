import type { Config, Context } from "@netlify/functions";
import { getRoomPresence, roomPresenceStore } from "./_shared/chat-room-presence.mts";
import { profileStore } from "./_shared/member-profiles.mts";
export default (req: Request, ctx: Context) => getRoomPresence(req, roomPresenceStore(ctx), profileStore(ctx));
export const config: Config = { path: "/api/chat-room-presence", method: "GET", rateLimit: { windowLimit: 600, windowSize: 60, aggregateBy: ["ip", "domain"] } };
