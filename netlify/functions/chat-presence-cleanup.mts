import type { Config, Context } from "@netlify/functions";
import { cleanupRoomPresence, roomPresenceStore } from "./_shared/chat-room-presence.mts";
export default async (_req: Request, ctx: Context) => { await cleanupRoomPresence(roomPresenceStore(ctx)); };
export const config: Config = { schedule: "*/10 * * * *" };
