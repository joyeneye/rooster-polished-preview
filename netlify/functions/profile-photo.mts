import type { Config, Context } from "@netlify/functions";
import { getProfilePhoto, profileStore, profileFailure } from "./_shared/member-profiles.mts";
export default async (req: Request, context: Context) => { try { return await getProfilePhoto(req, profileStore(context)); } catch (e) { return profileFailure(e); } };
export const config: Config = { path: "/api/profile-photo/:id", method: "GET", rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] } };
