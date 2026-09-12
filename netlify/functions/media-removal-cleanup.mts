import type { Config, Context } from "@netlify/functions";
import { mediaStores, purgeExpiredMedia } from "./_shared/media-removals.mts";
// Anything removed more than the undo window ago leaves storage here, even if
// the browser that removed it closed before it could confirm.
export default async (_req: Request, context: Context) => { await purgeExpiredMedia(mediaStores(context)); };
export const config: Config = { schedule: "17 * * * *" };
